use chrono::{Datelike, Duration, NaiveDate};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::db::{get_meta, new_id, now_rfc3339, Db};
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Budget {
    pub id: String,
    pub category_id: String,
    pub period: String,
    pub limit_minor: i64,
    pub currency: String,
    pub from: String,
    pub to: String,
    pub spent_minor: i64,
    pub remaining_minor: i64,
    pub progress: f64,

    pub projected_minor: i64,
    pub days_left: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BudgetInput {
    pub id: Option<String>,
    pub category_id: String,
    pub period: String,
    pub limit_minor: i64,
}

pub fn period_range(period: &str, today: NaiveDate) -> AppResult<(NaiveDate, NaiveDate)> {
    Ok(match period {
        "day" => (today, today),
        "week" => {
            let start = today - Duration::days(today.weekday().num_days_from_monday() as i64);
            (start, start + Duration::days(6))
        }
        "month" => {
            let start = today.with_day(1).unwrap();
            let next = start.checked_add_months(chrono::Months::new(1)).unwrap();
            (start, next - Duration::days(1))
        }
        "year" => (
            NaiveDate::from_ymd_opt(today.year(), 1, 1).unwrap(),
            NaiveDate::from_ymd_opt(today.year(), 12, 31).unwrap(),
        ),
        _ => return Err(AppError::Invalid(format!("unknown period {period:?}"))),
    })
}

pub fn list(conn: &Connection, today: NaiveDate) -> AppResult<Vec<Budget>> {
    let mut stmt = conn.prepare(
        "SELECT b.id, b.category_id, b.period, b.limit_minor, b.currency
         FROM budgets b JOIN categories c ON c.id = b.category_id
         WHERE b.deleted = 0 AND c.deleted = 0 ORDER BY b.created_at",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, i64>(3)?, r.get::<_, String>(4)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut out = Vec::with_capacity(rows.len());
    for (id, category_id, period, limit, currency) in rows {
        let (from, to) = period_range(&period, today)?;

        let spent: i64 = conn.query_row(
            "SELECT coalesce(sum(t.amount_minor), 0) FROM transactions t
             WHERE t.deleted = 0 AND t.kind = 'expense' AND t.currency = ?4
               AND t.occurred_on BETWEEN ?2 AND ?3
               AND (t.category_id = ?1 OR t.category_id IN (SELECT id FROM categories WHERE parent_id = ?1))",
            params![category_id, from.to_string(), to.to_string(), currency],
            |r| r.get(0),
        )?;
        let total_days = (to - from).num_days() + 1;
        let elapsed = (today - from).num_days() + 1;
        let projected = if elapsed > 0 { spent * total_days / elapsed } else { spent };
        out.push(Budget {
            id,
            category_id,
            period,
            limit_minor: limit,
            currency,
            from: from.to_string(),
            to: to.to_string(),
            spent_minor: spent,
            remaining_minor: limit - spent,
            progress: if limit > 0 { spent as f64 / limit as f64 } else { 0.0 },
            projected_minor: projected,
            days_left: (to - today).num_days().max(0),
        });
    }
    Ok(out)
}

pub fn upsert(db: &Db, input: BudgetInput, today: NaiveDate) -> AppResult<Budget> {
    if input.limit_minor <= 0 {
        return Err(AppError::Invalid("limit must be positive".into()));
    }
    period_range(&input.period, today)?;
    let conn = db.conn();
    let currency = get_meta(&conn, "default_currency")?.unwrap_or_else(|| "EUR".into());
    let hlc = db.hlc.tick();
    let id = match &input.id {
        Some(id) => {
            let n = conn.execute(
                "UPDATE budgets SET category_id = ?2, period = ?3, limit_minor = ?4, updated_hlc = ?5
                 WHERE id = ?1 AND deleted = 0",
                params![id, input.category_id, input.period, input.limit_minor, hlc],
            )?;
            if n == 0 {
                return Err(AppError::NotFound(format!("budget {id}")));
            }
            id.clone()
        }
        None => {
            let id = new_id();
            conn.execute(
                "INSERT INTO budgets (id, category_id, period, limit_minor, currency, created_at, device_id, updated_hlc)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![id, input.category_id, input.period, input.limit_minor, currency, now_rfc3339(), db.device_id(), hlc],
            )?;
            id
        }
    };
    list(&conn, today)?
        .into_iter()
        .find(|b| b.id == id)
        .ok_or_else(|| AppError::NotFound(format!("budget {id}")))
}

pub fn delete(db: &Db, id: &str) -> AppResult<()> {
    let n = db.conn().execute(
        "UPDATE budgets SET deleted = 1, updated_hlc = ?2 WHERE id = ?1 AND deleted = 0",
        params![id, db.hlc.tick()],
    )?;
    if n == 0 {
        return Err(AppError::NotFound(format!("budget {id}")));
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
    fn ranges() {
        let today = d("2026-10-08");
        assert_eq!(period_range("week", today).unwrap(), (d("2026-10-05"), d("2026-10-11")));
        assert_eq!(period_range("month", today).unwrap(), (d("2026-10-01"), d("2026-10-31")));
        assert_eq!(period_range("month", d("2026-02-10")).unwrap().1, d("2026-02-28"));
        assert!(period_range("decade", today).is_err());
    }
}
