use std::io::Write;
use std::path::Path;

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::aead::rand_core::RngCore;
use chacha20poly1305::aead::{Aead, AeadCore, KeyInit, OsRng, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use zeroize::Zeroizing;

use crate::error::{AppError, AppResult};

pub const FILE: &str = "zcashflow.vault";
pub const MIN_PASSWORD: usize = 4;

const MAGIC: &[u8; 8] = b"ZCVAULT1";
const BLOB_MAGIC: &[u8; 8] = b"ZCBLOB01";
const NONCE: usize = 24;
const WRAPPED: usize = 32 + 16;
const HEADER: usize = 8 + 12 + 16 + NONCE + WRAPPED;

#[cfg(not(test))]
const COST: (u32, u32, u32) = (32 * 1024, 3, 1);
#[cfg(test)]
const COST: (u32, u32, u32) = (64, 1, 1);

#[derive(Clone)]
pub struct Key(Zeroizing<[u8; 32]>);

impl Key {
    fn cipher(&self) -> XChaCha20Poly1305 {
        XChaCha20Poly1305::new((&*self.0).into())
    }

    pub fn same(&self, other: &Key) -> bool {
        self.0.iter().zip(other.0.iter()).fold(0u8, |acc, (a, b)| acc | (a ^ b)) == 0
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Header {
    cost: (u32, u32, u32),
    salt: [u8; 16],
    nonce: [u8; NONCE],
    wrapped: Vec<u8>,
}

fn wrong_password() -> AppError {
    AppError::Unsupported("wrong_password".into())
}

fn damaged() -> AppError {
    AppError::Invalid("the encrypted data could not be read".into())
}

fn derive(password: &str, salt: &[u8; 16], cost: (u32, u32, u32)) -> AppResult<Key> {
    let params = Params::new(cost.0, cost.1, cost.2, Some(32)).map_err(|e| AppError::Invalid(e.to_string()))?;
    let mut out = Zeroizing::new([0u8; 32]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(password.as_bytes(), salt, &mut *out)
        .map_err(|e| AppError::Invalid(e.to_string()))?;
    Ok(Key(out))
}

pub fn check_password(password: &str) -> AppResult<()> {
    if password.chars().count() < MIN_PASSWORD {
        return Err(AppError::Unsupported("password_too_short".into()));
    }
    Ok(())
}

fn wrap(key: &Key, password: &str) -> AppResult<Header> {
    let mut salt = [0u8; 16];
    OsRng.fill_bytes(&mut salt);
    let kek = derive(password, &salt, COST)?;
    let nonce = XChaCha20Poly1305::generate_nonce(&mut OsRng);
    let wrapped = kek.cipher().encrypt(&nonce, &key.0[..]).map_err(|_| damaged())?;
    Ok(Header { cost: COST, salt, nonce: nonce.into(), wrapped })
}

pub fn create(password: &str) -> AppResult<(Header, Key)> {
    check_password(password)?;
    let mut raw = Zeroizing::new([0u8; 32]);
    OsRng.fill_bytes(&mut *raw);
    let key = Key(raw);
    Ok((wrap(&key, password)?, key))
}

pub fn unwrap(header: &Header, password: &str) -> AppResult<Key> {
    let kek = derive(password, &header.salt, header.cost)?;
    let plain = Zeroizing::new(
        kek.cipher().decrypt(XNonce::from_slice(&header.nonce), header.wrapped.as_slice()).map_err(|_| wrong_password())?,
    );
    let mut raw = Zeroizing::new([0u8; 32]);
    if plain.len() != 32 {
        return Err(damaged());
    }
    raw.copy_from_slice(&plain);
    Ok(Key(raw))
}

pub fn rewrap(key: &Key, password: &str) -> AppResult<Header> {
    check_password(password)?;
    wrap(key, password)
}

impl Header {
    fn bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(HEADER);
        out.extend_from_slice(MAGIC);
        for v in [self.cost.0, self.cost.1, self.cost.2] {
            out.extend_from_slice(&v.to_le_bytes());
        }
        out.extend_from_slice(&self.salt);
        out.extend_from_slice(&self.nonce);
        out.extend_from_slice(&self.wrapped);
        out
    }

    fn parse(data: &[u8]) -> AppResult<Self> {
        if data.len() < HEADER || &data[..8] != MAGIC {
            return Err(damaged());
        }
        let num = |at: usize| u32::from_le_bytes(data[at..at + 4].try_into().unwrap());
        let cost = (num(8), num(12), num(16));
        if cost.0 > 4 * 1024 * 1024 || cost.1 > 64 || cost.2 > 64 {
            return Err(damaged());
        }
        Ok(Self {
            cost,
            salt: data[20..36].try_into().unwrap(),
            nonce: data[36..60].try_into().unwrap(),
            wrapped: data[60..HEADER].to_vec(),
        })
    }
}

pub fn seal(header: &Header, key: &Key, plain: &[u8]) -> AppResult<Vec<u8>> {
    let head = header.bytes();
    let nonce = XChaCha20Poly1305::generate_nonce(&mut OsRng);
    let body = key.cipher().encrypt(&nonce, Payload { msg: plain, aad: &head }).map_err(|_| damaged())?;
    let mut out = Vec::with_capacity(head.len() + NONCE + body.len());
    out.extend_from_slice(&head);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&body);
    Ok(out)
}

pub fn header_of(data: &[u8]) -> AppResult<Header> {
    Header::parse(data)
}

pub fn open(data: &[u8], key: &Key) -> AppResult<Zeroizing<Vec<u8>>> {
    Header::parse(data)?;
    if data.len() < HEADER + NONCE {
        return Err(damaged());
    }
    let (head, rest) = data.split_at(HEADER);
    let (nonce, body) = rest.split_at(NONCE);
    let plain = key.cipher().decrypt(XNonce::from_slice(nonce), Payload { msg: body, aad: head }).map_err(|_| damaged())?;
    Ok(Zeroizing::new(plain))
}

pub fn is_blob(data: &[u8]) -> bool {
    data.len() >= 8 && &data[..8] == BLOB_MAGIC
}

pub fn seal_blob(key: &Key, plain: &[u8]) -> AppResult<Vec<u8>> {
    let nonce = XChaCha20Poly1305::generate_nonce(&mut OsRng);
    let body = key.cipher().encrypt(&nonce, Payload { msg: plain, aad: BLOB_MAGIC }).map_err(|_| damaged())?;
    let mut out = Vec::with_capacity(8 + NONCE + body.len());
    out.extend_from_slice(BLOB_MAGIC);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&body);
    Ok(out)
}

pub fn open_blob(key: &Key, data: &[u8]) -> AppResult<Vec<u8>> {
    if !is_blob(data) {
        return Ok(data.to_vec());
    }
    if data.len() < 8 + NONCE {
        return Err(damaged());
    }
    key.cipher()
        .decrypt(XNonce::from_slice(&data[8..8 + NONCE]), Payload { msg: &data[8 + NONCE..], aad: BLOB_MAGIC })
        .map_err(|_| damaged())
}

pub fn write_atomic(path: &Path, bytes: &[u8]) -> AppResult<()> {
    let tmp = path.with_extension(format!("{}.tmp", path.extension().and_then(|e| e.to_str()).unwrap_or("")));
    {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    std::fs::rename(&tmp, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seals_and_opens_with_the_right_password_only() {
        let (header, key) = create("geheim123").unwrap();
        let data = seal(&header, &key, b"ledger").unwrap();
        assert!(!data.windows(6).any(|w| w == b"ledger"), "nothing readable on disk");
        let parsed = header_of(&data).unwrap();
        assert_eq!(parsed, header);
        let key2 = unwrap(&parsed, "geheim123").unwrap();
        assert!(key2.same(&key));
        assert_eq!(&**open(&data, &key2).unwrap(), b"ledger");
        let err = unwrap(&parsed, "falsch").err().unwrap();
        assert!(err.to_string().contains("wrong_password"));
    }

    #[test]
    fn detects_tampering_and_rejects_short_passwords() {
        let (header, key) = create("geheim123").unwrap();
        let mut data = seal(&header, &key, b"ledger").unwrap();
        let last = data.len() - 1;
        data[last] ^= 1;
        assert!(open(&data, &key).is_err());
        assert!(create("abc").is_err());
        assert!(header_of(b"not a vault").is_err());
    }

    #[test]
    fn changing_the_password_keeps_the_key() {
        let (header, key) = create("alt-passwort").unwrap();
        let data = seal(&header, &key, b"x").unwrap();
        let new_header = rewrap(&key, "neues-passwort").unwrap();
        let again = seal(&new_header, &key, b"x").unwrap();
        assert!(unwrap(&header_of(&again).unwrap(), "alt-passwort").is_err());
        let k = unwrap(&header_of(&again).unwrap(), "neues-passwort").unwrap();
        assert_eq!(&**open(&data, &k).unwrap(), b"x", "older files still open with the same key");
    }

    #[test]
    fn blobs_round_trip_and_plain_files_pass_through() {
        let (_, key) = create("geheim123").unwrap();
        let sealed = seal_blob(&key, b"jpeg bytes").unwrap();
        assert!(is_blob(&sealed));
        assert_eq!(open_blob(&key, &sealed).unwrap(), b"jpeg bytes");
        assert_eq!(open_blob(&key, b"plain").unwrap(), b"plain");
    }
}
