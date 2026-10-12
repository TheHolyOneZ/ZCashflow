use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};

use crate::db::{new_id, now_rfc3339, Db};
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub name: String,
    pub system_key: Option<String>,
    pub kind: String,
    pub currency: String,
    pub opening_minor: i64,
    pub balance_minor: i64,
    pub color: Option<String>,
    pub archived: bool,
    pub anchor_on: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountInput {
    pub id: Option<String>,
    pub name: String,
    pub kind: String,
    pub currency: String,
    pub opening_minor: i64,
    pub color: Option<String>,
    #[serde(default)]
    pub archived: bool,
}

const SELECT: &str = "
    SELECT a.id, a.name, a.system_key, a.kind, a.currency, a.opening_minor, a.color, a.archived,
           CASE WHEN a.anchor_at IS NULL THEN a.opening_minor ELSE a.anchor_minor END + coalesce((
               SELECT sum(CASE
                   WHEN t.kind = 'income'   AND t.account_id    = a.id THEN t.amount_minor
                   WHEN t.kind = 'expense'  AND t.account_id    = a.id THEN -t.amount_minor
                   WHEN t.kind = 'transfer' AND t.account_id    = a.id THEN -t.amount_minor
                   WHEN t.kind = 'transfer' AND t.to_account_id = a.id THEN t.amount_minor
                   ELSE 0 END)
               FROM transactions t
               WHERE t.deleted = 0 AND (t.account_id = a.id OR t.to_account_id = a.id)
                 AND (a.anchor_at IS NULL
                      OR t.occurred_on > a.anchor_on
                      OR (t.occurred_on = a.anchor_on AND t.created_at > a.anchor_at))
           ), 0) AS balance,
           a.anchor_on
    FROM accounts a
    WHERE a.deleted = 0";

fn from_row(r: &Row) -> rusqlite::Result<Account> {
    Ok(Account {
        id: r.get(0)?,
        name: r.get(1)?,
        system_key: r.get(2)?,
        kind: r.get(3)?,
        currency: r.get(4)?,
        opening_minor: r.get(5)?,
        color: r.get(6)?,
        archived: r.get(7)?,
        balance_minor: r.get(8)?,
        anchor_on: r.get(9)?,
    })
}

pub fn list(conn: &Connection) -> AppResult<Vec<Account>> {
    let mut stmt = conn.prepare(&format!("{SELECT} ORDER BY a.archived, a.created_at"))?;
    let rows = stmt.query_map([], from_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Account> {
    conn.query_row(&format!("{SELECT} AND a.id = ?1"), [id], from_row)
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("account {id}")),
            e => e.into(),
        })
}

pub fn upsert(db: &Db, input: AccountInput) -> AppResult<Account> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::Invalid("account name is required".into()));
    }
    let currency = input.currency.trim().to_uppercase();
    if currency.len() != 3 {
        return Err(AppError::Invalid(format!("invalid currency code {currency:?}")));
    }
    let conn = db.conn();
    let hlc = db.hlc.tick();
    let id = match input.id {
        Some(id) => {
            let n = conn.execute(
                "UPDATE accounts SET name = ?2, system_key = NULL, kind = ?3, currency = ?4,
                        opening_minor = ?5, color = ?6, archived = ?7, updated_hlc = ?8
                 WHERE id = ?1 AND deleted = 0",
                params![id, name, input.kind, currency, input.opening_minor, input.color, input.archived, hlc],
            )?;
            if n == 0 {
                return Err(AppError::NotFound(format!("account {id}")));
            }
            id
        }
        None => {
            let id = new_id();
            conn.execute(
                "INSERT INTO accounts (id, name, kind, currency, opening_minor, color, archived,
                                       created_at, device_id, updated_hlc)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    id, name, input.kind, currency, input.opening_minor, input.color,
                    input.archived, now_rfc3339(), db.device_id(), hlc
                ],
            )?;
            id
        }
    };
    get(&conn, &id)
}

pub fn set_balance(db: &Db, id: &str, balance_minor: i64, today: &str) -> AppResult<Account> {
    chrono::NaiveDate::parse_from_str(today, "%Y-%m-%d").map_err(|_| AppError::Invalid(format!("invalid date {today:?}")))?;
    let conn = db.conn();
    let n = conn.execute(
        "UPDATE accounts SET anchor_minor = ?2, anchor_on = ?3, anchor_at = ?4, updated_hlc = ?5
         WHERE id = ?1 AND deleted = 0",
        params![id, balance_minor, today, now_rfc3339(), db.hlc.tick()],
    )?;
    if n == 0 {
        return Err(AppError::NotFound(format!("account {id}")));
    }
    get(&conn, id)
}

pub fn delete(db: &Db, id: &str) -> AppResult<()> {
    let conn = db.conn();
    let used: i64 = conn.query_row(
        "SELECT count(*) FROM transactions WHERE deleted = 0 AND (account_id = ?1 OR to_account_id = ?1)",
        [id],
        |r| r.get(0),
    )?;
    if used > 0 {
        return Err(AppError::Invalid("account has transactions; archive it instead".into()));
    }
    let n = conn.execute(
        "UPDATE accounts SET deleted = 1, updated_hlc = ?2 WHERE id = ?1 AND deleted = 0",
        params![id, db.hlc.tick()],
    )?;
    if n == 0 {
        return Err(AppError::NotFound(format!("account {id}")));
    }
    Ok(())
}
