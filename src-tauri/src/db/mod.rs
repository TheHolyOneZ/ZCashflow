use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use rusqlite::{Connection, OptionalExtension};
use rusqlite_migration::{Migrations, M};

use crate::clock::Hlc;
use crate::error::AppResult;

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
    ])
}

pub type SharedDb = std::sync::Arc<Db>;

pub struct Db {
    conn: Mutex<Connection>,

    owner: std::sync::atomic::AtomicU64,
    pub hlc: Hlc,

    pub files_dir: PathBuf,
}

impl Db {
    pub fn open(path: &Path) -> AppResult<Self> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let dir = path.parent().map(Path::to_path_buf).unwrap_or_default();
        Self::init(Connection::open(path)?, dir)
    }

    #[cfg(test)]
    pub fn open_in_memory() -> AppResult<Self> {
        let dir = std::env::temp_dir().join(format!("zc-test-{}", uuid::Uuid::now_v7().simple()));
        Self::init(Connection::open_in_memory()?, dir)
    }

    fn init(mut conn: Connection, files_dir: PathBuf) -> AppResult<Self> {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        migrations().to_latest(&mut conn)?;

        let device_id = ensure_device_id(&conn)?;
        let db = Self { conn: Mutex::new(conn), hlc: Hlc::new(device_id), files_dir, owner: Default::default() };
        seed::seed_defaults(&db)?;
        seed::normalize_seed_ids(&db)?;
        Ok(db)
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

    #[test]
    fn device_id_is_stable_across_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("zc.db");
        let a = Db::open(&path).unwrap().device_id().to_owned();
        let b = Db::open(&path).unwrap().device_id().to_owned();
        assert_eq!(a, b);
    }
}
