use chrono::NaiveDate;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use super::recurring::{self, RecurringInput, RecurringRule};
use super::{counterparties, transactions};
use crate::db::{new_id, now_rfc3339, Db};
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Debt {
    pub id: String,
    pub title: String,

    pub direction: String,
    pub counterparty_id: Option<String>,
    pub counterparty_name: Option<String>,
    pub principal_minor: i64,
    pub currency: String,
    pub start_on: String,
    pub due_on: Option<String>,
    pub interest_bp: Option<i64>,
    pub note: Option<String>,
    pub archived: bool,
    pub paid_minor: i64,
    pub remaining_minor: i64,
    pub payment_count: u32,
    pub last_payment_on: Option<String>,
    pub installment: Option<RecurringRule>,
    pub next_payment_on: Option<String>,

    pub payoff_on: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallmentInput {
    pub amount_minor: i64,
    pub freq: String,
    pub interval_n: u32,
    pub start_on: String,
    pub account_id: String,
    pub auto_post: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebtInput {
    pub id: Option<String>,
    pub title: String,
    pub direction: String,
    pub counterparty: Option<String>,
    pub principal_minor: i64,
    pub currency: Option<String>,
    pub start_on: String,
    pub due_on: Option<String>,
    pub interest_bp: Option<i64>,
    pub note: Option<String>,
    #[serde(default)]
    pub archived: bool,
    pub installment: Option<InstallmentInput>,
}

const SELECT: &str = "
    SELECT d.id, d.title, d.direction, d.counterparty_id, c.name, d.principal_minor, d.currency,
           d.start_on, d.due_on, d.interest_bp, d.note, d.archived, d.recurring_rule_id,
           coalesce((SELECT sum(amount_minor) FROM transactions t WHERE t.debt_id = d.id AND t.deleted = 0), 0),
           (SELECT count(*) FROM transactions t WHERE t.debt_id = d.id AND t.deleted = 0),
           (SELECT max(occurred_on) FROM transactions t WHERE t.debt_id = d.id AND t.deleted = 0)
    FROM debts d
    LEFT JOIN counterparties c ON c.id = d.counterparty_id
    WHERE d.deleted = 0";

struct RawDebt {
    debt: Debt,
    rule_id: Option<String>,
}

fn from_row(r: &Row) -> rusqlite::Result<RawDebt> {
    let principal: i64 = r.get(5)?;
    let paid: i64 = r.get(13)?;
    Ok(RawDebt {
        rule_id: r.get(12)?,
        debt: Debt {
            id: r.get(0)?,
            title: r.get(1)?,
            direction: r.get(2)?,
            counterparty_id: r.get(3)?,
            counterparty_name: r.get(4)?,
            principal_minor: principal,
            currency: r.get(6)?,
            start_on: r.get(7)?,
            due_on: r.get(8)?,
            interest_bp: r.get(9)?,
            note: r.get(10)?,
            archived: r.get(11)?,
            paid_minor: paid,
            remaining_minor: (principal - paid).max(0),
            payment_count: r.get(14)?,
            last_payment_on: r.get(15)?,
            installment: None,
            next_payment_on: None,
            payoff_on: None,
        },
    })
}

fn enrich(conn: &Connection, raw: RawDebt, today: NaiveDate) -> AppResult<Debt> {
    let mut d = raw.debt;
    if let Some(rule_id) = raw.rule_id {
        if let Ok(rule) = recurring::get(conn, &rule_id, today) {
            d.next_payment_on = rule.next_on.clone();

            if d.remaining_minor > 0 {
                let horizon = today + chrono::Duration::days(365 * 30);
                let mut left = d.remaining_minor;
                for day in rule.schedule().between(today, horizon) {
                    left -= rule.amount_minor;
                    if left <= 0 {
                        d.payoff_on = Some(day.to_string());
                        break;
                    }
                }
            }
            d.installment = Some(rule);
        }
    }
    if d.payoff_on.is_none() && d.remaining_minor > 0 {
        d.payoff_on = d.due_on.clone();
    }
    Ok(d)
}

pub fn list(conn: &Connection, today: NaiveDate) -> AppResult<Vec<Debt>> {
    let mut stmt = conn.prepare(&format!("{SELECT} ORDER BY d.archived, d.due_on IS NULL, d.due_on, d.created_at"))?;
    let raws = stmt.query_map([], from_row)?.collect::<Result<Vec<_>, _>>()?;
    raws.into_iter().map(|r| enrich(conn, r, today)).collect()
}

pub fn get(conn: &Connection, id: &str, today: NaiveDate) -> AppResult<Debt> {
    let raw = conn
        .query_row(&format!("{SELECT} AND d.id = ?1"), [id], from_row)
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("debt {id}")))?;
    enrich(conn, raw, today)
}

fn payment_kind(direction: &str) -> &'static str {
    if direction == "owed_to_me" { "income" } else { "expense" }
}

pub fn upsert(db: &Db, input: DebtInput, today: NaiveDate) -> AppResult<Debt> {
    if !matches!(input.direction.as_str(), "i_owe" | "owed_to_me") {
        return Err(AppError::Invalid(format!("unknown direction {:?}", input.direction)));
    }
    if input.principal_minor <= 0 {
        return Err(AppError::Invalid("amount must be positive".into()));
    }
    let title = input.title.trim();
    if title.is_empty() {
        return Err(AppError::Invalid("title is required".into()));
    }
    NaiveDate::parse_from_str(&input.start_on, "%Y-%m-%d")
        .map_err(|_| AppError::Invalid("invalid start date".into()))?;

    let mut conn = db.conn();
    let tx = conn.transaction()?;
    let currency = match &input.currency {
        Some(c) if !c.trim().is_empty() => c.trim().to_uppercase(),
        _ => super::currency::main_currency(&tx)?,
    };
    let counterparty_id = match &input.counterparty {
        Some(name) => counterparties::find_or_create(db, &tx, name)?,
        None => None,
    };
    let existing_rule: Option<String> = match &input.id {
        Some(id) => tx
            .query_row("SELECT recurring_rule_id FROM debts WHERE id = ?1 AND deleted = 0", [id], |r| r.get(0))
            .optional()?
            .ok_or_else(|| AppError::NotFound(format!("debt {id}")))?,
        None => None,
    };

    let rule_id = match &input.installment {
        Some(inst) => {
            let already_paid: i64 = match &input.id {
                Some(id) => tx.query_row(
                    "SELECT coalesce(sum(amount_minor), 0) FROM transactions WHERE debt_id = ?1 AND deleted = 0",
                    [id],
                    |r| r.get(0),
                )?,
                None => 0,
            };
            if inst.amount_minor <= 0 {
                return Err(AppError::Invalid("installment must be positive".into()));
            }
            let rule_input = RecurringInput {
                id: existing_rule.clone(),
                title: title.to_owned(),
                kind: payment_kind(&input.direction).into(),
                amount_minor: inst.amount_minor,
                account_id: inst.account_id.clone(),
                to_account_id: None,
                category_id: None,
                counterparty: input.counterparty.clone(),
                freq: inst.freq.clone(),
                interval_n: inst.interval_n,
                start_on: inst.start_on.clone(),
                end_on: input.due_on.clone(),
                max_count: None,
                auto_post: inst.auto_post,
                backfill: false,
                occurred_time: match &existing_rule {
                    Some(id) => tx
                        .query_row("SELECT occurred_time FROM recurring_rules WHERE id = ?1", [id], |r| r.get(0))
                        .optional()?
                        .flatten(),
                    None => None,
                },
                note: None,
            };
            let id = recurring::upsert_in(db, &tx, &rule_input, today)?;

            let posted: i64 = tx.query_row(
                "SELECT count(*) FROM transactions WHERE recurring_rule_id = ?1 AND deleted = 0",
                [&id],
                |r| r.get(0),
            )?;
            let remaining = (input.principal_minor - already_paid).max(0);
            let needed = (remaining + inst.amount_minor - 1) / inst.amount_minor;
            tx.execute("UPDATE recurring_rules SET max_count = ?2 WHERE id = ?1", params![id, posted + needed])?;
            Some(id)
        }
        None => {
            if let Some(old) = &existing_rule {
                tx.execute(
                    "UPDATE recurring_rules SET deleted = 1, updated_hlc = ?2 WHERE id = ?1",
                    params![old, db.hlc.tick()],
                )?;
            }
            None
        }
    };

    let hlc = db.hlc.tick();
    let id = match &input.id {
        Some(id) => {
            tx.execute(
                "UPDATE debts SET title = ?2, direction = ?3, counterparty_id = ?4, principal_minor = ?5,
                        currency = ?6, start_on = ?7, due_on = ?8, interest_bp = ?9, note = ?10,
                        archived = ?11, recurring_rule_id = ?12, updated_hlc = ?13
                 WHERE id = ?1",
                params![
                    id, title, input.direction, counterparty_id, input.principal_minor, currency,
                    input.start_on, input.due_on, input.interest_bp, input.note, input.archived,
                    rule_id, hlc
                ],
            )?;
            id.clone()
        }
        None => {
            let id = new_id();
            tx.execute(
                "INSERT INTO debts (id, title, direction, counterparty_id, principal_minor, currency,
                        start_on, due_on, interest_bp, recurring_rule_id, note, archived, created_at,
                        device_id, updated_hlc)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
                params![
                    id, title, input.direction, counterparty_id, input.principal_minor, currency,
                    input.start_on, input.due_on, input.interest_bp, rule_id, input.note,
                    input.archived, now_rfc3339(), db.device_id(), hlc
                ],
            )?;
            id
        }
    };
    tx.commit()?;
    drop(conn);
    recurring::materialize_due(db, today)?;
    get(&db.conn(), &id, today)
}

pub fn delete(db: &Db, id: &str) -> AppResult<()> {
    let mut conn = db.conn();
    let tx = conn.transaction()?;
    let rule: Option<String> = tx
        .query_row("SELECT recurring_rule_id FROM debts WHERE id = ?1 AND deleted = 0", [id], |r| r.get(0))
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("debt {id}")))?;
    let hlc = db.hlc.tick();
    tx.execute("UPDATE debts SET deleted = 1, updated_hlc = ?2 WHERE id = ?1", params![id, hlc])?;
    if let Some(rule) = rule {
        tx.execute("UPDATE recurring_rules SET deleted = 1, updated_hlc = ?2 WHERE id = ?1", params![rule, hlc])?;
    }
    tx.commit()?;
    Ok(())
}

pub fn record_payment(
    db: &Db,
    debt_id: &str,
    amount_minor: i64,
    on: &str,
    account_id: &str,
    today: NaiveDate,
) -> AppResult<Debt> {
    let debt = get(&db.conn(), debt_id, today)?;
    transactions::create(
        db,
        transactions::TransactionInput {
            kind: payment_kind(&debt.direction).into(),
            amount_minor,
            currency: Some(debt.currency.clone()),
            occurred_on: on.into(),
            occurred_time: None,
            account_id: account_id.into(),
            to_account_id: None,
            category_id: None,
            counterparty: debt.counterparty_name.clone(),
            title: debt.title.clone(),
            note: None,
            tags: vec![],
            debt_id: Some(debt.id.clone()),
            goal_id: None,
        },
    )?;
    get(&db.conn(), debt_id, today)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::accounts;

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn installments_cover_debt_and_stop() {
        let db = Db::open_in_memory().unwrap();
        let acc = accounts::list(&db.conn()).unwrap()[0].id.clone();
        let today = d("2026-10-08");
        let debt = upsert(
            &db,
            DebtInput {
                id: None,
                title: "Laptop Ratenkauf".into(),
                direction: "i_owe".into(),
                counterparty: Some("Media Markt".into()),
                principal_minor: 100_000,
                currency: None,
                start_on: "2026-10-01".into(),
                due_on: None,
                interest_bp: None,
                note: None,
                archived: false,
                installment: Some(InstallmentInput {
                    amount_minor: 30_000,
                    freq: "monthly".into(),
                    interval_n: 1,
                    start_on: "2026-11-01".into(),
                    account_id: acc.clone(),
                    auto_post: true,
                }),
            },
            today,
        )
        .unwrap();
        assert_eq!(debt.remaining_minor, 100_000);
        assert_eq!(debt.next_payment_on.as_deref(), Some("2026-11-01"));

        assert_eq!(debt.payoff_on.as_deref(), Some("2027-02-01"));

        let debt = record_payment(&db, &debt.id, 10_000, "2026-10-08", &acc, today).unwrap();
        assert_eq!(debt.paid_minor, 10_000);
        assert_eq!(debt.remaining_minor, 90_000);
        assert_eq!(debt.payment_count, 1);

        recurring::materialize_due(&db, d("2027-12-31")).unwrap();
        let debt = get(&db.conn(), &debt.id, d("2027-12-31")).unwrap();
        assert_eq!(debt.payment_count, 5, "one manual payment + four installments, then the rule stops");
        assert_eq!(debt.remaining_minor, 0);
    }
}
