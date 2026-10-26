use std::collections::{HashMap, HashSet};

use chrono::{Duration, Months, NaiveDate};
use rusqlite::{params, Connection};
use serde::Serialize;

use super::budgets::{self, Budget};
use super::recurring::{self, Occurrence};
use super::{accounts, categories, goals};
use crate::error::AppResult;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForecastDay {
    pub date: String,
    pub balance_minor: i64,
    pub income_minor: i64,
    pub expense_minor: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSeries {
    pub account_id: String,
    pub balances: Vec<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Forecast {
    pub currency: String,
    pub start_balance_minor: i64,
    pub days: Vec<ForecastDay>,
    pub events: Vec<Occurrence>,
    pub min_balance_minor: i64,
    pub min_balance_on: String,
    pub end_balance_minor: i64,
    pub next_income: Option<Occurrence>,

    pub safe_daily_minor: i64,
    pub safe_total_minor: i64,
    pub safe_until: String,

    pub daily_variable_minor: i64,
    pub budgets_included: bool,
    pub budget_reserved_minor: i64,
    pub accounts: Vec<AccountSeries>,
}

struct BookedAhead {
    date: String,
    kind: String,
    amount_minor: i64,
    account_id: String,
    to_account_id: Option<String>,
}

fn booked_ahead(conn: &Connection, currency: &str, today: NaiveDate, to: NaiveDate) -> AppResult<Vec<BookedAhead>> {
    let mut stmt = conn.prepare(
        "SELECT t.occurred_on, t.kind, t.amount_minor, t.account_id, t.to_account_id
         FROM transactions t JOIN accounts a ON a.id = t.account_id
         WHERE t.deleted = 0 AND a.deleted = 0 AND a.archived = 0 AND a.currency = ?1
           AND t.occurred_on > ?2 AND t.occurred_on <= ?3
         ORDER BY t.occurred_on",
    )?;
    let rows = stmt.query_map(params![currency, today.to_string(), to.to_string()], |r| {
        Ok(BookedAhead {
            date: r.get(0)?,
            kind: r.get(1)?,
            amount_minor: r.get(2)?,
            account_id: r.get(3)?,
            to_account_id: r.get(4)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

struct Spending {
    total: i64,
    by_account: HashMap<String, i64>,
}

fn variable_spending_90d(conn: &Connection, currency: &str, today: NaiveDate, exclude: &HashSet<String>) -> AppResult<Spending> {
    let mut stmt = conn.prepare(
        "SELECT account_id, category_id, coalesce(sum(amount_minor), 0) FROM transactions
         WHERE deleted = 0 AND kind = 'expense' AND recurring_rule_id IS NULL AND debt_id IS NULL
           AND currency = ?1 AND occurred_on > ?2 AND occurred_on <= ?3
         GROUP BY account_id, category_id",
    )?;
    let rows = stmt.query_map(params![currency, (today - Duration::days(90)).to_string(), today.to_string()], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?, r.get::<_, i64>(2)?))
    })?;
    let mut out = Spending { total: 0, by_account: HashMap::new() };
    for row in rows {
        let (account, category, amount) = row?;
        *out.by_account.entry(account).or_default() += amount;
        if !category.is_some_and(|c| exclude.contains(&c)) {
            out.total += amount;
        }
    }
    Ok(out)
}

struct Plan {
    budgets: Vec<Budget>,
    covered: HashSet<String>,
}

fn plan(conn: &Connection, currency: &str, today: NaiveDate) -> AppResult<Plan> {
    let budgets = budgets::planned(conn, currency, today)?;
    let mut covered = HashSet::new();
    for b in &budgets {
        covered.extend(categories::subtree(conn, &b.category_id)?);
    }
    Ok(Plan { budgets, covered })
}

fn effect(kind: &str, amount_minor: i64, account_id: &str, to_account_id: Option<&str>, target: &str) -> i64 {
    match kind {
        "income" if account_id == target => amount_minor,
        "expense" if account_id == target => -amount_minor,
        "transfer" if account_id == target => -amount_minor,
        "transfer" if to_account_id == Some(target) => amount_minor,
        _ => 0,
    }
}

pub fn forecast(conn: &Connection, currency: &str, today: NaiveDate, horizon_days: i64) -> AppResult<Forecast> {
    let to = today + Duration::days(horizon_days.clamp(1, 3 * 366));
    let all_accounts = accounts::list_as_of(conn, today)?;
    let tracked: Vec<&accounts::Account> = all_accounts.iter().filter(|a| !a.archived && a.currency == currency).collect();
    let start: i64 = tracked.iter().map(|a| a.balance_minor).sum();
    let liquid_ids: HashSet<String> = tracked
        .iter()
        .filter(|a| matches!(a.kind.as_str(), "cash" | "checking" | "credit"))
        .map(|a| a.id.clone())
        .collect();
    let liquid_start: i64 = tracked.iter().filter(|a| liquid_ids.contains(&a.id)).map(|a| a.balance_minor).sum();
    let liquid_effect = |kind: &str, amount_minor: i64, account_id: &String, to_account_id: Option<&String>| -> i64 {
        let from = liquid_ids.contains(account_id);
        match kind {
            "income" if from => amount_minor,
            "expense" if from => -amount_minor,
            "transfer" => {
                let to = to_account_id.is_some_and(|t| liquid_ids.contains(t));
                match (from, to) {
                    (true, false) => -amount_minor,
                    (false, true) => amount_minor,
                    _ => 0,
                }
            }
            _ => 0,
        }
    };
    let all_events: Vec<Occurrence> = recurring::occurrences(conn, today, to)?.into_iter().filter(|o| o.currency == currency).collect();
    let plan = plan(conn, currency, today)?;
    let spending = variable_spending_90d(conn, currency, today, &plan.covered)?;
    let variable_90 = spending.total;
    let events: Vec<Occurrence> = all_events.iter().filter(|o| o.kind != "transfer").cloned().collect();
    let ahead = booked_ahead(conn, currency, today, to)?;

    let weights: Vec<i64> = tracked.iter().map(|a| spending.by_account.get(&a.id).copied().unwrap_or(0)).collect();
    let weight_sum: i64 = weights.iter().sum();
    let primary = if weight_sum > 0 {
        weights.iter().enumerate().max_by_key(|(_, w)| **w).map(|(i, _)| i)
    } else {
        tracked.iter().position(|a| liquid_ids.contains(&a.id)).or((!tracked.is_empty()).then_some(0))
    };
    let mut series: Vec<Vec<i64>> = vec![Vec::new(); tracked.len()];
    let mut running: Vec<i64> = tracked.iter().map(|a| a.balance_minor).collect();
    let mut shared: Vec<i64> = vec![0; tracked.len()];
    let mut variable_cum = 0i64;

    let mut days = Vec::new();
    let mut balance = start;
    let mut min = (start, today);
    let mut day = today;
    let mut i = 0;
    let mut j = 0;
    let mut k_all = 0;
    while day <= to {
        let (mut inc, mut exp) = (0, 0);
        let day_s = day.to_string();

        while j < ahead.len() && ahead[j].date.as_str() <= day_s.as_str() {
            let t = &ahead[j];
            match t.kind.as_str() {
                "income" => inc += t.amount_minor,
                "expense" => exp += t.amount_minor,
                _ => {}
            }
            for (idx, a) in tracked.iter().enumerate() {
                running[idx] += effect(&t.kind, t.amount_minor, &t.account_id, t.to_account_id.as_deref(), &a.id);
            }
            j += 1;
        }

        while i < events.len() && events[i].date.as_str() <= day_s.as_str() {
            match events[i].kind.as_str() {
                "income" => inc += events[i].amount_minor,
                _ => exp += events[i].amount_minor,
            }
            i += 1;
        }
        while k_all < all_events.len() && all_events[k_all].date.as_str() <= day_s.as_str() {
            let o = &all_events[k_all];
            for (idx, a) in tracked.iter().enumerate() {
                running[idx] += effect(&o.kind, o.amount_minor, &o.account_id, o.to_account_id.as_deref(), &a.id);
            }
            k_all += 1;
        }

        let k = (day - today).num_days();
        let history_today = if k > 0 { variable_90 * k / 90 - variable_90 * (k - 1) / 90 } else { 0 };
        let budget_today: i64 = plan.budgets.iter().map(|b| budgets::planned_on(b, today, day)).sum();
        let variable_today = history_today + budget_today;
        balance += inc - exp - variable_today;
        if balance < min.0 {
            min = (balance, day);
        }

        variable_cum += variable_today;
        if let Some(p) = primary {
            let mut others = 0;
            for idx in 0..tracked.len() {
                if idx == p {
                    continue;
                }
                let share = if weight_sum > 0 { variable_cum * weights[idx] / weight_sum } else { 0 };
                running[idx] -= share - shared[idx];
                shared[idx] = share;
                others += share;
            }
            let share = variable_cum - others;
            running[p] -= share - shared[p];
            shared[p] = share;
        }
        for (idx, s) in series.iter_mut().enumerate() {
            s.push(running[idx]);
        }

        days.push(ForecastDay { date: day_s, balance_minor: balance, income_minor: inc, expense_minor: exp });
        day += Duration::days(1);
    }

    let next_income = events.iter().find(|o| o.kind == "income" && o.date.as_str() > today.to_string().as_str()).cloned();

    let until = next_income
        .as_ref()
        .and_then(|o| NaiveDate::parse_from_str(&o.date, "%Y-%m-%d").ok())
        .map(|d| d - Duration::days(1))
        .unwrap_or(today + Duration::days(30))
        .max(today);
    let until_s = until.to_string();
    let window_net: i64 = all_events
        .iter()
        .filter(|o| o.date <= until_s)
        .map(|o| liquid_effect(&o.kind, o.amount_minor, &o.account_id, o.to_account_id.as_ref()))
        .chain(
            ahead
                .iter()
                .filter(|t| t.date <= until_s)
                .map(|t| liquid_effect(&t.kind, t.amount_minor, &t.account_id, t.to_account_id.as_ref())),
        )
        .sum();
    let reserved: i64 = plan.budgets.iter().map(|b| budgets::planned_between(b, today, today + Duration::days(1), until)).sum();
    let safe_total = (liquid_start + window_net - reserved).max(0);
    let window_days = (until - today).num_days() + 1;

    Ok(Forecast {
        currency: currency.into(),
        start_balance_minor: start,
        end_balance_minor: balance,
        min_balance_minor: min.0,
        min_balance_on: min.1.to_string(),
        days,
        events,
        next_income,
        safe_daily_minor: safe_total / window_days.max(1),
        safe_total_minor: safe_total,
        safe_until: until_s,
        daily_variable_minor: variable_90 / 90,
        budgets_included: !plan.budgets.is_empty(),
        budget_reserved_minor: reserved,
        accounts: tracked
            .iter()
            .zip(series)
            .map(|(a, balances)| AccountSeries { account_id: a.id.clone(), balances })
            .collect(),
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedBudget {
    pub budget_id: String,
    pub category_id: String,
    pub amount_minor: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthPreview {
    pub month: String,
    pub from: String,
    pub to: String,
    pub currency: String,
    pub expected_income_minor: i64,
    pub fixed_expense_minor: i64,

    pub variable_expense_minor: i64,
    pub budget_expense_minor: i64,
    pub budgets: Vec<PlannedBudget>,

    pub savings_target_minor: i64,

    pub free_minor: i64,
    pub start_balance_minor: i64,
    pub end_balance_minor: i64,
    pub items: Vec<Occurrence>,

    pub is_current: bool,
}

pub fn month_preview(conn: &Connection, currency: &str, today: NaiveDate, month_start: NaiveDate) -> AppResult<MonthPreview> {
    let month_end = month_start.checked_add_months(Months::new(1)).unwrap() - Duration::days(1);
    let from = month_start.max(today);
    let horizon = (month_end - today).num_days().max(0);
    let fc = forecast(conn, currency, today, horizon)?;

    let items: Vec<Occurrence> = fc
        .events
        .iter()
        .filter(|o| {
            let d = if o.date.as_str() < today.to_string().as_str() { today.to_string() } else { o.date.clone() };
            d >= from.to_string() && d <= month_end.to_string()
        })
        .cloned()
        .collect();
    let income: i64 = items.iter().filter(|o| o.kind == "income").map(|o| o.amount_minor).sum();
    let fixed: i64 = items.iter().filter(|o| o.kind == "expense").map(|o| o.amount_minor).sum();

    let plan = plan(conn, currency, today)?;
    let variable_90 = variable_spending_90d(conn, currency, today, &plan.covered)?.total;
    let days_in_month = (month_end - month_start).num_days() + 1;
    let days_ahead = (month_end - from).num_days() + 1 - i64::from(from == today);
    let variable = variable_90 / 3 * days_ahead.max(0) / days_in_month;
    let planned: Vec<PlannedBudget> = plan
        .budgets
        .iter()
        .map(|b| PlannedBudget {
            budget_id: b.id.clone(),
            category_id: b.category_id.clone(),
            amount_minor: budgets::planned_between(b, today, month_start, month_end),
        })
        .collect();
    let budgeted: i64 = planned.iter().map(|p| p.amount_minor).sum();
    let savings: i64 = goals::list(conn, today)?
        .iter()
        .filter(|g| !g.archived && g.currency == currency)
        .filter_map(|g| g.monthly_needed_minor)
        .sum();

    let day_before = (from - Duration::days(1)).to_string();
    let start_balance = if from <= today {
        fc.start_balance_minor
    } else {
        fc.days.iter().find(|d| d.date == day_before).map(|d| d.balance_minor).unwrap_or(fc.start_balance_minor)
    };

    Ok(MonthPreview {
        month: month_start.format("%Y-%m").to_string(),
        from: month_start.to_string(),
        to: month_end.to_string(),
        currency: currency.into(),
        expected_income_minor: income,
        fixed_expense_minor: fixed,
        variable_expense_minor: variable,
        budget_expense_minor: budgeted,
        budgets: planned,
        savings_target_minor: savings,
        free_minor: income - fixed - variable - budgeted - savings,
        start_balance_minor: start_balance,
        end_balance_minor: fc.end_balance_minor,
        items,
        is_current: from == today,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;
    use crate::domain::recurring::{upsert, RecurringInput};

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    fn rule(db: &Db, title: &str, kind: &str, amount: i64, start: &str, today: NaiveDate) {
        let acc = accounts::list(&db.conn()).unwrap()[0].id.clone();
        upsert(
            db,
            RecurringInput {
                id: None,
                title: title.into(),
                kind: kind.into(),
                amount_minor: amount,
                account_id: acc,
                to_account_id: None,
                category_id: None,
                counterparty: None,
                freq: "monthly".into(),
                interval_n: 1,
                start_on: start.into(),
                end_on: None,
                max_count: None,
                auto_post: true,
                backfill: false,
                note: None,
            },
            today,
        )
        .unwrap();
    }

    #[test]
    fn entries_dated_ahead_land_on_their_day() {
        let db = Db::open_in_memory().unwrap();
        let today = d("2026-10-08");
        let acc = accounts::list(&db.conn()).unwrap()[0].id.clone();
        accounts::set_balance(&db, &acc, 10_000, "2026-10-08").unwrap();
        crate::domain::transactions::create(
            &db,
            crate::domain::transactions::TransactionInput {
                kind: "expense".into(),
                amount_minor: 3_000,
                currency: None,
                occurred_on: "2026-10-10".into(),
                account_id: acc,
                to_account_id: None,
                category_id: None,
                counterparty: None,
                title: "Vorgemerkt".into(),
                note: None,
                tags: vec![],
                debt_id: None,
                goal_id: None,
            },
        )
        .unwrap();

        let fc = forecast(&db.conn(), "EUR", today, 5).unwrap();
        assert_eq!(fc.start_balance_minor, 10_000);
        let on = |day: &str| fc.days.iter().find(|x| x.date == day).unwrap();
        assert_eq!(on("2026-10-09").balance_minor, 10_000);
        assert_eq!(on("2026-10-10").expense_minor, 3_000);
        assert_eq!(fc.end_balance_minor, 7_000);
        assert_eq!(fc.safe_total_minor, 7_000);
    }

    #[test]
    fn forecast_and_safe_to_spend() {
        let db = Db::open_in_memory().unwrap();
        let today = d("2026-10-08");
        rule(&db, "Gehalt", "income", 250_000, "2026-10-28", today);
        rule(&db, "Miete", "expense", 80_000, "2026-11-01", today);
        rule(&db, "Handy", "expense", 2_000, "2026-10-15", today);

        let fc = forecast(&db.conn(), "EUR", today, 40).unwrap();
        assert_eq!(fc.start_balance_minor, 0);

        assert_eq!(fc.min_balance_minor, -2_000);
        assert_eq!(fc.min_balance_on, "2026-10-15");
        assert_eq!(fc.next_income.as_ref().unwrap().date, "2026-10-28");
        assert_eq!(fc.safe_until, "2026-10-27");
        assert_eq!(fc.safe_total_minor, 0);

        assert_eq!(fc.end_balance_minor, 166_000);

        let p = month_preview(&db.conn(), "EUR", today, d("2026-11-01")).unwrap();
        assert_eq!(p.expected_income_minor, 250_000);
        assert_eq!(p.fixed_expense_minor, 82_000);
        assert_eq!(p.free_minor, 168_000);

        assert_eq!(p.start_balance_minor, 248_000);
        assert_eq!(p.end_balance_minor, 248_000 + 168_000);
    }

    #[test]
    fn everyday_spending_is_projected_without_rounding_drift() {
        let db = Db::open_in_memory().unwrap();
        let today = d("2026-10-08");
        let acc = accounts::list(&db.conn()).unwrap()[0].id.clone();

        for i in 0..3 {
            crate::domain::transactions::create(
                &db,
                crate::domain::transactions::TransactionInput {
                    kind: "expense".into(),
                    amount_minor: 3_000,
                    currency: None,
                    occurred_on: (today - Duration::days(10 + i * 20)).to_string(),
                    account_id: acc.clone(),
                    to_account_id: None,
                    category_id: None,
                    counterparty: None,
                    title: "Einkauf".into(),
                    note: None,
                    tags: vec![],
                    debt_id: None,
                    goal_id: None,
                },
            )
            .unwrap();
        }
        let fc = forecast(&db.conn(), "EUR", today, 90).unwrap();
        assert_eq!(fc.daily_variable_minor, 100);
        assert_eq!(fc.start_balance_minor, -9_000);
        assert_eq!(fc.days[0].balance_minor, -9_000, "today is already booked");
        assert_eq!(fc.days[1].balance_minor, -9_100);
        assert_eq!(fc.end_balance_minor, -18_000, "exactly 90 days × 1 €");

        let p = month_preview(&db.conn(), "EUR", today, d("2026-10-01")).unwrap();
        assert!(p.is_current);
        assert_eq!(p.variable_expense_minor, 3_000 * 23 / 31);
    }

    #[test]
    fn safe_to_spend_ignores_savings_but_counts_transfers_into_them() {
        let db = Db::open_in_memory().unwrap();
        let today = d("2026-10-08");
        let cash = accounts::list(&db.conn()).unwrap()[0].id.clone();
        let savings = accounts::upsert(
            &db,
            accounts::AccountInput { id: None, name: "Tagesgeld".into(), kind: "savings".into(), currency: "EUR".into(), opening_minor: 1_000_000, color: None, archived: false },
        )
        .unwrap();
        db.conn().execute("UPDATE accounts SET opening_minor = 50_000 WHERE id = ?1", [&cash]).unwrap();

        upsert(
            &db,
            RecurringInput {
                id: None,
                title: "Sparplan".into(),
                kind: "transfer".into(),
                amount_minor: 10_000,
                account_id: cash.clone(),
                to_account_id: Some(savings.id.clone()),
                category_id: None,
                counterparty: None,
                freq: "monthly".into(),
                interval_n: 1,
                start_on: "2026-10-10".into(),
                end_on: None,
                max_count: None,
                auto_post: true,
                backfill: false,
                note: None,
            },
            today,
        )
        .unwrap();
        rule(&db, "Gehalt", "income", 250_000, "2026-10-28", today);
        let fc = forecast(&db.conn(), "EUR", today, 40).unwrap();
        assert_eq!(fc.start_balance_minor, 1_050_000, "net worth includes savings");

        assert_eq!(fc.safe_total_minor, 40_000);
        assert_eq!(fc.safe_daily_minor, 2_000);
    }

    fn spend(db: &Db, account: &str, category: Option<String>, cents: i64, on: &str) {
        crate::domain::transactions::create(
            db,
            crate::domain::transactions::TransactionInput {
                kind: "expense".into(),
                amount_minor: cents,
                currency: None,
                occurred_on: on.into(),
                account_id: account.into(),
                to_account_id: None,
                category_id: category,
                counterparty: None,
                title: "x".into(),
                note: None,
                tags: vec![],
                debt_id: None,
                goal_id: None,
            },
        )
        .unwrap();
    }

    #[test]
    fn included_budgets_replace_history_for_their_categories() {
        let db = Db::open_in_memory().unwrap();
        let today = d("2026-10-31");
        let acc = accounts::list(&db.conn()).unwrap()[0].id.clone();
        let cats = crate::domain::categories::list(&db.conn()).unwrap();
        let groceries = cats.iter().find(|c| c.system_key.as_deref() == Some("category.groceries")).unwrap().id.clone();
        let fruit = crate::domain::categories::upsert(
            &db,
            crate::domain::categories::CategoryInput { id: None, parent_id: Some(groceries.clone()), name: "Obst".into(), kind: "expense".into(), icon: None, color: None },
        )
        .unwrap()
        .id;
        spend(&db, &acc, Some(fruit), 9_000, "2026-10-15");
        spend(&db, &acc, None, 3_000, "2026-10-15");
        let budget = budgets::upsert(&db, budgets::BudgetInput { id: None, category_id: groceries, period: "month".into(), limit_minor: 50_000 }, today).unwrap();

        let without = month_preview(&db.conn(), "EUR", today, d("2026-11-01")).unwrap();
        assert_eq!(without.budget_expense_minor, 0);
        assert_eq!(without.variable_expense_minor, 4_000);

        crate::db::set_meta(&db.conn(), budgets::PLAN_SETTING, "all").unwrap();
        let with = month_preview(&db.conn(), "EUR", today, d("2026-11-01")).unwrap();
        assert_eq!(with.budget_expense_minor, 50_000);
        assert_eq!(with.variable_expense_minor, 1_000, "grocery history is covered by the budget");
        assert_eq!(with.free_minor, -51_000);
        assert_eq!(with.budgets[0].budget_id, budget.id);

        crate::db::set_meta(&db.conn(), budgets::PLAN_SETTING, "someone-else").unwrap();
        assert_eq!(month_preview(&db.conn(), "EUR", today, d("2026-11-01")).unwrap().budget_expense_minor, 0);
    }

    #[test]
    fn account_series_follow_their_own_money() {
        let db = Db::open_in_memory().unwrap();
        let today = d("2026-10-08");
        let cash = accounts::list(&db.conn()).unwrap()[0].id.clone();
        let giro = accounts::upsert(
            &db,
            accounts::AccountInput { id: None, name: "Giro".into(), kind: "checking".into(), currency: "EUR".into(), opening_minor: 100_000, color: None, archived: false },
        )
        .unwrap()
        .id;
        upsert(
            &db,
            RecurringInput {
                id: None,
                title: "ATM".into(),
                kind: "transfer".into(),
                amount_minor: 5_000,
                account_id: giro.clone(),
                to_account_id: Some(cash.clone()),
                category_id: None,
                counterparty: None,
                freq: "monthly".into(),
                interval_n: 1,
                start_on: "2026-10-10".into(),
                end_on: None,
                max_count: None,
                auto_post: true,
                backfill: false,
                note: None,
            },
            today,
        )
        .unwrap();
        spend(&db, &giro, None, 9_000, "2026-09-20");
        let fc = forecast(&db.conn(), "EUR", today, 9).unwrap();
        let series = |id: &str| fc.accounts.iter().find(|s| s.account_id == id).unwrap().balances.clone();
        let (g, c) = (series(&giro), series(&cash));
        assert_eq!(c[2], 5_000, "transfer lands in cash");
        assert_eq!(g[0], 91_000);
        assert_eq!(*g.last().unwrap(), 91_000 - 5_000 - 900, "everyday spending stays with the account that spends");
        for (idx, day) in fc.days.iter().enumerate() {
            assert_eq!(g[idx] + c[idx], day.balance_minor, "accounts add up to the total");
        }
    }
}