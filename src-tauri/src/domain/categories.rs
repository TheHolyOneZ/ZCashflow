use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::db::{new_id, now_rfc3339, Db};
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub system_key: Option<String>,
    pub kind: String,
    pub icon: Option<String>,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryInput {
    pub id: Option<String>,
    pub parent_id: Option<String>,
    pub name: String,
    pub kind: String,
    pub icon: Option<String>,
    pub color: Option<String>,
}

pub fn list(conn: &Connection) -> AppResult<Vec<Category>> {
    let mut stmt = conn.prepare(
        "SELECT id, parent_id, name, system_key, kind, icon, color
         FROM categories WHERE deleted = 0 ORDER BY kind DESC, created_at",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Category {
            id: r.get(0)?,
            parent_id: r.get(1)?,
            name: r.get(2)?,
            system_key: r.get(3)?,
            kind: r.get(4)?,
            icon: r.get(5)?,
            color: r.get(6)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn upsert(db: &Db, input: CategoryInput) -> AppResult<Category> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::Invalid("category name is required".into()));
    }
    let conn = db.conn();
    let hlc = db.hlc.tick();
    let id = match input.id {
        Some(id) => {
            let n = conn.execute(
                "UPDATE categories SET parent_id = ?2, name = ?3,
                        system_key = CASE WHEN name = ?3 THEN system_key ELSE NULL END,
                        kind = ?4, icon = ?5, color = ?6, updated_hlc = ?7
                 WHERE id = ?1 AND deleted = 0",
                params![id, input.parent_id, name, input.kind, input.icon, input.color, hlc],
            )?;
            if n == 0 {
                return Err(AppError::NotFound(format!("category {id}")));
            }
            id
        }
        None => {
            let id = new_id();
            conn.execute(
                "INSERT INTO categories (id, parent_id, name, kind, icon, color, created_at, device_id, updated_hlc)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    id, input.parent_id, name, input.kind, input.icon, input.color,
                    now_rfc3339(), db.device_id(), hlc
                ],
            )?;
            id
        }
    };
    list(&conn)?
        .into_iter()
        .find(|c| c.id == id)
        .ok_or_else(|| AppError::NotFound(format!("category {id}")))
}

pub fn delete(db: &Db, id: &str) -> AppResult<()> {
    let conn = db.conn();
    let hlc = db.hlc.tick();
    let n = conn.execute(
        "UPDATE categories SET deleted = 1, updated_hlc = ?2 WHERE id = ?1 AND deleted = 0",
        params![id, hlc],
    )?;
    if n == 0 {
        return Err(AppError::NotFound(format!("category {id}")));
    }
    conn.execute(
        "UPDATE categories SET parent_id = NULL, updated_hlc = ?2 WHERE parent_id = ?1",
        params![id, hlc],
    )?;
    Ok(())
}
