use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::Arc;
use std::time::Duration;

use sha2::{Digest, Sha256};
use snow::{Builder, StatelessTransportState};

use crate::error::{AppError, AppResult};

const PATTERN: &str = "Noise_XX_25519_ChaChaPoly_BLAKE2s";
const PATTERN_PSK: &str = "Noise_XXpsk3_25519_ChaChaPoly_BLAKE2s";
const MAX_NOISE: usize = 65_535;
const TAG: usize = 16;
const CHUNK: usize = MAX_NOISE - TAG - 1;

fn err(e: impl std::fmt::Display) -> AppError {
    AppError::Invalid(format!("sync: {e}"))
}

pub fn generate_keypair() -> AppResult<(Vec<u8>, Vec<u8>)> {
    let kp = Builder::new(PATTERN.parse().map_err(err)?).generate_keypair().map_err(err)?;
    Ok((kp.private, kp.public))
}

pub fn psk_from_code(code: &str) -> [u8; 32] {
    Sha256::digest(format!("zcashflow-pair:{}", code.trim()).as_bytes()).into()
}

fn write_frame(stream: &mut TcpStream, data: &[u8]) -> AppResult<()> {
    let len = u16::try_from(data.len()).map_err(err)?;
    stream.write_all(&len.to_be_bytes())?;
    stream.write_all(data)?;
    Ok(())
}

fn read_frame(stream: &mut TcpStream) -> AppResult<Vec<u8>> {
    let mut len = [0u8; 2];
    stream.read_exact(&mut len)?;
    let mut buf = vec![0u8; u16::from_be_bytes(len) as usize];
    stream.read_exact(&mut buf)?;
    Ok(buf)
}

pub fn handshake(
    stream: &mut TcpStream,
    initiator: bool,
    private_key: &[u8],
    psk: Option<[u8; 32]>,
) -> AppResult<(StatelessTransportState, Vec<u8>)> {
    stream.set_read_timeout(Some(Duration::from_secs(15)))?;
    let pattern = if psk.is_some() { PATTERN_PSK } else { PATTERN };
    let mut builder = Builder::new(pattern.parse().map_err(err)?).local_private_key(private_key).map_err(err)?;
    if let Some(psk) = psk.as_ref() {
        builder = builder.psk(3, psk).map_err(err)?;
    }
    let mut hs = if initiator { builder.build_initiator() } else { builder.build_responder() }.map_err(err)?;
    let mut buf = vec![0u8; MAX_NOISE];
    let mut payload = vec![0u8; MAX_NOISE];

    for step in 0..3 {
        let we_write = (step % 2 == 0) == initiator;
        if we_write {
            let n = hs.write_message(&[], &mut buf).map_err(err)?;
            write_frame(stream, &buf[..n])?;
        } else {
            let frame = read_frame(stream)?;
            hs.read_message(&frame, &mut payload).map_err(|_| AppError::Invalid("sync: handshake rejected".into()))?;
        }
    }
    let remote = hs.get_remote_static().ok_or_else(|| err("no remote key"))?.to_vec();
    let transport = hs.into_stateless_transport_mode().map_err(err)?;
    stream.set_read_timeout(None)?;
    Ok((transport, remote))
}

pub struct Sender {
    stream: TcpStream,
    state: Arc<StatelessTransportState>,
    nonce: u64,
    buf: Vec<u8>,
}

pub struct Receiver {
    stream: TcpStream,
    state: Arc<StatelessTransportState>,
    nonce: u64,
    buf: Vec<u8>,
}

pub fn split(stream: TcpStream, state: StatelessTransportState) -> AppResult<(Sender, Receiver)> {
    let state = Arc::new(state);
    let write = stream.try_clone()?;
    Ok((
        Sender { stream: write, state: state.clone(), nonce: 0, buf: vec![0u8; MAX_NOISE] },
        Receiver { stream, state, nonce: 0, buf: vec![0u8; MAX_NOISE] },
    ))
}

impl Sender {
    pub fn send(&mut self, data: &[u8]) -> AppResult<()> {
        let mut chunks = data.chunks(CHUNK).peekable();
        if chunks.peek().is_none() {
            return self.send_fragment(0, &[]);
        }
        while let Some(chunk) = chunks.next() {
            self.send_fragment(u8::from(chunks.peek().is_some()), chunk)?;
        }
        Ok(())
    }

    fn send_fragment(&mut self, flag: u8, chunk: &[u8]) -> AppResult<()> {
        let mut plain = Vec::with_capacity(chunk.len() + 1);
        plain.push(flag);
        plain.extend_from_slice(chunk);
        let n = self.state.write_message(self.nonce, &plain, &mut self.buf).map_err(err)?;
        self.nonce += 1;
        let frame = self.buf[..n].to_vec();
        write_frame(&mut self.stream, &frame)
    }

    pub fn shutdown(&self) {
        let _ = self.stream.shutdown(std::net::Shutdown::Both);
    }
}

impl Receiver {
    pub fn recv(&mut self) -> AppResult<Vec<u8>> {
        let mut out = Vec::new();
        loop {
            let frame = read_frame(&mut self.stream)?;
            let n = self.state.read_message(self.nonce, &frame, &mut self.buf).map_err(err)?;
            self.nonce += 1;
            if n == 0 {
                return Err(err("empty frame"));
            }
            out.extend_from_slice(&self.buf[1..n]);
            if self.buf[0] == 0 {
                return Ok(out);
            }
            if out.len() > 64 * 1024 * 1024 {
                return Err(err("message too large"));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    type Side = AppResult<(StatelessTransportState, Vec<u8>, TcpStream)>;

    fn pair(psk_a: Option<[u8; 32]>, psk_b: Option<[u8; 32]>) -> (Side, Side, Vec<u8>, Vec<u8>) {
        let (a_priv, a_pub) = generate_keypair().unwrap();
        let (b_priv, b_pub) = generate_keypair().unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            handshake(&mut s, false, &b_priv, psk_b).map(|(t, r)| (t, r, s))
        });
        let mut c = TcpStream::connect(addr).unwrap();
        let client = handshake(&mut c, true, &a_priv, psk_a).map(|(t, r)| (t, r, c));
        (client, server.join().unwrap(), a_pub, b_pub)
    }

    #[test]
    fn mutual_auth_and_large_messages() {
        let (client, server, a_pub, b_pub) = pair(None, None);
        let (ct, c_remote, cs) = client.unwrap();
        let (st, s_remote, ss) = server.unwrap();
        assert_eq!(c_remote, b_pub);
        assert_eq!(s_remote, a_pub);
        let (mut tx, _) = split(cs, ct).unwrap();
        let (_, mut rx) = split(ss, st).unwrap();
        let big: Vec<u8> = (0..200_000u32).map(|i| (i % 251) as u8).collect();
        tx.send(b"hello").unwrap();
        tx.send(&big).unwrap();
        tx.send(&[]).unwrap();
        assert_eq!(rx.recv().unwrap(), b"hello");
        assert_eq!(rx.recv().unwrap(), big);
        assert_eq!(rx.recv().unwrap(), Vec::<u8>::new());
    }

    #[test]
    fn wrong_pairing_code_fails() {
        let (client, server, _, _) = pair(Some(psk_from_code("123456")), Some(psk_from_code("654321")));
        assert!(client.is_err() || server.is_err());
        let (client, server, _, _) = pair(Some(psk_from_code("123456")), Some(psk_from_code(" 123456 ")));
        assert!(client.is_ok() && server.is_ok());
    }
}
