use chrono::{Datelike, Duration, Months, NaiveDate};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::db::{new_id, now_rfc3339, Db};
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Goal {
    pub id: String,
    pub title: String,
    pub target_minor: i64,
    pub currency: String,
    pub target_on: Option<String>,
    pub account_id: Option<String>,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub note: Option<String>,
    pub archived: bool,
    pub saved_minor: i64,
    pub remaining_minor: i64,
    pub progress: f64,
    pub months_left: Option<i64>,

    pub monthly_needed_minor: Option<i64>,

    pub avg_monthly_minor: i64,

    pub projected_on: Option<String>,
    pub on_track: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalInput {
    pub id: Option<String>,
    pub title: String,
    pub target_minor: i64,
    pub currency: Option<String>,
    pub target_on: Option<String>,
    pub account_id: Option<String>,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub note: Option<String>,
    #[serde(default)]
    pub archived: bool,

    pub initial_minor: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Allocation {
    pub id: String,
    pub goal_id: String,
    pub amount_minor: i64,
    pub occurred_on: String,
    pub note: Option<String>,
}

const SELECT: &str = "
    SELECT g.id, g.title, g.target_minor, g.currency, g.target_on, g.account_id, g.color, g.icon,
           g.note, g.archived,
           coalesce((SELECT sum(amount_minor) FROM goal_allocations a WHERE a.goal_id = g.id AND a.deleted = 0), 0),
           coalesce((SELECT sum(amount_minor) FROM goal_allocations a
                     WHERE a.goal_id = g.id AND a.deleted = 0 AND a.occurred_on > ?1), 0)
    FROM goals g
    WHERE g.deleted = 0";

pub fn months_until(from: NaiveDate, to: NaiveDate) -> i64 {
    if to <= from {
        return 0;
    }
    let mut months = (to.year() - from.year()) as i64 * 12 + to.month() as i64 - from.month() as i64;
    if to.day() < from.day() {
        months -= 1;
    }
    months.max(1)
}

fn from_row(r: &Row, today: NaiveDate) -> rusqlite::Result<Goal> {
    let target: i64 = r.get(2)?;
    let saved: i64 = r.get(10)?;
    let last_90: i64 = r.get(11)?;
    let target_on: Option<String> = r.get(4)?;
    let remaining = (target - saved).max(0);
    let avg_monthly = last_90 / 3;

    let target_date = target_on.as_deref().and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());
    let months_left = target_date.map(|t| months_until(today, t));
    let monthly_needed = months_left.map(|m| if m == 0 { remaining } else { (remaining + m - 1) / m });
    let projected = if remaining == 0 {
        Some(today)
    } else if avg_monthly > 0 {
        let months = (remaining + avg_monthly - 1) / avg_monthly;
        today.checked_add_months(Months::new(months.min(1200) as u32))
    } else {
        None
    };
    let on_track = match (target_date, remaining) {
        (_, 0) => Some(true),
        (Some(t), _) => Some(projected.is_some_and(|p| p <= t)),
        (None, _) => None,
    };

    Ok(Goal {
        id: r.get(0)?,
        title: r.get(1)?,
        target_minor: target,
        currency: r.get(3)?,
        target_on,
        account_id: r.get(5)?,
        color: r.get(6)?,
        icon: r.get(7)?,
        note: r.get(8)?,
        archived: r.get(9)?,
        saved_minor: saved,
        remaining_minor: remaining,
        progress: if target > 0 { (saved as f64 / target as f64).clamp(0.0, 1.0) } else { 0.0 },
        months_left,
        monthly_needed_minor: monthly_needed,
        avg_monthly_minor: avg_monthly,
        projected_on: projected.map(|d| d.to_string()),
        on_track,
    })
}

pub fn list(conn: &Connection, today: NaiveDate) -> AppResult<Vec<Goal>> {
    let since = (today - Duration::days(90)).to_string();
    let mut stmt = conn.prepare(&format!("{SELECT} ORDER BY g.archived, g.target_on IS NULL, g.target_on, g.created_at"))?;
    let rows = stmt.query_map([since], |r| from_row(r, today))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn get(conn: &Connection, id: &str, today: NaiveDate) -> AppResult<Goal> {
    let since = (today - Duration::days(90)).to_string();
    conn.query_row(&format!("{SELECT} AND g.id = ?2"), params![since, id], |r| from_row(r, today))
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("goal {id}")))
}

pub fn upsert(db: &Db, input: GoalInput, today: NaiveDate) -> AppResult<Goal> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err(AppError::Invalid("title is required".into()));
    }
    if input.target_minor <= 0 {
        return Err(AppError::Invalid("target must be positive".into()));
    }
    if let Some(t) = &input.target_on {
        NaiveDate::parse_from_str(t, "%Y-%m-%d").map_err(|_| AppError::Invalid("invalid target date".into()))?;
    }
    let mut conn = db.conn();
    let tx = conn.transaction()?;
    let currency = match &input.currency {
        Some(c) if !c.trim().is_empty() => c.trim().to_uppercase(),
        _ => super::currency::main_currency(&tx)?,
    };
    let hlc = db.hlc.tick();
    let id = match &input.id {
        Some(id) => {
            let n = tx.execute(
                "UPDATE goals SET title = ?2, target_minor = ?3, currency = ?4, target_on = ?5,
                        account_id = ?6, color = ?7, icon = ?8, note = ?9, archived = ?10, updated_hlc = ?11
                 WHERE id = ?1 AND deleted = 0",
                params![
                    id, title, input.target_minor, currency, input.target_on, input.account_id,
                    input.color, input.icon, input.note, input.archived, hlc
                ],
            )?;
            if n == 0 {
                return Err(AppError::NotFound(format!("goal {id}")));
            }
            id.clone()
        }
        None => {
            let id = new_id();
            tx.execute(
                "INSERT INTO goals (id, title, target_minor, currency, target_on, account_id, color,
                        icon, note, archived, created_at, device_id, updated_hlc)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                params![
                    id, title, input.target_minor, currency, input.target_on, input.account_id,
                    input.color, input.icon, input.note, input.archived, now_rfc3339(),
                    db.device_id(), hlc
                ],
            )?;
            if let Some(initial) = input.initial_minor.filter(|v| *v > 0) {
                insert_allocation(db, &tx, &id, initial, &today.to_string(), None)?;
            }
            id
        }
    };
    tx.commit()?;
    get(&conn, &id, today)
}

fn insert_allocation(
    db: &Db,
    conn: &Connection,
    goal_id: &str,
    amount_minor: i64,
    on: &str,
    note: Option<&str>,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO goal_allocations (id, goal_id, amount_minor, occurred_on, note, created_at, device_id, updated_hlc)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![new_id(), goal_id, amount_minor, on, note, now_rfc3339(), db.device_id(), db.hlc.tick()],
    )?;
    Ok(())
}

pub fn allocate(
    db: &Db,
    goal_id: &str,
    amount_minor: i64,
    on: &str,
    note: Option<String>,
    today: NaiveDate,
) -> AppResult<Goal> {
    if amount_minor == 0 {
        return Err(AppError::Invalid("amount must not be zero".into()));
    }
    NaiveDate::parse_from_str(on, "%Y-%m-%d").map_err(|_| AppError::Invalid("invalid date".into()))?;
    let conn = db.conn();
    get(&conn, goal_id, today)?;
    insert_allocation(db, &conn, goal_id, amount_minor, on, note.as_deref())?;
    get(&conn, goal_id, today)
}

pub fn allocations(conn: &Connection, goal_id: &str) -> AppResult<Vec<Allocation>> {
    let mut stmt = conn.prepare(
        "SELECT id, goal_id, amount_minor, occurred_on, note FROM goal_allocations
         WHERE goal_id = ?1 AND deleted = 0 ORDER BY occurred_on DESC, created_at DESC",
    )?;
    let rows = stmt.query_map([goal_id], |r| {
        Ok(Allocation {
            id: r.get(0)?,
            goal_id: r.get(1)?,
            amount_minor: r.get(2)?,
            occurred_on: r.get(3)?,
            note: r.get(4)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn delete(db: &Db, id: &str) -> AppResult<()> {
    let n = db.conn().execute(
        "UPDATE goals SET deleted = 1, updated_hlc = ?2 WHERE id = ?1 AND deleted = 0",
        params![id, db.hlc.tick()],
    )?;
    if n == 0 {
        return Err(AppError::NotFound(format!("goal {id}")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn months_until_counts_whole_months() {
        assert_eq!(months_until(d("2026-10-08"), d("2027-10-08")), 12);
        assert_eq!(months_until(d("2026-10-08"), d("2027-10-07")), 11);
        assert_eq!(months_until(d("2026-10-08"), d("2026-10-20")), 1);
        assert_eq!(months_until(d("2026-10-08"), d("2026-10-01")), 0);
    }

    #[test]
    fn plan_and_projection() {
        let db = Db::open_in_memory().unwrap();
        let today = d("2026-10-08");
        let g = upsert(
            &db,
            GoalInput {
                id: None,
                title: "Urlaub Japan".into(),
                target_minor: 300_000,
                currency: None,
                target_on: Some("2027-10-08".into()),
                account_id: None,
                color: None,
                icon: None,
                note: None,
                archived: false,
                initial_minor: Some(60_000),
            },
            today,
        )
        .unwrap();
        assert_eq!(g.saved_minor, 60_000);
        assert_eq!(g.months_left, Some(12));
        assert_eq!(g.monthly_needed_minor, Some(20_000));

        assert_eq!(g.avg_monthly_minor, 20_000);
        assert_eq!(g.projected_on.as_deref(), Some("2027-10-08"));
        assert_eq!(g.on_track, Some(true));

        let g = allocate(&db, &g.id, -30_000, "2026-10-08", None, today).unwrap();
        assert_eq!(g.saved_minor, 30_000);
        assert_eq!(g.on_track, Some(false));
        assert_eq!(allocations(&db.conn(), &g.id).unwrap().len(), 2);
    }
}
