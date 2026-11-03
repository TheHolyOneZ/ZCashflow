use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use rusqlite::{Connection, OptionalExtension};
use rusqlite_migration::{Migrations, M};

use crate::clock::Hlc;
use crate::error::{AppError, AppResult};
use crate::vault::{self, Header, Key};

mod seed;

pub const SCHEMA_VERSION: u32 = 6;

fn migrations() -> Migrations<'static> {
    Migrations::new(vec![
        M::up(include_str!("../../migrations/001_init.sql")),
        M::up(include_str!("../../migrations/002_planning.sql")),
        M::up(include_str!("../../migrations/003_receipts.sql")),
        M::up(include_str!("../../migrations/004_sync.sql")),
        M::up(include_str!("../../migrations/005_balance_anchor.sql")),
        M::up(include_str!("../../migrations/006_balance_anchor_sync.sql")),
        M::up(include_str!("../../migrations/007_transaction_time.sql")),
        M::up(include_str!("../../migrations/008_recurring_time.sql")),
        M::up(include_str!("../../migrations/009_category_order.sql")),
    ])
}

pub type SharedDb = std::sync::Arc<Db>;

pub struct VaultState {
    header: Header,
    key: Key,
    saved: u64,
}

pub struct Db {
    conn: Mutex<Connection>,

    owner: std::sync::atomic::AtomicU64,
    pub hlc: Hlc,

    pub files_dir: PathBuf,
    plain_path: PathBuf,
    vault: Mutex<Option<VaultState>>,
    saving: Mutex<()>,
}

pub const PLAIN_FILE: &str = "zcashflow.db";
const FILE_DIRS: [&str; 2] = ["attachments", "thumbs"];

fn open_plain(path: &Path) -> AppResult<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    Ok(conn)
}

fn open_memory(plain: &[u8]) -> AppResult<Connection> {
    let mut image = zeroize::Zeroizing::new(plain.to_vec());
    if image.len() > 19 && image[18] == 2 && image[19] == 2 {
        image[18] = 1;
        image[19] = 1;
    }
    let mut conn = Connection::open_in_memory()?;
    conn.deserialize_read_exact("main", image.as_slice(), image.len(), false)?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    Ok(conn)
}

pub fn remove_plain_files(path: &Path) {
    for suffix in ["", "-wal", "-shm", "-journal"] {
        let mut p = path.as_os_str().to_owned();
        p.push(suffix);
        let _ = std::fs::remove_file(PathBuf::from(p));
    }
}

impl Db {
    pub fn open(path: &Path) -> AppResult<Self> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let dir = path.parent().map(Path::to_path_buf).unwrap_or_default();
        Self::init(open_plain(path)?, dir, path.to_path_buf(), None)
    }

    pub fn open_vault(dir: &Path, password: &str) -> AppResult<Self> {
        let data = std::fs::read(dir.join(vault::FILE))?;
        let header = vault::header_of(&data)?;
        let key = vault::unwrap(&header, password)?;
        let plain = vault::open(&data, &key)?;
        let conn = open_memory(&plain)?;
        drop(plain);
        let path = dir.join(PLAIN_FILE);
        let db = Self::init(conn, dir.to_path_buf(), path.clone(), Some(VaultState { header, key, saved: 0 }))?;
        remove_plain_files(&path);
        Ok(db)
    }

    #[cfg(test)]
    pub fn open_in_memory() -> AppResult<Self> {
        let dir = std::env::temp_dir().join(format!("zc-test-{}", uuid::Uuid::now_v7().simple()));
        let path = dir.join(PLAIN_FILE);
        Self::init(Connection::open_in_memory()?, dir, path, None)
    }

    fn init(mut conn: Connection, files_dir: PathBuf, plain_path: PathBuf, vault: Option<VaultState>) -> AppResult<Self> {
        conn.pragma_update(None, "foreign_keys", "ON")?;
        migrations().to_latest(&mut conn)?;

        let device_id = ensure_device_id(&conn)?;
        let db = Self {
            conn: Mutex::new(conn),
            hlc: Hlc::new(device_id),
            files_dir,
            plain_path,
            vault: Mutex::new(vault),
            saving: Mutex::new(()),
            owner: Default::default(),
        };
        seed::seed_defaults(&db)?;
        seed::normalize_seed_ids(&db)?;
        Ok(db)
    }

    fn vault_path(&self) -> PathBuf {
        self.files_dir.join(vault::FILE)
    }

    pub fn vault_enabled(&self) -> bool {
        self.vault.lock().unwrap_or_else(|e| e.into_inner()).is_some()
    }

    fn vault_copy(&self) -> Option<(Header, Key, u64)> {
        self.vault.lock().unwrap_or_else(|e| e.into_inner()).as_ref().map(|v| (v.header.clone(), v.key.clone(), v.saved))
    }

    fn blob_key(&self) -> Option<Key> {
        self.vault.lock().unwrap_or_else(|e| e.into_inner()).as_ref().map(|v| v.key.clone())
    }

    fn snapshot(&self) -> AppResult<(zeroize::Zeroizing<Vec<u8>>, u64)> {
        let conn = self.conn();
        let total = conn.total_changes();
        let data = zeroize::Zeroizing::new(conn.serialize("main")?.to_vec());
        Ok((data, total))
    }

    pub fn save_vault(&self, force: bool) -> AppResult<bool> {
        let _saving = self.saving.lock().unwrap_or_else(|e| e.into_inner());
        let Some((header, key, saved)) = self.vault_copy() else { return Ok(false) };
        if !force && self.conn().total_changes() == saved {
            return Ok(false);
        }
        let (plain, total) = self.snapshot()?;
        vault::write_atomic(&self.vault_path(), &vault::seal(&header, &key, &plain)?)?;
        if let Some(v) = self.vault.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
            v.saved = total;
        }
        Ok(true)
    }

    pub fn encrypted_snapshot(&self) -> AppResult<Option<Vec<u8>>> {
        let Some((header, key, _)) = self.vault_copy() else { return Ok(None) };
        let (plain, _) = self.snapshot()?;
        Ok(Some(vault::seal(&header, &key, &plain)?))
    }

    fn stored_files(&self) -> Vec<PathBuf> {
        FILE_DIRS
            .iter()
            .filter_map(|d| std::fs::read_dir(self.files_dir.join(d)).ok())
            .flat_map(|it| it.filter_map(Result::ok).map(|e| e.path()))
            .filter(|p| p.is_file() && !p.to_string_lossy().ends_with(".tmp"))
            .collect()
    }

    pub fn read_file(&self, path: &Path) -> AppResult<Vec<u8>> {
        let data = std::fs::read(path)?;
        if !vault::is_blob(&data) {
            return Ok(data);
        }
        let key = self.blob_key().ok_or_else(|| AppError::Unsupported("locked".into()))?;
        vault::open_blob(&key, &data)
    }

    pub fn write_file(&self, path: &Path, bytes: &[u8]) -> AppResult<()> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        match self.blob_key() {
            Some(key) => vault::write_atomic(path, &vault::seal_blob(&key, bytes)?),
            None => vault::write_atomic(path, bytes),
        }
    }

    pub fn enable_vault(&self, password: &str) -> AppResult<()> {
        let _saving = self.saving.lock().unwrap_or_else(|e| e.into_inner());
        if self.vault_enabled() {
            return Err(AppError::Invalid("already protected".into()));
        }
        let (header, key) = vault::create(password)?;
        std::fs::create_dir_all(&self.files_dir)?;
        {
            let mut conn = self.conn();
            let plain = zeroize::Zeroizing::new(conn.serialize("main")?.to_vec());
            let memory = open_memory(&plain)?;
            vault::write_atomic(&self.vault_path(), &vault::seal(&header, &key, &plain)?)?;
            let old = std::mem::replace(&mut *conn, memory);
            drop(old);
        }
        *self.vault.lock().unwrap_or_else(|e| e.into_inner()) = Some(VaultState { header, key: key.clone(), saved: 0 });
        remove_plain_files(&self.plain_path);
        for path in self.stored_files() {
            let data = std::fs::read(&path)?;
            if !vault::is_blob(&data) {
                vault::write_atomic(&path, &vault::seal_blob(&key, &data)?)?;
            }
        }
        Ok(())
    }

    fn checked_key(&self, password: &str) -> AppResult<Key> {
        let (header, key, _) = self.vault_copy().ok_or_else(|| AppError::Invalid("not protected".into()))?;
        let given = vault::unwrap(&header, password)?;
        if !given.same(&key) {
            return Err(AppError::Unsupported("wrong_password".into()));
        }
        Ok(key)
    }

    pub fn verify_password(&self, password: &str) -> AppResult<()> {
        self.checked_key(password).map(|_| ())
    }

    pub fn change_password(&self, old: &str, new: &str) -> AppResult<()> {
        let key = self.checked_key(old)?;
        let header = vault::rewrap(&key, new)?;
        if let Some(v) = self.vault.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
            v.header = header;
        }
        self.save_vault(true).map(|_| ())
    }

    pub fn disable_vault(&self, password: &str) -> AppResult<()> {
        let key = self.checked_key(password)?;
        let _saving = self.saving.lock().unwrap_or_else(|e| e.into_inner());
        let tmp = self.plain_path.with_extension("db.tmp");
        let _ = std::fs::remove_file(&tmp);
        {
            let mut conn = self.conn();
            conn.execute("VACUUM INTO ?1", [tmp.to_string_lossy()])?;
            std::fs::rename(&tmp, &self.plain_path)?;
            let file = open_plain(&self.plain_path)?;
            let old = std::mem::replace(&mut *conn, file);
            drop(old);
        }
        *self.vault.lock().unwrap_or_else(|e| e.into_inner()) = None;
        for path in self.stored_files() {
            let data = std::fs::read(&path)?;
            if vault::is_blob(&data) {
                vault::write_atomic(&path, &vault::open_blob(&key, &data)?)?;
            }
        }
        let _ = std::fs::remove_file(self.vault_path());
        Ok(())
    }

    pub fn restore_backup(&self, data: &[u8], password: Option<&str>) -> AppResult<BackupSummary> {
        let (mut restored, encrypted) = read_backup(data, password)?;
        let saving = self.saving.lock().unwrap_or_else(|e| e.into_inner());
        let mut conn = self.conn();
        adopt_device(&conn, &mut restored, &self.hlc)?;
        let summary = summarize(&restored, encrypted)?;
        if self.vault_enabled() {
            let old = std::mem::replace(&mut *conn, restored);
            drop(old);
            drop(conn);
            drop(saving);
            self.save_vault(true)?;
            return Ok(summary);
        }
        let tmp = self.plain_path.with_extension("db.restore");
        let _ = std::fs::remove_file(&tmp);
        restored.execute("VACUUM INTO ?1", [tmp.to_string_lossy()])?;
        drop(restored);
        let old = std::mem::replace(&mut *conn, Connection::open_in_memory()?);
        drop(old);
        remove_plain_files(&self.plain_path);
        if let Err(e) = std::fs::rename(&tmp, &self.plain_path) {
            *conn = open_plain(&tmp)?;
            return Err(e.into());
        }
        *conn = open_plain(&self.plain_path)?;
        Ok(summary)
    }

    pub fn forget_vault(&self) {
        let _saving = self.saving.lock().unwrap_or_else(|e| e.into_inner());
        *self.vault.lock().unwrap_or_else(|e| e.into_inner()) = None;
        let _ = std::fs::remove_file(self.vault_path());
    }

    pub fn conn(&self) -> DbGuard<'_> {
        let me = thread_tag();
        if cfg!(debug_assertions) && self.owner.load(std::sync::atomic::Ordering::SeqCst) == me {
            panic!("Db::conn() re-entered on the same thread (deadlock)");
        }

        let guard = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        self.owner.store(me, std::sync::atomic::Ordering::SeqCst);
        DbGuard { guard, owner: &self.owner }
    }

    pub fn device_id(&self) -> &str {
        self.hlc.device_id()
    }
}

fn thread_tag() -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    std::thread::current().id().hash(&mut h);
    h.finish() | 1
}

pub struct DbGuard<'a> {
    guard: MutexGuard<'a, Connection>,
    owner: &'a std::sync::atomic::AtomicU64,
}

impl Drop for DbGuard<'_> {
    fn drop(&mut self) {
        self.owner.store(0, std::sync::atomic::Ordering::SeqCst);
    }
}

impl std::ops::Deref for DbGuard<'_> {
    type Target = Connection;
    fn deref(&self) -> &Connection {
        &self.guard
    }
}

impl std::ops::DerefMut for DbGuard<'_> {
    fn deref_mut(&mut self) -> &mut Connection {
        &mut self.guard
    }
}

pub fn get_meta(conn: &Connection, key: &str) -> AppResult<Option<String>> {
    Ok(conn
        .query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| r.get(0))
        .optional()?)
}

pub fn set_meta(conn: &Connection, key: &str, value: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, value],
    )?;
    Ok(())
}

impl Db {
    pub fn wipe_everything(&self) -> AppResult<()> {
        let conn = self.conn();
        let tables: Vec<String> = conn
            .prepare(
                "SELECT name FROM sqlite_master WHERE type = 'table'
                 AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'transactions_fts_%'",
            )?
            .query_map([], |r| r.get(0))?
            .collect::<Result<_, _>>()?;
        conn.pragma_update(None, "foreign_keys", "OFF")?;
        let result = (|| -> AppResult<()> {
            let tx = conn.unchecked_transaction()?;
            for t in &tables {
                tx.execute(&format!("DELETE FROM \"{t}\""), [])?;
            }
            tx.execute("DELETE FROM sqlite_sequence", []).ok();
            tx.commit()?;
            Ok(())
        })();
        conn.pragma_update(None, "foreign_keys", "ON")?;
        result?;
        conn.execute_batch("VACUUM")?;
        for dir in ["attachments", "thumbs"] {
            let p = self.files_dir.join(dir);
            if p.exists() {
                std::fs::remove_dir_all(p)?;
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BackupSummary {
    pub encrypted: bool,
    pub transactions: i64,
    pub accounts: i64,
    pub first_on: Option<String>,
    pub last_on: Option<String>,
}

const DEVICE_META: [&str; 10] = [
    "device_id",
    "sync_private_key",
    "sync_public_key",
    "sync_enabled",
    "discoverable",
    "ocr_engine",
    "llm_enabled",
    "llm_model",
    "llm_url",
    "llm_vision",
];

fn not_a_backup() -> AppError {
    AppError::Unsupported("not_a_backup".into())
}

fn read_backup(data: &[u8], password: Option<&str>) -> AppResult<(Connection, bool)> {
    let (mut conn, encrypted) = if vault::is_vault(data) {
        let password = password.filter(|p| !p.is_empty()).ok_or_else(|| AppError::Unsupported("password_required".into()))?;
        let header = vault::header_of(data)?;
        let key = vault::unwrap(&header, password)?;
        (open_memory(&vault::open(data, &key)?)?, true)
    } else if data.starts_with(b"SQLite format 3\0") {
        (open_memory(data).map_err(|_| not_a_backup())?, false)
    } else {
        return Err(not_a_backup());
    };
    let tables: i64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name IN ('meta', 'accounts', 'transactions')",
            [],
            |r| r.get(0),
        )
        .map_err(|_| not_a_backup())?;
    if tables != 3 {
        return Err(not_a_backup());
    }
    match migrations().to_latest(&mut conn) {
        Ok(()) => {}
        Err(rusqlite_migration::Error::MigrationDefinition(rusqlite_migration::MigrationDefinitionError::DatabaseTooFarAhead)) => {
            return Err(AppError::Unsupported("backup_too_new".into()))
        }
        Err(e) => return Err(e.into()),
    }
    conn.pragma_update(None, "foreign_keys", "ON")?;
    Ok((conn, encrypted))
}

fn summarize(conn: &Connection, encrypted: bool) -> AppResult<BackupSummary> {
    let (transactions, first_on, last_on) = conn.query_row(
        "SELECT count(*), min(occurred_on), max(occurred_on) FROM transactions WHERE deleted = 0",
        [],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    let accounts = conn.query_row("SELECT count(*) FROM accounts WHERE deleted = 0", [], |r| r.get(0))?;
    Ok(BackupSummary { encrypted, transactions, accounts, first_on, last_on })
}

pub fn inspect_backup(data: &[u8], password: Option<&str>) -> AppResult<BackupSummary> {
    let (conn, encrypted) = read_backup(data, password)?;
    summarize(&conn, encrypted)
}

type PeerRow = (String, String, String, String, Option<String>, Option<String>);

fn adopt_device(current: &Connection, restored: &mut Connection, hlc: &Hlc) -> AppResult<()> {
    let peers: Vec<PeerRow> = current
        .prepare("SELECT public_key, name, role, paired_at, last_seen, last_addr FROM paired_devices")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))?
        .collect::<Result<_, _>>()?;
    let seq: i64 = current.query_row("SELECT coalesce(max(seq), 0) FROM sync_changes", [], |r| r.get(0))?;
    let tx = restored.transaction()?;
    for key in DEVICE_META {
        tx.execute("DELETE FROM meta WHERE key = ?1", [key])?;
        if let Some(value) = get_meta(current, key)? {
            set_meta(&tx, key, &value)?;
        }
    }
    tx.execute("DELETE FROM paired_devices", [])?;
    for (key, name, role, paired_at, last_seen, last_addr) in peers {
        tx.execute(
            "INSERT INTO paired_devices (public_key, name, role, paired_at, last_seen, last_addr, cursor) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)",
            rusqlite::params![key, name, role, paired_at, last_seen, last_addr],
        )?;
    }
    let restored_seq: i64 = tx
        .query_row("SELECT seq FROM sqlite_sequence WHERE name = 'sync_changes'", [], |r| r.get(0))
        .optional()?
        .unwrap_or(0);
    tx.execute("DELETE FROM sync_changes", [])?;
    tx.execute("DELETE FROM sqlite_sequence WHERE name = 'sync_changes'", [])?;
    tx.execute("INSERT INTO sqlite_sequence (name, seq) VALUES ('sync_changes', ?1)", [seq.max(restored_seq)])?;
    for (tbl, pk) in crate::sync::rows::TABLES {
        if let Some(newest) = tx.query_row(&format!("SELECT max(updated_hlc) FROM {tbl}"), [], |r| r.get::<_, Option<String>>(0))? {
            hlc.observe(&newest);
        }
        let ids: Vec<String> = tx.prepare(&format!("SELECT {pk} FROM {tbl}"))?.query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?;
        let mut stamp = tx.prepare(&format!("UPDATE {tbl} SET updated_hlc = ?1 WHERE {pk} = ?2"))?;
        for id in ids {
            stamp.execute(rusqlite::params![hlc.tick(), id])?;
        }
    }
    tx.commit()?;
    Ok(())
}

fn ensure_device_id(conn: &Connection) -> AppResult<String> {
    if let Some(id) = get_meta(conn, "device_id")? {
        return Ok(id);
    }
    let id = uuid::Uuid::now_v7().simple().to_string();
    set_meta(conn, "device_id", &id)?;
    Ok(id)
}

pub fn det_id(kind: &str, key: &str) -> String {
    const NS: uuid::Uuid = uuid::Uuid::from_u128(0x6a1f_3c0e_9d2b_4f7a_8e15_c0ff_ee5a_1e00);
    uuid::Uuid::new_v5(&NS, format!("{kind}:{key}").as_bytes()).to_string()
}

pub fn new_id() -> String {
    uuid::Uuid::now_v7().to_string()
}

pub fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_are_valid() {
        migrations().validate().unwrap();
    }

    #[test]
    fn wipe_removes_everything_and_reseeds_on_open() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.db");
        let old_id = {
            let db = Db::open(&path).unwrap();
            crate::domain::demo::load(&db, chrono::NaiveDate::from_ymd_opt(2026, 10, 8).unwrap()).unwrap();
            std::fs::create_dir_all(db.files_dir.join("attachments")).unwrap();
            std::fs::write(db.files_dir.join("attachments/x"), b"x").unwrap();
            let id = db.device_id().to_owned();
            db.wipe_everything().unwrap();
            let n: i64 = db.conn().query_row("SELECT count(*) FROM transactions", [], |r| r.get(0)).unwrap();
            assert_eq!(n, 0);
            assert!(!db.files_dir.join("attachments").exists());
            id
        };
        let db = Db::open(&path).unwrap();
        assert_ne!(db.device_id(), old_id, "fresh identity after reset");
        let cats: i64 = db.conn().query_row("SELECT count(*) FROM categories WHERE deleted = 0", [], |r| r.get(0)).unwrap();
        assert_eq!(cats, 12, "defaults seeded again");
        let n: i64 = db.conn().query_row("SELECT count(*) FROM transactions_fts", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
    }

    fn count(db: &Db, table: &str) -> i64 {
        db.conn().query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn protects_the_database_with_a_password_and_keeps_sync_identity() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(PLAIN_FILE);
        let (device, txs) = {
            let db = Db::open(&path).unwrap();
            crate::domain::demo::load(&db, chrono::NaiveDate::from_ymd_opt(2026, 10, 8).unwrap()).unwrap();
            db.write_file(&db.files_dir.join("attachments/abc"), b"receipt photo").unwrap();
            db.enable_vault("geheim123").unwrap();
            assert!(db.vault_enabled());
            assert!(!path.exists(), "the readable database is removed");
            let vault_file = std::fs::read(dir.path().join(vault::FILE)).unwrap();
            assert!(!vault_file.windows(6).any(|w| w == b"Miete " || w == b"REWE M"), "no readable text on disk");
            let photo = std::fs::read(db.files_dir.join("attachments/abc")).unwrap();
            assert!(vault::is_blob(&photo), "photos are encrypted too");
            assert_eq!(db.read_file(&db.files_dir.join("attachments/abc")).unwrap(), b"receipt photo");
            db.conn().execute("UPDATE meta SET value = 'LKR' WHERE key = 'default_currency'", []).ok();
            set_meta(&db.conn(), "probe", "after-enable").unwrap();
            assert!(db.save_vault(false).unwrap(), "changes are written");
            assert!(!db.save_vault(false).unwrap(), "nothing to write without changes");
            (db.device_id().to_owned(), count(&db, "transactions"))
        };
        assert!(Db::open_vault(dir.path(), "falsch").err().unwrap().to_string().contains("wrong_password"));
        let db = Db::open_vault(dir.path(), "geheim123").unwrap();
        assert_eq!(db.device_id(), device, "the same device for sync");
        assert_eq!(count(&db, "transactions"), txs);
        assert_eq!(get_meta(&db.conn(), "probe").unwrap().as_deref(), Some("after-enable"));

        assert!(db.verify_password("nope").is_err());
        db.change_password("geheim123", "neu-geheim").unwrap();
        drop(db);
        assert!(Db::open_vault(dir.path(), "geheim123").is_err());
        let db = Db::open_vault(dir.path(), "neu-geheim").unwrap();

        assert!(db.disable_vault("geheim123").is_err());
        db.disable_vault("neu-geheim").unwrap();
        assert!(!dir.path().join(vault::FILE).exists());
        assert_eq!(std::fs::read(db.files_dir.join("attachments/abc")).unwrap(), b"receipt photo");
        drop(db);
        let db = Db::open(&path).unwrap();
        assert_eq!(db.device_id(), device);
        assert_eq!(count(&db, "transactions"), txs);
    }

    fn plain_backup(db: &Db, dir: &Path) -> Vec<u8> {
        let file = dir.join("backup.db");
        crate::domain::export::backup(&db.conn(), &file).unwrap();
        std::fs::read(file).unwrap()
    }

    fn live(db: &Db) -> i64 {
        db.conn().query_row("SELECT count(*) FROM transactions WHERE deleted = 0", [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn restores_a_backup_on_this_device_and_sync_takes_it_over() {
        use crate::sync::rows;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(PLAIN_FILE);
        let db = Db::open(&path).unwrap();
        crate::domain::demo::load(&db, chrono::NaiveDate::from_ymd_opt(2026, 10, 8).unwrap()).unwrap();
        let saved = live(&db);
        let bytes = plain_backup(&db, dir.path());

        set_meta(&db.conn(), "sync_public_key", "this-device").unwrap();
        db.conn()
            .execute("INSERT INTO paired_devices (public_key, name, paired_at, cursor) VALUES ('peer', 'Phone', '2026-10-01', 99)", [])
            .unwrap();
        let peer = Db::open_in_memory().unwrap();
        let mut cursor = 0;
        let (changes, upto, _) = rows::changes_since(&db.conn(), cursor, 100_000).unwrap();
        rows::apply(&peer, &changes, None).unwrap();
        cursor = upto;
        let ids: Vec<String> = db.conn().prepare("SELECT id FROM transactions").unwrap().query_map([], |r| r.get(0)).unwrap().map(Result::unwrap).collect();
        for id in &ids {
            crate::domain::transactions::delete(&db, id).unwrap();
        }
        let (changes, upto, _) = rows::changes_since(&db.conn(), cursor, 100_000).unwrap();
        rows::apply(&peer, &changes, None).unwrap();
        cursor = upto;
        assert_eq!((live(&db), live(&peer)), (0, 0));

        assert!(inspect_backup(b"not a backup", None).unwrap_err().to_string().contains("not_a_backup"));
        let summary = inspect_backup(&bytes, None).unwrap();
        assert_eq!((summary.encrypted, summary.transactions), (false, saved));
        let device = db.device_id().to_owned();
        db.restore_backup(&bytes, None).unwrap();
        assert_eq!(live(&db), saved);
        assert_eq!(db.device_id(), device);
        assert_eq!(get_meta(&db.conn(), "sync_public_key").unwrap().as_deref(), Some("this-device"));
        let peer_cursor: i64 = db.conn().query_row("SELECT cursor FROM paired_devices WHERE public_key = 'peer'", [], |r| r.get(0)).unwrap();
        assert_eq!(peer_cursor, 0, "pull everything from paired devices again");

        let (changes, _, _) = rows::changes_since(&db.conn(), cursor, 100_000).unwrap();
        assert!(!changes.is_empty(), "restored rows are numbered after what peers already have");
        rows::apply(&peer, &changes, None).unwrap();
        assert_eq!(live(&peer), saved, "the restored state wins on paired devices");

        drop(db);
        let db = Db::open(&path).unwrap();
        assert_eq!((live(&db), db.device_id()), (saved, device.as_str()));
    }

    #[test]
    fn restores_encrypted_backups_and_keeps_the_device_password() {
        let protected_dir = tempfile::tempdir().unwrap();
        let protected = Db::open(&protected_dir.path().join(PLAIN_FILE)).unwrap();
        crate::domain::demo::load(&protected, chrono::NaiveDate::from_ymd_opt(2026, 10, 8).unwrap()).unwrap();
        let saved = live(&protected);
        let plain = plain_backup(&protected, protected_dir.path());
        protected.enable_vault("pw1234").unwrap();
        let sealed = protected.encrypted_snapshot().unwrap().unwrap();

        assert!(inspect_backup(&sealed, None).unwrap_err().to_string().contains("password_required"));
        assert!(inspect_backup(&sealed, Some("wrong")).unwrap_err().to_string().contains("wrong_password"));
        assert!(inspect_backup(&sealed, Some("pw1234")).unwrap().encrypted);

        let other_dir = tempfile::tempdir().unwrap();
        let other_path = other_dir.path().join(PLAIN_FILE);
        let other = Db::open(&other_path).unwrap();
        other.restore_backup(&sealed, Some("pw1234")).unwrap();
        assert_eq!(live(&other), saved);
        assert!(!other.vault_enabled() && other_path.exists(), "an unprotected device stays unprotected");

        protected.conn().execute("UPDATE transactions SET deleted = 1", []).unwrap();
        protected.save_vault(true).unwrap();
        protected.restore_backup(&plain, None).unwrap();
        assert!(protected.vault_enabled());
        drop(protected);
        assert!(!protected_dir.path().join(PLAIN_FILE).exists());
        let reopened = Db::open_vault(protected_dir.path(), "pw1234").unwrap();
        assert_eq!(live(&reopened), saved);
    }

    #[test]
    fn device_id_is_stable_across_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("zc.db");
        let a = Db::open(&path).unwrap().device_id().to_owned();
        let b = Db::open(&path).unwrap().device_id().to_owned();
        assert_eq!(a, b);
    }
}
