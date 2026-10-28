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
               AND t.category_id IN (
                   WITH RECURSIVE tree(id) AS (
                       SELECT ?1
                       UNION SELECT c.id FROM categories c JOIN tree ON c.parent_id = tree.id WHERE c.deleted = 0
                   )
                   SELECT id FROM tree
               )",
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

pub const PLAN_SETTING: &str = "plan_budgets";

pub fn planned(conn: &Connection, currency: &str, today: NaiveDate) -> AppResult<Vec<Budget>> {
    let setting = get_meta(conn, PLAN_SETTING)?.unwrap_or_default();
    if setting.trim().is_empty() {
        return Ok(vec![]);
    }
    let ids: std::collections::HashSet<&str> = setting.split(',').map(str::trim).collect();
    Ok(list(conn, today)?
        .into_iter()
        .filter(|b| b.currency == currency && (setting == "all" || ids.contains(b.id.as_str())))
        .collect())
}

pub fn planned_on(b: &Budget, today: NaiveDate, day: NaiveDate) -> i64 {
    if day <= today {
        return 0;
    }
    let Ok((start, end)) = period_range(&b.period, day) else { return 0 };
    if start <= today {
        let left_days = (end - today).num_days();
        if left_days <= 0 {
            return 0;
        }
        let period_days = (end - start).num_days() + 1;
        let left = (b.limit_minor - b.spent_minor).max(b.limit_minor * left_days / period_days);
        let j = (day - today).num_days() - 1;
        left * (j + 1) / left_days - left * j / left_days
    } else {
        let n = (end - start).num_days() + 1;
        let j = (day - start).num_days();
        b.limit_minor * (j + 1) / n - b.limit_minor * j / n
    }
}

pub fn planned_between(b: &Budget, today: NaiveDate, from: NaiveDate, to: NaiveDate) -> i64 {
    let mut day = from;
    let mut sum = 0;
    while day <= to {
        sum += planned_on(b, today, day);
        day += Duration::days(1);
    }
    sum
}

pub fn upsert(db: &Db, input: BudgetInput, today: NaiveDate) -> AppResult<Budget> {
    if input.limit_minor <= 0 {
        return Err(AppError::Invalid("limit must be positive".into()));
    }
    period_range(&input.period, today)?;
    let conn = db.conn();
    let currency = super::currency::main_currency(&conn)?;
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

    fn budget(period: &str, limit: i64, spent: i64, today: NaiveDate) -> Budget {
        let (from, to) = period_range(period, today).unwrap();
        Budget {
            id: "b".into(),
            category_id: "c".into(),
            period: period.into(),
            limit_minor: limit,
            currency: "EUR".into(),
            from: from.to_string(),
            to: to.to_string(),
            spent_minor: spent,
            remaining_minor: limit - spent,
            progress: 0.0,
            projected_minor: spent,
            days_left: 0,
        }
    }

    #[test]
    fn plans_what_is_left_of_the_current_period_and_full_limits_after() {
        let today = d("2026-10-21");
        let b = budget("month", 40_000, 10_000, today);
        assert_eq!(planned_between(&b, today, d("2026-10-01"), d("2026-10-31")), 30_000);
        assert_eq!(planned_on(&b, today, today), 0, "today is already booked");
        assert_eq!(planned_between(&b, today, d("2026-11-01"), d("2026-11-30")), 40_000);

        let over = budget("month", 40_000, 50_000, today);
        assert_eq!(
            planned_between(&over, today, d("2026-10-01"), d("2026-10-31")),
            40_000 * 10 / 31,
            "an exceeded budget still plans its normal rate for the days left"
        );
        let on_pace = budget("month", 40_000, 30_000, today);
        assert_eq!(planned_between(&on_pace, today, d("2026-10-22"), d("2026-10-31")), 40_000 * 10 / 31);

        let weekly = budget("week", 7_000, 0, today);
        assert_eq!(planned_between(&weekly, today, d("2026-11-02"), d("2026-11-08")), 7_000);
        assert_eq!(planned_between(&weekly, today, d("2026-10-22"), d("2026-10-25")), 7_000);

        let yearly = budget("year", 36_500, 0, d("2026-01-01"));
        assert_eq!(planned_between(&yearly, d("2026-12-31"), d("2027-01-01"), d("2027-12-31")), 36_500);
    }
}
