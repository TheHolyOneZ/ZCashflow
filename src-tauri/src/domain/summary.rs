use rusqlite::{params, Connection};
use serde::Serialize;

use crate::error::AppResult;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryTotal {
    pub category_id: Option<String>,
    pub total_minor: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeriodSummary {
    pub from: String,
    pub to: String,
    pub currency: String,
    pub income_minor: i64,
    pub expense_minor: i64,
    pub net_minor: i64,
    pub expense_by_category: Vec<CategoryTotal>,
}

pub fn period(conn: &Connection, from: &str, to: &str, currency: &str) -> AppResult<PeriodSummary> {
    let (income, expense): (i64, i64) = conn.query_row(
        "SELECT coalesce(sum(CASE WHEN kind = 'income'  THEN amount_minor END), 0),
                coalesce(sum(CASE WHEN kind = 'expense' THEN amount_minor END), 0)
         FROM transactions
         WHERE deleted = 0 AND currency = ?3 AND occurred_on BETWEEN ?1 AND ?2",
        params![from, to, currency],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let mut stmt = conn.prepare(
        "SELECT category_id, sum(amount_minor) AS total
         FROM transactions
         WHERE deleted = 0 AND kind = 'expense' AND currency = ?3 AND occurred_on BETWEEN ?1 AND ?2
         GROUP BY category_id ORDER BY total DESC",
    )?;
    let by_category = stmt
        .query_map(params![from, to, currency], |r| {
            Ok(CategoryTotal { category_id: r.get(0)?, total_minor: r.get(1)? })
        })?
        .collect::<Result<_, _>>()?;
    Ok(PeriodSummary {
        from: from.into(),
        to: to.into(),
        currency: currency.into(),
        income_minor: income,
        expense_minor: expense,
        net_minor: income - expense,
        expense_by_category: by_category,
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthTotals {
    pub month: String,
    pub income_minor: i64,
    pub expense_minor: i64,
}

pub fn monthly_series(conn: &Connection, currency: &str, today: chrono::NaiveDate, months: u32) -> AppResult<Vec<MonthTotals>> {
    use chrono::{Datelike, Months};
    let first = today.with_day(1).unwrap() - Months::new(months.saturating_sub(1));
    let mut stmt = conn.prepare(
        "SELECT substr(occurred_on, 1, 7) AS m,
                coalesce(sum(CASE WHEN kind = 'income'  THEN amount_minor END), 0),
                coalesce(sum(CASE WHEN kind = 'expense' THEN amount_minor END), 0)
         FROM transactions
         WHERE deleted = 0 AND currency = ?1 AND occurred_on >= ?2 AND occurred_on <= ?3
         GROUP BY m",
    )?;
    let found: std::collections::HashMap<String, (i64, i64)> = stmt
        .query_map(params![currency, first.to_string(), today.to_string()], |r| {
            Ok((r.get::<_, String>(0)?, (r.get(1)?, r.get(2)?)))
        })?
        .collect::<Result<_, _>>()?;
    Ok((0..months)
        .map(|i| {
            let m = (first + Months::new(i)).format("%Y-%m").to_string();
            let (inc, exp) = found.get(&m).copied().unwrap_or((0, 0));
            MonthTotals { month: m, income_minor: inc, expense_minor: exp }
        })
        .collect())
}
