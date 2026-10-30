use rusqlite::{params, Connection, OptionalExtension};
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
         FROM categories WHERE deleted = 0 ORDER BY sort_order IS NULL, sort_order, kind DESC, created_at",
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

pub fn subtree(conn: &Connection, id: &str) -> AppResult<Vec<String>> {
    let mut stmt = conn.prepare_cached(
        "WITH RECURSIVE tree(id) AS (
             SELECT ?1
             UNION SELECT c.id FROM categories c JOIN tree ON c.parent_id = tree.id WHERE c.deleted = 0
         )
         SELECT id FROM tree",
    )?;
    let rows = stmt.query_map([id], |r| r.get(0))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn check_parent(conn: &Connection, id: Option<&str>, parent_id: Option<&str>) -> AppResult<()> {
    let Some(parent) = parent_id else { return Ok(()) };
    let exists: i64 = conn.query_row("SELECT count(*) FROM categories WHERE id = ?1 AND deleted = 0", [parent], |r| r.get(0))?;
    if exists == 0 {
        return Err(AppError::NotFound(format!("category {parent}")));
    }
    if let Some(id) = id {
        if subtree(conn, id)?.iter().any(|c| c == parent) {
            return Err(AppError::Invalid("a category cannot be moved into itself or one of its subcategories".into()));
        }
    }
    Ok(())
}

pub fn upsert(db: &Db, input: CategoryInput) -> AppResult<Category> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::Invalid("category name is required".into()));
    }
    let conn = db.conn();
    check_parent(&conn, input.id.as_deref(), input.parent_id.as_deref())?;
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

pub fn move_to(db: &Db, id: &str, parent_id: Option<&str>) -> AppResult<Category> {
    let conn = db.conn();
    check_parent(&conn, Some(id), parent_id)?;
    let n = conn.execute(
        "UPDATE categories SET parent_id = ?2, updated_hlc = ?3 WHERE id = ?1 AND deleted = 0",
        params![id, parent_id, db.hlc.tick()],
    )?;
    if n == 0 {
        return Err(AppError::NotFound(format!("category {id}")));
    }
    list(&conn)?
        .into_iter()
        .find(|c| c.id == id)
        .ok_or_else(|| AppError::NotFound(format!("category {id}")))
}

pub fn place(db: &Db, id: &str, parent_id: Option<&str>, order: &[String]) -> AppResult<Category> {
    if !order.iter().any(|o| o == id) {
        return Err(AppError::Invalid("the moved category must be part of the new order".into()));
    }
    let mut conn = db.conn();
    check_parent(&conn, Some(id), parent_id)?;
    let tx = conn.transaction()?;
    let hlc = db.hlc.tick();
    let n = tx.execute(
        "UPDATE categories SET parent_id = ?2, updated_hlc = ?3 WHERE id = ?1 AND deleted = 0 AND parent_id IS NOT ?2",
        params![id, parent_id, hlc],
    )?;
    let exists: i64 = tx.query_row("SELECT count(*) FROM categories WHERE id = ?1 AND deleted = 0", [id], |r| r.get(0))?;
    if n == 0 && exists == 0 {
        return Err(AppError::NotFound(format!("category {id}")));
    }
    for (i, sibling) in order.iter().enumerate() {
        tx.execute(
            "UPDATE categories SET sort_order = ?2, updated_hlc = ?3
             WHERE id = ?1 AND deleted = 0 AND parent_id IS ?4 AND sort_order IS NOT ?2",
            params![sibling, i as i64, hlc, parent_id],
        )?;
    }
    tx.commit()?;
    list(&conn)?
        .into_iter()
        .find(|c| c.id == id)
        .ok_or_else(|| AppError::NotFound(format!("category {id}")))
}

pub fn delete(db: &Db, id: &str) -> AppResult<()> {
    let conn = db.conn();
    let hlc = db.hlc.tick();
    let parent: Option<String> = conn
        .query_row("SELECT parent_id FROM categories WHERE id = ?1", [id], |r| r.get(0))
        .optional()?
        .flatten();
    let n = conn.execute(
        "UPDATE categories SET deleted = 1, updated_hlc = ?2 WHERE id = ?1 AND deleted = 0",
        params![id, hlc],
    )?;
    if n == 0 {
        return Err(AppError::NotFound(format!("category {id}")));
    }
    conn.execute(
        "UPDATE categories SET parent_id = ?3, updated_hlc = ?2 WHERE parent_id = ?1 AND deleted = 0",
        params![id, hlc, parent],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cat(db: &Db, name: &str, parent: Option<&str>) -> String {
        upsert(
            db,
            CategoryInput { id: None, parent_id: parent.map(str::to_owned), name: name.into(), kind: "expense".into(), icon: None, color: None },
        )
        .unwrap()
        .id
    }

    #[test]
    fn nests_deeply_and_refuses_cycles() {
        let db = Db::open_in_memory().unwrap();
        let a = cat(&db, "Wohnen", None);
        let b = cat(&db, "Nebenkosten", Some(&a));
        let c = cat(&db, "Strom", Some(&b));
        let d = cat(&db, "Zähler", Some(&c));
        assert_eq!(subtree(&db.conn(), &a).unwrap().len(), 4);
        assert!(move_to(&db, &a, Some(&d)).is_err(), "no cycles");
        assert!(move_to(&db, &b, Some(&b)).is_err(), "not into itself");
        let moved = move_to(&db, &c, None).unwrap();
        assert_eq!(moved.parent_id, None);
        assert_eq!(subtree(&db.conn(), &a).unwrap().len(), 2);
    }

    #[test]
    fn places_categories_in_the_chosen_order() {
        let db = Db::open_in_memory().unwrap();
        let a = cat(&db, "Büro", None);
        let x = cat(&db, "Tee", Some(&a));
        let y = cat(&db, "Strom", Some(&a));
        let z = cat(&db, "Papier", None);
        let names = |db: &Db| -> Vec<String> {
            list(&db.conn()).unwrap().into_iter().filter(|c| c.parent_id.as_deref() == Some(a.as_str())).map(|c| c.name).collect()
        };
        assert_eq!(names(&db), ["Tee", "Strom"]);
        place(&db, &y, Some(&a), &[y.clone(), x.clone()]).unwrap();
        assert_eq!(names(&db), ["Strom", "Tee"]);
        let moved = place(&db, &z, Some(&a), &[y.clone(), z.clone(), x.clone()]).unwrap();
        assert_eq!(moved.parent_id.as_deref(), Some(a.as_str()));
        assert_eq!(names(&db), ["Strom", "Papier", "Tee"]);
        let before = db.conn().query_row("SELECT updated_hlc FROM categories WHERE id = ?1", [&y], |r| r.get::<_, String>(0)).unwrap();
        place(&db, &z, Some(&a), &[y.clone(), z.clone(), x.clone()]).unwrap();
        let after = db.conn().query_row("SELECT updated_hlc FROM categories WHERE id = ?1", [&y], |r| r.get::<_, String>(0)).unwrap();
        assert_eq!(before, after, "unchanged rows are not sent to other devices again");
        assert!(place(&db, &a, Some(&x), std::slice::from_ref(&a)).is_err(), "no cycles");
        assert!(place(&db, &x, None, std::slice::from_ref(&y)).is_err(), "the moved category must be in the order");
    }

    #[test]
    fn deleting_keeps_children_under_the_grandparent() {
        let db = Db::open_in_memory().unwrap();
        let a = cat(&db, "Freizeit", None);
        let b = cat(&db, "Sport", Some(&a));
        let c = cat(&db, "Verein", Some(&b));
        delete(&db, &b).unwrap();
        let after = list(&db.conn()).unwrap();
        assert_eq!(after.iter().find(|x| x.id == c).unwrap().parent_id.as_deref(), Some(a.as_str()));
    }
}
