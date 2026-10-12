use chrono::{Duration, NaiveDate};
use rusqlite::Connection;
use serde::Serialize;

use super::{budgets, debts, forecast, goals};
use crate::error::AppResult;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Insight {
    pub id: String,
    pub kind: String,

    pub severity: String,
    pub date: Option<String>,
    pub days: Option<i64>,
    pub amount_minor: Option<i64>,
    pub currency: Option<String>,
    pub title: Option<String>,
    pub ref_id: Option<String>,
    pub ratio: Option<f64>,
}

impl Insight {
    fn new(id: impl Into<String>, kind: &str, severity: &str) -> Self {
        Self {
            id: id.into(),
            kind: kind.into(),
            severity: severity.into(),
            date: None,
            days: None,
            amount_minor: None,
            currency: None,
            title: None,
            ref_id: None,
            ratio: None,
        }
    }
}

fn days_between(today: NaiveDate, date: &str) -> Option<i64> {
    NaiveDate::parse_from_str(date, "%Y-%m-%d").ok().map(|d| (d - today).num_days())
}

fn rank(severity: &str) -> u8 {
    match severity {
        "critical" => 0,
        "warning" => 1,
        "info" => 2,
        _ => 3,
    }
}

pub fn compute(conn: &Connection, currency: &str, today: NaiveDate, remind_days: i64) -> AppResult<Vec<Insight>> {
    let mut out = Vec::new();
    let fc = forecast::forecast(conn, currency, today, 45)?;

    let soon = (today + Duration::days(remind_days)).to_string();
    for o in fc.events.iter().filter(|o| o.date <= soon) {
        let days = days_between(today, &o.date).unwrap_or(0);
        let (kind, severity) = match (o.overdue, o.auto_post, o.kind.as_str()) {
            (true, false, _) => ("confirm_pending", "warning"),
            (_, _, "income") => ("income_soon", "info"),
            _ if days <= 0 => ("payment_today", "warning"),
            _ => ("payment_soon", "info"),
        };
        let mut i = Insight::new(format!("{kind}:{}:{}", o.rule_id, o.date), kind, severity);
        i.date = Some(o.date.clone());
        i.days = Some(days);
        i.amount_minor = Some(o.amount_minor);
        i.currency = Some(o.currency.clone());
        i.title = Some(o.title.clone());
        i.ref_id = Some(o.rule_id.clone());
        out.push(i);
    }

    if let Some(o) = &fc.next_income {
        if o.date > soon {
            let mut i = Insight::new(format!("income_next:{}:{}", o.rule_id, o.date), "income_next", "info");
            i.date = Some(o.date.clone());
            i.days = days_between(today, &o.date);
            i.amount_minor = Some(o.amount_minor);
            i.currency = Some(o.currency.clone());
            i.title = Some(o.title.clone());
            i.ref_id = Some(o.rule_id.clone());
            out.push(i);
        }
    }

    if fc.start_balance_minor < 0 {
        let mut i = Insight::new(format!("balance_negative:{today}"), "balance_negative", "critical");
        i.amount_minor = Some(fc.start_balance_minor);
        i.currency = Some(currency.into());
        out.push(i);
    } else if fc.min_balance_minor < 0 {
        let mut i = Insight::new(format!("low_balance:{}", fc.min_balance_on), "low_balance", "critical");
        i.date = Some(fc.min_balance_on.clone());
        i.days = days_between(today, &fc.min_balance_on);
        i.amount_minor = Some(fc.min_balance_minor);
        i.currency = Some(currency.into());
        out.push(i);
    }

    for d in debts::list(conn, today)?.into_iter().filter(|d| !d.archived && d.remaining_minor > 0) {
        if let Some(due) = &d.due_on {
            let days = days_between(today, due).unwrap_or(0);
            if days <= 14 {
                let (kind, severity) = if days < 0 { ("debt_overdue", "critical") } else { ("debt_due", "warning") };
                let mut i = Insight::new(format!("{kind}:{}:{today}", d.id), kind, severity);
                i.date = Some(due.clone());
                i.days = Some(days);
                i.amount_minor = Some(d.remaining_minor);
                i.currency = Some(d.currency.clone());
                i.title = Some(d.title.clone());
                i.ref_id = Some(d.id.clone());
                out.push(i);
            }
        }
    }

    for b in budgets::list(conn, today)? {
        let (kind, severity) = if b.spent_minor > b.limit_minor {
            ("budget_over", "critical")
        } else if b.progress >= 0.8 {
            ("budget_warn", "warning")
        } else if b.projected_minor > b.limit_minor && b.period != "day" {
            ("budget_trend", "info")
        } else {
            continue;
        };
        let mut i = Insight::new(format!("{kind}:{}:{}", b.id, b.from), kind, severity);
        i.amount_minor = Some(b.remaining_minor);
        i.currency = Some(b.currency.clone());
        i.ref_id = Some(b.category_id.clone());
        i.ratio = Some(b.progress);
        i.days = Some(b.days_left);
        out.push(i);
    }

    for g in goals::list(conn, today)?.into_iter().filter(|g| !g.archived) {
        let (kind, severity) = if g.remaining_minor == 0 {
            ("goal_reached", "success")
        } else if g.on_track == Some(false) {
            ("goal_behind", "info")
        } else {
            continue;
        };
        let mut i = Insight::new(format!("{kind}:{}", g.id), kind, severity);
        i.amount_minor = g.monthly_needed_minor.or(Some(g.remaining_minor));
        i.currency = Some(g.currency.clone());
        i.title = Some(g.title.clone());
        i.ref_id = Some(g.id.clone());
        i.ratio = Some(g.progress);
        i.date = g.target_on.clone();
        out.push(i);
    }

    out.sort_by(|a, b| rank(&a.severity).cmp(&rank(&b.severity)).then(a.date.cmp(&b.date)));
    Ok(out)
}
