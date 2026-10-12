use rusqlite::params;

use super::{det_id, get_meta, now_rfc3339, set_meta, Db};
use crate::error::AppResult;

const CATEGORIES: &[(&str, &str, &str, &str)] = &[
    ("category.groceries", "expense", "shopping-basket", "#16a34a"),
    ("category.food", "expense", "utensils", "#ea580c"),
    ("category.housing", "expense", "house", "#2563eb"),
    ("category.utilities", "expense", "plug", "#0891b2"),
    ("category.transport", "expense", "bus", "#7c3aed"),
    ("category.subscriptions", "expense", "repeat", "#db2777"),
    ("category.shopping", "expense", "shopping-bag", "#ca8a04"),
    ("category.health", "expense", "heart-pulse", "#dc2626"),
    ("category.leisure", "expense", "gamepad-2", "#9333ea"),
    ("category.other_expense", "expense", "circle-dashed", "#64748b"),
    ("category.salary", "income", "briefcase", "#059669"),
    ("category.other_income", "income", "coins", "#0d9488"),
];

pub fn seed_defaults(db: &Db) -> AppResult<()> {
    let conn = db.conn();
    if get_meta(&conn, "seeded")?.is_some() {
        return Ok(());
    }
    let now = now_rfc3339();
    let device = db.device_id();

    conn.execute(
        "INSERT INTO accounts (id, name, system_key, kind, currency, created_at, device_id, updated_hlc)
         VALUES (?1, 'Cash', 'account.cash', 'cash', 'EUR', ?2, ?3, ?4)",
        params![det_id("seed", "account.cash"), now, device, db.hlc.tick()],
    )?;
    for (key, kind, icon, color) in CATEGORIES {
        conn.execute(
            "INSERT INTO categories (id, name, system_key, kind, icon, color, created_at, device_id, updated_hlc)
             VALUES (?1, ?2, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![det_id("seed", key), key, kind, icon, color, now, device, db.hlc.tick()],
        )?;
    }
    set_meta(&conn, "default_currency", "EUR")?;
    set_meta(&conn, "seeded", "1")?;
    Ok(())
}

pub fn normalize_seed_ids(db: &Db) -> AppResult<()> {
    let conn = db.conn();
    if get_meta(&conn, "seed_ids_v2")?.is_some() {
        return Ok(());
    }

    let plan: &[(&str, &[(&str, &str)])] = &[
        (
            "accounts",
            &[
                ("transactions", "account_id"),
                ("transactions", "to_account_id"),
                ("recurring_rules", "account_id"),
                ("recurring_rules", "to_account_id"),
                ("goals", "account_id"),
            ],
        ),
        (
            "categories",
            &[
                ("categories", "parent_id"),
                ("transactions", "category_id"),
                ("recurring_rules", "category_id"),
                ("budgets", "category_id"),
            ],
        ),
    ];
    conn.pragma_update(None, "foreign_keys", "OFF")?;
    let result = (|| -> AppResult<()> {
        let tx = conn.unchecked_transaction()?;
        for (table, refs) in plan {
            let rows: Vec<(String, String)> = tx
                .prepare(&format!("SELECT id, system_key FROM {table} WHERE system_key IS NOT NULL"))?
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
                .collect::<Result<_, _>>()?;
            for (old, key) in rows {
                let new = det_id("seed", &key);
                if old == new {
                    continue;
                }
                let taken: i64 = tx.query_row(&format!("SELECT count(*) FROM {table} WHERE id = ?1"), [&new], |r| r.get(0))?;
                if taken > 0 {
                    continue;
                }
                for (rt, rc) in *refs {
                    tx.execute(&format!("UPDATE {rt} SET {rc} = ?2 WHERE {rc} = ?1"), [&old, &new])?;
                }
                tx.execute(&format!("UPDATE {table} SET id = ?2 WHERE id = ?1"), [&old, &new])?;
                tx.execute("DELETE FROM sync_changes WHERE row_id = ?1", [&old])?;
            }
        }
        set_meta(&tx, "seed_ids_v2", "1")?;
        tx.commit()?;
        Ok(())
    })();
    conn.pragma_update(None, "foreign_keys", "ON")?;
    result
}
