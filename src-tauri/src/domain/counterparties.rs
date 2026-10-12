use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::db::{det_id, now_rfc3339, Db};
use crate::error::AppResult;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Counterparty {
    pub id: String,
    pub name: String,
    pub kind: String,
}

pub fn list(conn: &Connection) -> AppResult<Vec<Counterparty>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, kind FROM counterparties WHERE deleted = 0 ORDER BY name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], |r| Ok(Counterparty { id: r.get(0)?, name: r.get(1)?, kind: r.get(2)? }))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn find_or_create(db: &Db, conn: &Connection, name: &str) -> AppResult<Option<String>> {
    let name = name.trim();
    if name.is_empty() {
        return Ok(None);
    }
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM counterparties WHERE deleted = 0 AND name = ?1 COLLATE NOCASE",
            [name],
            |r| r.get(0),
        )
        .optional()?;
    if existing.is_some() {
        return Ok(existing);
    }

    let id = det_id("counterparty", &name.to_lowercase());
    conn.execute(
        "INSERT INTO counterparties (id, name, created_at, device_id, updated_hlc)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET deleted = 0, name = excluded.name, updated_hlc = excluded.updated_hlc",
        params![id, name, now_rfc3339(), db.device_id(), db.hlc.tick()],
    )?;
    Ok(Some(id))
}
