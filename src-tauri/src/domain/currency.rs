use rusqlite::{params, Connection};
use serde::Serialize;

use super::export::minor_digits;
use crate::db::{get_meta, set_meta, Db};
use crate::error::{AppError, AppResult};

const TABLES: &[&str] = &["accounts", "transactions", "recurring_rules", "budgets", "goals", "debts"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Relabeled {
    pub accounts: usize,
    pub rows: usize,
}

pub fn main_currency(conn: &Connection) -> AppResult<String> {
    let stored = get_meta(conn, "default_currency")?.unwrap_or_else(|| "EUR".into());
    let used: Vec<String> = conn
        .prepare(
            "SELECT currency FROM accounts WHERE deleted = 0 AND archived = 0
             GROUP BY currency ORDER BY count(*) DESC, currency",
        )?
        .query_map([], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    Ok(match used.first() {
        Some(top) if !used.contains(&stored) => top.clone(),
        _ => stored,
    })
}

fn code(s: &str) -> AppResult<String> {
    let c = s.trim().to_uppercase();
    if c.len() == 3 && c.chars().all(|ch| ch.is_ascii_alphabetic()) {
        Ok(c)
    } else {
        Err(AppError::Invalid(format!("invalid currency {s:?}")))
    }
}

pub fn relabel(db: &Db, from: &str, to: &str) -> AppResult<Relabeled> {
    let (from, to) = (code(from)?, code(to)?);
    if from == to {
        return Err(AppError::Invalid("currencies are the same".into()));
    }
    if minor_digits(&from) != minor_digits(&to) {
        return Err(AppError::Unsupported("currency_decimals".into()));
    }
    let mut conn = db.conn();
    let tx = conn.transaction()?;
    let hlc = db.hlc.tick();
    let mut out = Relabeled { accounts: 0, rows: 0 };
    for table in TABLES {
        let n = tx.execute(
            &format!("UPDATE {table} SET currency = ?2, updated_hlc = ?3 WHERE currency = ?1 AND deleted = 0"),
            params![from, to, hlc],
        )?;
        if *table == "accounts" {
            out.accounts = n;
        }
        out.rows += n;
    }
    set_meta(&tx, "default_currency", &to)?;
    tx.commit()?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{accounts, transactions};

    #[test]
    fn switches_accounts_and_entries_without_touching_amounts() {
        let db = Db::open_in_memory().unwrap();
        crate::domain::demo::load(&db, chrono::NaiveDate::from_ymd_opt(2026, 10, 8).unwrap()).unwrap();
        let before: i64 = accounts::list(&db.conn()).unwrap().iter().map(|a| a.balance_minor).sum();
        let r = relabel(&db, "eur", "LKR").unwrap();
        assert!(r.accounts > 0 && r.rows > r.accounts);
        let conn = db.conn();
        let all = accounts::list(&conn).unwrap();
        assert!(all.iter().all(|a| a.currency == "LKR"));
        assert_eq!(all.iter().map(|a| a.balance_minor).sum::<i64>(), before);
        let txs = transactions::list(&conn, &transactions::TransactionFilter { limit: Some(5000), ..Default::default() }).unwrap();
        assert!(txs.iter().all(|t| t.currency == "LKR"));
        assert_eq!(crate::db::get_meta(&conn, "default_currency").unwrap().as_deref(), Some("LKR"));
        drop(conn);
        assert!(matches!(relabel(&db, "LKR", "JPY"), Err(AppError::Unsupported(_))));
        assert!(relabel(&db, "LKR", "lkr").is_err());
        assert!(relabel(&db, "LKR", "12").is_err());
    }

    #[test]
    fn main_currency_follows_the_accounts_when_the_default_is_unused() {
        let db = Db::open_in_memory().unwrap();
        assert_eq!(main_currency(&db.conn()).unwrap(), "EUR");
        set_meta(&db.conn(), "default_currency", "USD").unwrap();
        assert_eq!(main_currency(&db.conn()).unwrap(), "EUR", "only EUR accounts exist");
        accounts::upsert(
            &db,
            accounts::AccountInput { id: None, name: "Card".into(), kind: "credit".into(), currency: "usd".into(), opening_minor: 0, color: None, archived: false },
        )
        .unwrap();
        assert_eq!(main_currency(&db.conn()).unwrap(), "USD", "the chosen default wins once an account uses it");
    }
}
