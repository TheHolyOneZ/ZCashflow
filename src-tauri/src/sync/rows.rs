use std::collections::HashMap;

use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{params_from_iter, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::db::Db;
use crate::error::{AppError, AppResult};

pub const TABLES: &[(&str, &str)] = &[
    ("accounts", "id"),
    ("account_balance_anchors", "account_id"),
    ("categories", "id"),
    ("counterparties", "id"),
    ("recurring_rules", "id"),
    ("debts", "id"),
    ("goals", "id"),
    ("budgets", "id"),
    ("transactions", "id"),
    ("notes", "id"),
    ("attachments", "id"),
    ("recurring_skips", "occurrence_key"),
    ("goal_allocations", "id"),
];

fn pk_of(tbl: &str) -> Option<&'static str> {
    TABLES.iter().find(|(t, _)| *t == tbl).map(|(_, pk)| *pk)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RowChange {
    pub tbl: String,
    pub row: Map<String, Value>,
}

fn to_json(v: ValueRef) -> Value {
    match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => Value::from(i),
        ValueRef::Real(f) => Value::from(f),
        ValueRef::Text(t) => Value::from(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(_) => Value::Null,
    }
}

fn to_sql(v: &Value) -> SqlValue {
    match v {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(i64::from(*b)),
        Value::Number(n) => n.as_i64().map(SqlValue::Integer).unwrap_or_else(|| SqlValue::Real(n.as_f64().unwrap_or(0.0))),
        Value::String(s) => SqlValue::Text(s.clone()),
        other => SqlValue::Text(other.to_string()),
    }
}

pub fn max_seq(conn: &Connection) -> AppResult<i64> {
    Ok(conn.query_row("SELECT coalesce(max(seq), 0) FROM sync_changes", [], |r| r.get(0))?)
}

pub fn changes_since(conn: &Connection, since: i64, limit: usize) -> AppResult<(Vec<RowChange>, i64, bool)> {
    let entries: Vec<(i64, String, String)> = conn
        .prepare("SELECT seq, tbl, row_id FROM sync_changes WHERE seq > ?1 ORDER BY seq LIMIT ?2")?
        .query_map(rusqlite::params![since, limit as i64 + 1], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<Result<_, _>>()?;
    let more = entries.len() > limit;
    let mut upto = since;
    let mut rows = Vec::new();
    for (seq, tbl, row_id) in entries.into_iter().take(limit) {
        upto = seq;
        let Some(pk) = pk_of(&tbl) else { continue };
        let mut stmt = conn.prepare_cached(&format!("SELECT * FROM {tbl} WHERE {pk} = ?1"))?;
        let names: Vec<String> = stmt.column_names().into_iter().map(str::to_owned).collect();
        let row = stmt
            .query_row([&row_id], |r| {
                let mut m = Map::new();
                for (i, n) in names.iter().enumerate() {
                    m.insert(n.clone(), to_json(r.get_ref(i)?));
                }
                Ok(m)
            })
            .optional()?;
        if let Some(row) = row {
            rows.push(RowChange { tbl, row });
        }
    }
    Ok((rows, upto, more))
}

#[derive(Debug, Default, Clone, Serialize)]
pub struct ApplyStats {
    pub applied: usize,
    pub skipped: usize,
}

fn columns(conn: &Connection, tbl: &str, cache: &mut HashMap<String, Vec<String>>) -> AppResult<Vec<String>> {
    if let Some(c) = cache.get(tbl) {
        return Ok(c.clone());
    }
    let cols: Vec<String> = conn
        .prepare(&format!("PRAGMA table_info({tbl})"))?
        .query_map([], |r| r.get::<_, String>(1))?
        .collect::<Result<_, _>>()?;
    cache.insert(tbl.to_owned(), cols.clone());
    Ok(cols)
}

fn upsert(conn: &Connection, tbl: &str, pk: &str, row: &Map<String, Value>, cols: &[String]) -> rusqlite::Result<usize> {
    let used: Vec<&String> = cols.iter().filter(|c| row.contains_key(c.as_str())).collect();
    let names = used.iter().map(|c| c.as_str()).collect::<Vec<_>>().join(", ");
    let marks = (1..=used.len()).map(|i| format!("?{i}")).collect::<Vec<_>>().join(", ");
    let updates = used
        .iter()
        .filter(|c| c.as_str() != pk)
        .map(|c| format!("{c} = excluded.{c}"))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!("INSERT INTO {tbl} ({names}) VALUES ({marks}) ON CONFLICT({pk}) DO UPDATE SET {updates}");
    conn.execute(&sql, params_from_iter(used.iter().map(|c| to_sql(&row[c.as_str()]))))
}

pub fn apply(db: &Db, changes: &[RowChange], only: Option<&[&str]>) -> AppResult<ApplyStats> {
    let mut conn = db.conn();
    let tx = conn.transaction()?;
    tx.pragma_update(None, "defer_foreign_keys", "ON")?;
    let mut cache = HashMap::new();
    let mut stats = ApplyStats::default();

    let mut ordered: Vec<&RowChange> = changes.iter().collect();
    ordered.sort_by_key(|c| TABLES.iter().position(|(t, _)| *t == c.tbl).unwrap_or(usize::MAX));

    for change in ordered {
        let Some(pk) = pk_of(&change.tbl) else {
            stats.skipped += 1;
            continue;
        };
        if only.is_some_and(|o| !o.contains(&change.tbl.as_str())) {
            stats.skipped += 1;
            continue;
        }
        let (Some(Value::String(id)), Some(Value::String(incoming))) = (change.row.get(pk), change.row.get("updated_hlc")) else {
            stats.skipped += 1;
            continue;
        };
        let local: Option<String> = tx
            .query_row(&format!("SELECT updated_hlc FROM {} WHERE {pk} = ?1", change.tbl), [id], |r| r.get(0))
            .optional()?;
        if local.as_deref().is_some_and(|l| l >= incoming.as_str()) {
            stats.skipped += 1;
            continue;
        }
        db.hlc.observe(incoming);
        let cols = columns(&tx, &change.tbl, &mut cache)?;
        match upsert(&tx, &change.tbl, pk, &change.row, &cols) {
            Ok(_) => {}

            Err(rusqlite::Error::SqliteFailure(e, Some(msg)))
                if e.code == rusqlite::ErrorCode::ConstraintViolation && msg.contains("occurrence_key") =>
            {
                tx.execute(
                    "UPDATE transactions SET occurrence_key = NULL, deleted = 1, updated_hlc = ?2
                     WHERE occurrence_key = ?1 AND id <> ?3",
                    rusqlite::params![change.row.get("occurrence_key").and_then(Value::as_str), db.hlc.tick(), id],
                )?;
                upsert(&tx, &change.tbl, pk, &change.row, &cols)?;
            }
            Err(e) => return Err(AppError::Db(e)),
        }
        stats.applied += 1;
    }
    tx.commit()?;
    Ok(stats)
}

pub fn missing_blobs(db: &Db) -> AppResult<Vec<String>> {
    let shas: Vec<String> = db
        .conn()
        .prepare("SELECT DISTINCT sha256 FROM attachments WHERE deleted = 0")?
        .query_map([], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    Ok(shas.into_iter().filter(|s| !crate::domain::attachments::original_path(db, s).exists()).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{accounts, transactions};

    fn expense(db: &Db, title: &str) -> transactions::Transaction {
        let acc = accounts::list(&db.conn()).unwrap()[0].id.clone();
        transactions::create(
            db,
            transactions::TransactionInput {
                kind: "expense".into(),
                amount_minor: 500,
                currency: None,
                occurred_on: "2026-10-08".into(),
                occurred_time: None,
                account_id: acc,
                to_account_id: None,
                category_id: None,
                counterparty: Some("Bäckerei".into()),
                title: title.into(),
                note: None,
                tags: vec![],
                debt_id: None,
                goal_id: None,
            },
        )
        .unwrap()
    }

    fn sync(from: &Db, to: &Db, cursor: &mut i64) -> ApplyStats {
        let (rows, upto, _) = changes_since(&from.conn(), *cursor, 10_000).unwrap();
        *cursor = upto;
        apply(to, &rows, None).unwrap()
    }

    #[test]
    fn two_devices_converge() {
        let a = Db::open_in_memory().unwrap();
        let b = Db::open_in_memory().unwrap();

        let (mut ca, mut cb) = (0, 0);
        sync(&a, &b, &mut ca);
        sync(&b, &a, &mut cb);
        assert_eq!(accounts::list(&a.conn()).unwrap().len(), 1, "seeded cash account merged, not duplicated");

        let t = expense(&a, "Brötchen");
        sync(&a, &b, &mut ca);
        let on_b = transactions::get(&b.conn(), &t.id).unwrap();
        assert_eq!(on_b.title, "Brötchen");
        assert_eq!(on_b.counterparty_name.as_deref(), Some("Bäckerei"));

        let mut input_a = transactions::TransactionInput {
            kind: "expense".into(),
            amount_minor: 600,
            currency: None,
            occurred_on: "2026-10-08".into(),
            occurred_time: None,
            account_id: t.account_id.clone(),
            to_account_id: None,
            category_id: None,
            counterparty: None,
            title: "A edit".into(),
            note: None,
            tags: vec![],
            debt_id: None,
            goal_id: None,
        };
        transactions::update(&a, &t.id, input_a.clone()).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        input_a.title = "B edit".into();
        transactions::update(&b, &t.id, input_a).unwrap();
        sync(&a, &b, &mut ca);
        sync(&b, &a, &mut cb);
        assert_eq!(transactions::get(&a.conn(), &t.id).unwrap().title, "B edit");
        assert_eq!(transactions::get(&b.conn(), &t.id).unwrap().title, "B edit");

        transactions::delete(&a, &t.id).unwrap();
        sync(&a, &b, &mut ca);
        assert!(transactions::get(&b.conn(), &t.id).is_err());

        let stats = sync(&b, &a, &mut cb);
        assert_eq!(stats.applied, 0);
    }

    #[test]
    fn edits_from_older_versions_keep_the_time() {
        let a = Db::open_in_memory().unwrap();
        let t = expense(&a, "Kaffee");
        a.conn()
            .execute("UPDATE transactions SET occurred_time = '09:15', updated_hlc = ?1 WHERE id = ?2", rusqlite::params![a.hlc.tick(), t.id])
            .unwrap();
        let (rows, _, _) = changes_since(&a.conn(), 0, 10_000).unwrap();
        let mut old = rows.into_iter().find(|r| r.tbl == "transactions").unwrap();
        old.row.remove("occurred_time");
        old.row.insert("title".into(), Value::from("Kaffee groß"));
        old.row.insert("updated_hlc".into(), Value::from(a.hlc.tick()));
        old.row.insert("column_from_the_future".into(), Value::from(1));
        assert_eq!(apply(&a, &[old], None).unwrap().applied, 1);
        let now = transactions::get(&a.conn(), &t.id).unwrap();
        assert_eq!((now.title.as_str(), now.occurred_time.as_deref()), ("Kaffee groß", Some("09:15")));
    }

    #[test]
    fn capture_peers_only_deliver_receipts() {
        let a = Db::open_in_memory().unwrap();
        let b = Db::open_in_memory().unwrap();
        expense(&a, "nope");
        a.conn()
            .execute(
                "INSERT INTO attachments (id, sha256, mime, created_at, device_id, updated_hlc)
                 VALUES ('att1', 'abc', 'image/jpeg', '2026-10-08', 'a', ?1)",
                [a.hlc.tick()],
            )
            .unwrap();
        let (rows, _, _) = changes_since(&a.conn(), 0, 10_000).unwrap();
        apply(&b, &rows, Some(&["attachments"])).unwrap();
        assert!(transactions::list(&b.conn(), &Default::default()).unwrap().is_empty());
        assert_eq!(missing_blobs(&b).unwrap(), vec!["abc".to_string()]);
    }

    #[test]
    fn same_recurring_occurrence_on_two_devices_is_one_row() {
        use crate::domain::recurring::{materialize_due, upsert, RecurringInput};
        let a = Db::open_in_memory().unwrap();
        let b = Db::open_in_memory().unwrap();
        let today = chrono::NaiveDate::from_ymd_opt(2026, 10, 8).unwrap();
        let acc = accounts::list(&a.conn()).unwrap()[0].id.clone();
        let rule = upsert(
            &a,
            RecurringInput {
                id: None,
                title: "Miete".into(),
                kind: "expense".into(),
                amount_minor: 80_000,
                account_id: acc,
                to_account_id: None,
                category_id: None,
                counterparty: None,
                freq: "monthly".into(),
                interval_n: 1,
                start_on: "2026-10-08".into(),
                end_on: None,
                max_count: None,
                auto_post: true,
                backfill: false,
                occurred_time: None,
                note: None,
            },
            today,
        )
        .unwrap();

        let (rows, _, _) = changes_since(&a.conn(), 0, 10_000).unwrap();
        let rule_only: Vec<_> = rows.into_iter().filter(|r| r.tbl != "transactions").collect();
        apply(&b, &rule_only, None).unwrap();
        materialize_due(&b, today).unwrap();
        let (mut ca, mut cb) = (0, 0);
        sync(&a, &b, &mut ca);
        sync(&b, &a, &mut cb);
        for db in [&a, &b] {
            let n = transactions::list(&db.conn(), &Default::default())
                .unwrap()
                .iter()
                .filter(|t| t.recurring_rule_id.as_deref() == Some(rule.id.as_str()))
                .count();
            assert_eq!(n, 1);
        }
    }
}
