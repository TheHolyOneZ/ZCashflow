use std::collections::HashSet;

use chrono::{Duration, Months, NaiveDate};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use super::{counterparties, transactions};
use crate::db::{new_id, now_rfc3339, Db};
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Freq {
    Daily,
    Weekly,
    Monthly,
    Yearly,
}

impl Freq {
    pub fn parse(s: &str) -> AppResult<Self> {
        Ok(match s {
            "daily" => Freq::Daily,
            "weekly" => Freq::Weekly,
            "monthly" => Freq::Monthly,
            "yearly" => Freq::Yearly,
            _ => return Err(AppError::Invalid(format!("unknown frequency {s:?}"))),
        })
    }
}

#[derive(Debug, Clone)]
pub struct Schedule {
    pub freq: Freq,
    pub interval: u32,
    pub start: NaiveDate,
    pub end: Option<NaiveDate>,
    pub max_count: Option<u32>,
}

impl Schedule {
    fn nth(&self, n: u32) -> Option<NaiveDate> {
        let step = n.checked_mul(self.interval)?;
        match self.freq {
            Freq::Daily => self.start.checked_add_signed(Duration::days(step as i64)),
            Freq::Weekly => self.start.checked_add_signed(Duration::weeks(step as i64)),
            Freq::Monthly => self.start.checked_add_months(Months::new(step)),
            Freq::Yearly => self.start.checked_add_months(Months::new(step.checked_mul(12)?)),
        }
    }

    pub fn between(&self, from: NaiveDate, to: NaiveDate) -> Vec<NaiveDate> {
        let mut out = Vec::new();

        let mut n = match self.freq {
            Freq::Daily if from > self.start => ((from - self.start).num_days() as u32 / self.interval).saturating_sub(1),
            Freq::Weekly if from > self.start => {
                ((from - self.start).num_days() as u32 / (7 * self.interval)).saturating_sub(1)
            }
            _ => 0,
        };
        loop {
            if self.max_count.is_some_and(|max| n >= max) {
                break;
            }
            let Some(d) = self.nth(n) else { break };
            if d > to || self.end.is_some_and(|end| d > end) {
                break;
            }
            if d >= from {
                out.push(d);
            }
            n += 1;
        }
        out
    }

    pub fn next_on_or_after(&self, from: NaiveDate) -> Option<NaiveDate> {
        let horizon = from + Duration::days(366 * self.interval as i64 + 1);
        self.between(from, horizon).into_iter().next()
    }

    pub fn monthly_equivalent(&self, amount_minor: i64) -> i64 {
        let per_month = match self.freq {
            Freq::Daily => amount_minor as f64 * 365.25 / 12.0,
            Freq::Weekly => amount_minor as f64 * 52.0 / 12.0,
            Freq::Monthly => amount_minor as f64,
            Freq::Yearly => amount_minor as f64 / 12.0,
        };
        (per_month / self.interval as f64).round() as i64
    }
}

pub fn occurrence_key(rule_id: &str, date: NaiveDate) -> String {
    format!("{rule_id}:{date}")
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecurringRule {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub amount_minor: i64,
    pub currency: String,
    pub account_id: String,
    pub to_account_id: Option<String>,
    pub category_id: Option<String>,
    pub counterparty_id: Option<String>,
    pub counterparty_name: Option<String>,
    pub freq: String,
    pub interval_n: u32,
    pub start_on: String,
    pub end_on: Option<String>,
    pub max_count: Option<u32>,
    pub auto_post: bool,
    pub post_from: String,
    pub occurred_time: Option<String>,
    pub note: Option<String>,
    pub debt_id: Option<String>,
    pub next_on: Option<String>,
    pub monthly_minor: i64,
    pub posted_count: u32,
}

impl RecurringRule {
    pub fn schedule(&self) -> Schedule {
        Schedule {
            freq: Freq::parse(&self.freq).unwrap_or(Freq::Monthly),
            interval: self.interval_n.max(1),
            start: date(&self.start_on),
            end: self.end_on.as_deref().map(date),
            max_count: self.max_count,
        }
    }
}

fn date(s: &str) -> NaiveDate {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap_or_default()
}

fn parse_date(s: &str, field: &str) -> AppResult<NaiveDate> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").map_err(|_| AppError::Invalid(format!("invalid {field} {s:?}")))
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecurringInput {
    pub id: Option<String>,
    pub title: String,
    pub kind: String,
    pub amount_minor: i64,
    pub account_id: String,
    pub to_account_id: Option<String>,
    pub category_id: Option<String>,
    pub counterparty: Option<String>,
    pub freq: String,
    pub interval_n: u32,
    pub start_on: String,
    pub end_on: Option<String>,
    pub max_count: Option<u32>,
    pub auto_post: bool,

    #[serde(default)]
    pub backfill: bool,
    #[serde(default)]
    pub occurred_time: Option<String>,
    pub note: Option<String>,
}

const SELECT: &str = "
    SELECT r.id, r.title, r.kind, r.amount_minor, r.currency, r.account_id, r.to_account_id,
           r.category_id, r.counterparty_id, c.name, r.freq, r.interval_n, r.start_on, r.end_on,
           r.max_count, r.auto_post, coalesce(r.post_from, r.start_on), r.note,
           (SELECT d.id FROM debts d WHERE d.recurring_rule_id = r.id AND d.deleted = 0 LIMIT 1),
           (SELECT count(*) FROM transactions t WHERE t.recurring_rule_id = r.id AND t.deleted = 0),
           r.occurred_time
    FROM recurring_rules r
    LEFT JOIN counterparties c ON c.id = r.counterparty_id
    WHERE r.deleted = 0";

fn from_row(r: &Row) -> rusqlite::Result<RecurringRule> {
    Ok(RecurringRule {
        id: r.get(0)?,
        title: r.get(1)?,
        kind: r.get(2)?,
        amount_minor: r.get(3)?,
        currency: r.get(4)?,
        account_id: r.get(5)?,
        to_account_id: r.get(6)?,
        category_id: r.get(7)?,
        counterparty_id: r.get(8)?,
        counterparty_name: r.get(9)?,
        freq: r.get(10)?,
        interval_n: r.get(11)?,
        start_on: r.get(12)?,
        end_on: r.get(13)?,
        max_count: r.get(14)?,
        auto_post: r.get(15)?,
        post_from: r.get(16)?,
        occurred_time: r.get(20)?,
        note: r.get(17)?,
        debt_id: r.get(18)?,
        posted_count: r.get(19)?,
        next_on: None,
        monthly_minor: 0,
    })
}

fn enrich(mut rule: RecurringRule, today: NaiveDate) -> RecurringRule {
    let s = rule.schedule();
    rule.next_on = s.next_on_or_after(today).map(|d| d.to_string());
    rule.monthly_minor = if rule.next_on.is_some() { s.monthly_equivalent(rule.amount_minor) } else { 0 };
    rule
}

pub fn list(conn: &Connection, today: NaiveDate) -> AppResult<Vec<RecurringRule>> {
    let mut stmt = conn.prepare(&format!("{SELECT} ORDER BY r.kind DESC, r.amount_minor DESC"))?;
    let rows = stmt.query_map([], from_row)?;
    Ok(rows.map(|r| r.map(|r| enrich(r, today))).collect::<Result<_, _>>()?)
}

pub fn get(conn: &Connection, id: &str, today: NaiveDate) -> AppResult<RecurringRule> {
    conn.query_row(&format!("{SELECT} AND r.id = ?1"), [id], from_row)
        .optional()?
        .map(|r| enrich(r, today))
        .ok_or_else(|| AppError::NotFound(format!("recurring rule {id}")))
}

pub fn upsert(db: &Db, input: RecurringInput, today: NaiveDate) -> AppResult<RecurringRule> {
    let mut conn = db.conn();
    let tx = conn.transaction()?;
    let id = upsert_in(db, &tx, &input, today)?;
    tx.commit()?;
    drop(conn);
    materialize_due(db, today)?;
    get(&db.conn(), &id, today)
}

pub fn upsert_in(db: &Db, conn: &Connection, input: &RecurringInput, today: NaiveDate) -> AppResult<String> {
    if !matches!(input.kind.as_str(), "income" | "expense" | "transfer") {
        return Err(AppError::Invalid(format!("unknown kind {:?}", input.kind)));
    }
    if input.amount_minor <= 0 {
        return Err(AppError::Invalid("amount must be positive".into()));
    }
    if input.title.trim().is_empty() {
        return Err(AppError::Invalid("title is required".into()));
    }
    Freq::parse(&input.freq)?;
    let start = parse_date(&input.start_on, "start date")?;
    if let Some(end) = &input.end_on {
        if parse_date(end, "end date")? < start {
            return Err(AppError::Invalid("end date is before start date".into()));
        }
    }
    if (input.kind == "transfer") != input.to_account_id.is_some() {
        return Err(AppError::Invalid("only transfers have a target account".into()));
    }
    let account = super::accounts::get(conn, &input.account_id)?;
    let counterparty_id = match &input.counterparty {
        Some(name) => counterparties::find_or_create(db, conn, name)?,
        None => None,
    };
    let post_from = if input.backfill { start } else { today.max(start) }.to_string();
    let occurred_time = match input.occurred_time.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(s) => Some(
            transactions::parse_time(s)
                .ok_or_else(|| AppError::Invalid(format!("invalid time {s:?}")))?
                .format("%H:%M")
                .to_string(),
        ),
        None => None,
    };
    let hlc = db.hlc.tick();

    match &input.id {
        Some(id) => {
            let n = conn.execute(
                "UPDATE recurring_rules SET title = ?2, kind = ?3, amount_minor = ?4, currency = ?5,
                        account_id = ?6, to_account_id = ?7, category_id = ?8, counterparty_id = ?9,
                        freq = ?10, interval_n = ?11, start_on = ?12, end_on = ?13, max_count = ?14,
                        auto_post = ?15, note = ?16, updated_hlc = ?17,
                        post_from = CASE WHEN ?18 THEN ?19 ELSE post_from END, occurred_time = ?20
                 WHERE id = ?1 AND deleted = 0",
                params![
                    id, input.title.trim(), input.kind, input.amount_minor, account.currency,
                    input.account_id, input.to_account_id, input.category_id, counterparty_id,
                    input.freq, input.interval_n.max(1), input.start_on, input.end_on,
                    input.max_count, input.auto_post, input.note, hlc, input.backfill, post_from,
                    occurred_time
                ],
            )?;
            if n == 0 {
                return Err(AppError::NotFound(format!("recurring rule {id}")));
            }
            Ok(id.clone())
        }
        None => {
            let id = new_id();
            conn.execute(
                "INSERT INTO recurring_rules (id, title, kind, amount_minor, currency, account_id,
                        to_account_id, category_id, counterparty_id, freq, interval_n, start_on,
                        end_on, max_count, auto_post, post_from, note, created_at, device_id, updated_hlc,
                        occurred_time)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)",
                params![
                    id, input.title.trim(), input.kind, input.amount_minor, account.currency,
                    input.account_id, input.to_account_id, input.category_id, counterparty_id,
                    input.freq, input.interval_n.max(1), input.start_on, input.end_on,
                    input.max_count, input.auto_post, post_from, input.note, now_rfc3339(),
                    db.device_id(), hlc, occurred_time
                ],
            )?;
            Ok(id)
        }
    }
}

pub fn delete(db: &Db, id: &str) -> AppResult<()> {
    let n = db.conn().execute(
        "UPDATE recurring_rules SET deleted = 1, updated_hlc = ?2 WHERE id = ?1 AND deleted = 0",
        params![id, db.hlc.tick()],
    )?;
    if n == 0 {
        return Err(AppError::NotFound(format!("recurring rule {id}")));
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Occurrence {
    pub rule_id: String,
    pub date: String,
    pub time: Option<String>,
    pub title: String,
    pub kind: String,
    pub amount_minor: i64,
    pub currency: String,
    pub account_id: String,
    pub to_account_id: Option<String>,
    pub category_id: Option<String>,
    pub debt_id: Option<String>,
    pub auto_post: bool,

    pub overdue: bool,
}

fn handled_keys(conn: &Connection) -> AppResult<HashSet<String>> {
    let mut keys = HashSet::new();
    let mut stmt = conn.prepare(
        "SELECT occurrence_key FROM transactions WHERE occurrence_key IS NOT NULL
         UNION ALL SELECT occurrence_key FROM recurring_skips WHERE deleted = 0",
    )?;
    for k in stmt.query_map([], |r| r.get::<_, String>(0))? {
        keys.insert(k?);
    }
    Ok(keys)
}

pub fn occurrences(conn: &Connection, today: NaiveDate, to: NaiveDate) -> AppResult<Vec<Occurrence>> {
    let rules = list(conn, today)?;
    let handled = handled_keys(conn)?;
    let mut out = Vec::new();
    for rule in rules {
        let s = rule.schedule();
        let from = date(&rule.post_from).max(today - Duration::days(120));
        for d in s.between(from, to) {
            if handled.contains(&occurrence_key(&rule.id, d)) {
                continue;
            }
            out.push(Occurrence {
                rule_id: rule.id.clone(),
                date: d.to_string(),
                time: rule.occurred_time.clone(),
                title: rule.title.clone(),
                kind: rule.kind.clone(),
                amount_minor: rule.amount_minor,
                currency: rule.currency.clone(),
                account_id: rule.account_id.clone(),
                to_account_id: rule.to_account_id.clone(),
                category_id: rule.category_id.clone(),
                debt_id: rule.debt_id.clone(),
                auto_post: rule.auto_post,
                overdue: d <= today,
            });
        }
    }
    out.sort_by(|a, b| a.date.cmp(&b.date).then(a.time.cmp(&b.time)).then(b.amount_minor.cmp(&a.amount_minor)));
    Ok(out)
}

fn post(db: &Db, conn: &Connection, rule: &RecurringRule, on: NaiveDate, amount_minor: i64) -> AppResult<String> {
    let key = occurrence_key(&rule.id, on);
    let input = transactions::TransactionInput {
        kind: rule.kind.clone(),
        amount_minor,
        currency: Some(rule.currency.clone()),
        occurred_on: on.to_string(),
        occurred_time: rule.occurred_time.clone(),
        account_id: rule.account_id.clone(),
        to_account_id: rule.to_account_id.clone(),
        category_id: rule.category_id.clone(),
        counterparty: rule.counterparty_name.clone(),
        title: rule.title.clone(),
        note: None,
        tags: vec![],
        debt_id: rule.debt_id.clone(),
        goal_id: None,
    };
    transactions::insert(
        db,
        conn,
        &input,
        transactions::SystemLinks {
            id: Some(crate::db::det_id("occurrence", &key)),
            recurring_rule_id: Some(&rule.id),
            occurrence_key: Some(&key),
        },
    )
}

pub fn materialize_due(db: &Db, today: NaiveDate) -> AppResult<usize> {
    let now = chrono::Local::now().naive_local();
    materialize_until(db, today, (now.date() == today).then(|| now.time()))
}

fn materialize_until(db: &Db, today: NaiveDate, now: Option<chrono::NaiveTime>) -> AppResult<usize> {
    let not_yet = |rule: &RecurringRule, d: NaiveDate| {
        d == today
            && now.is_some_and(|now| {
                rule.occurred_time.as_deref().and_then(transactions::parse_time).is_some_and(|at| at > now)
            })
    };
    let mut conn = db.conn();
    let tx = conn.transaction()?;
    let rules = list(&tx, today)?;
    let handled = handled_keys(&tx)?;
    let mut posted = 0;
    for rule in rules.iter().filter(|r| r.auto_post) {
        for d in rule.schedule().between(date(&rule.post_from), today) {
            if !handled.contains(&occurrence_key(&rule.id, d)) && !not_yet(rule, d) {
                post(db, &tx, rule, d, rule.amount_minor)?;
                posted += 1;
            }
        }
    }
    tx.commit()?;
    Ok(posted)
}

pub fn confirm(db: &Db, rule_id: &str, on: &str, amount_minor: Option<i64>, today: NaiveDate) -> AppResult<String> {
    let on = parse_date(on, "date")?;
    let mut conn = db.conn();
    let tx = conn.transaction()?;
    let rule = get(&tx, rule_id, today)?;
    let id = post(db, &tx, &rule, on, amount_minor.unwrap_or(rule.amount_minor))?;
    tx.commit()?;
    Ok(id)
}

pub fn skip(db: &Db, rule_id: &str, on: &str) -> AppResult<()> {
    let on = parse_date(on, "date")?;
    db.conn().execute(
        "INSERT OR IGNORE INTO recurring_skips (occurrence_key, rule_id, created_at, device_id, updated_hlc)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![occurrence_key(rule_id, on), rule_id, now_rfc3339(), db.device_id(), db.hlc.tick()],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::accounts;

    fn d(s: &str) -> NaiveDate {
        date(s)
    }

    fn monthly(start: &str) -> Schedule {
        Schedule { freq: Freq::Monthly, interval: 1, start: d(start), end: None, max_count: None }
    }

    #[test]
    fn month_end_does_not_drift() {
        let got: Vec<String> =
            monthly("2026-01-31").between(d("2026-01-01"), d("2026-04-30")).iter().map(|d| d.to_string()).collect();
        assert_eq!(got, ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    }

    #[test]
    fn respects_end_count_and_interval() {
        let mut s = monthly("2026-01-15");
        s.max_count = Some(3);
        assert_eq!(s.between(d("2026-01-01"), d("2027-01-01")).len(), 3);
        let mut s = monthly("2026-01-15");
        s.end = Some(d("2026-03-14"));
        assert_eq!(s.between(d("2026-01-01"), d("2027-01-01")).len(), 2);
        let s = Schedule { freq: Freq::Weekly, interval: 2, start: d("2026-01-05"), end: None, max_count: None };
        assert_eq!(
            s.between(d("2026-01-06"), d("2026-02-10")).iter().map(|d| d.to_string()).collect::<Vec<_>>(),
            ["2026-01-19", "2026-02-02"]
        );
    }

    #[test]
    fn daily_skip_ahead_still_finds_first_match() {
        let s = Schedule { freq: Freq::Daily, interval: 3, start: d("2020-01-01"), end: None, max_count: None };
        let got = s.between(d("2026-10-08"), d("2026-10-14"));
        let got: Vec<String> = got.iter().map(|d| d.to_string()).collect();
        assert_eq!(got, ["2026-10-08", "2026-10-11", "2026-10-14"]);
    }

    #[test]
    fn monthly_equivalents() {
        let s = |freq, interval| Schedule { freq, interval, start: d("2026-01-01"), end: None, max_count: None };
        assert_eq!(s(Freq::Yearly, 1).monthly_equivalent(12_000), 1_000);
        assert_eq!(s(Freq::Weekly, 1).monthly_equivalent(1_200), 5_200);
        assert_eq!(s(Freq::Monthly, 3).monthly_equivalent(3_000), 1_000);
    }

    fn rule(db: &Db, start: &str, auto: bool, backfill: bool, today: NaiveDate) -> RecurringRule {
        let acc = accounts::list(&db.conn()).unwrap()[0].id.clone();
        upsert(
            db,
            RecurringInput {
                id: None,
                title: "Miete".into(),
                kind: "expense".into(),
                amount_minor: 80_000,
                account_id: acc,
                to_account_id: None,
                category_id: None,
                counterparty: Some("Vermieter".into()),
                freq: "monthly".into(),
                interval_n: 1,
                start_on: start.into(),
                end_on: None,
                max_count: None,
                auto_post: auto,
                backfill,
                occurred_time: None,
                note: None,
            },
            today,
        )
        .unwrap()
    }

    #[test]
    fn auto_post_is_idempotent_and_respects_backfill() {
        let db = Db::open_in_memory().unwrap();
        let today = d("2026-10-08");
        let r = rule(&db, "2026-07-01", true, true, today);
        assert_eq!(r.posted_count, 4, "Jul–Oct are posted on creation");
        assert_eq!(materialize_due(&db, today).unwrap(), 0);
        let txs = transactions::list(&db.conn(), &Default::default()).unwrap();
        assert_eq!(txs.len(), 4);
        assert!(txs.iter().all(|t| t.recurring_rule_id.as_deref() == Some(r.id.as_str())));

        let r2 = rule(&db, "2026-07-01", true, false, today);
        let n = transactions::list(&db.conn(), &Default::default())
            .unwrap()
            .iter()
            .filter(|t| t.recurring_rule_id.as_deref() == Some(r2.id.as_str()))
            .count();
        assert_eq!(n, 0, "without backfill only occurrences from today on are posted");
        assert_eq!(materialize_due(&db, d("2026-11-01")).unwrap(), 2, "both rules post November");
    }

    #[test]
    fn timed_rules_post_once_their_time_has_come() {
        let db = Db::open_in_memory().unwrap();
        let today = d("2026-10-08");
        let acc = accounts::list(&db.conn()).unwrap()[0].id.clone();
        let input = RecurringInput {
            id: None,
            title: "Gehalt".into(),
            kind: "income".into(),
            amount_minor: 250_000,
            account_id: acc,
            to_account_id: None,
            category_id: None,
            counterparty: None,
            freq: "daily".into(),
            interval_n: 1,
            start_on: "2026-10-07".into(),
            end_on: None,
            max_count: None,
            auto_post: true,
            backfill: true,
            occurred_time: Some("9.30".into()),
            note: None,
        };
        let id = upsert_in(&db, &db.conn(), &input, today).unwrap();
        assert_eq!(get(&db.conn(), &id, today).unwrap().occurred_time.as_deref(), Some("09:30"));
        let at = |s: &str| Some(chrono::NaiveTime::parse_from_str(s, "%H:%M").unwrap());

        assert_eq!(materialize_until(&db, today, at("09:29")).unwrap(), 1, "yesterday is due, today waits for 09:30");
        let upcoming = occurrences(&db.conn(), today, today).unwrap();
        assert_eq!((upcoming[0].date.as_str(), upcoming[0].time.as_deref()), ("2026-10-08", Some("09:30")));

        assert_eq!(materialize_until(&db, today, at("09:30")).unwrap(), 1);
        let txs = transactions::list(&db.conn(), &Default::default()).unwrap();
        assert!(txs.iter().all(|t| t.occurred_time.as_deref() == Some("09:30")));
        assert_eq!(txs.len(), 2);

        let mut bad = input.clone();
        bad.occurred_time = Some("9:75".into());
        assert!(upsert_in(&db, &db.conn(), &bad, today).is_err());
    }

    #[test]
    fn deleted_posting_is_not_recreated() {
        let db = Db::open_in_memory().unwrap();
        let today = d("2026-10-01");
        rule(&db, "2026-10-01", true, false, today);
        let t = transactions::list(&db.conn(), &Default::default()).unwrap().remove(0);
        transactions::delete(&db, &t.id).unwrap();
        assert_eq!(materialize_due(&db, today).unwrap(), 0);
    }

    #[test]
    fn manual_rules_wait_for_confirmation_or_skip() {
        let db = Db::open_in_memory().unwrap();
        let today = d("2026-10-08");
        let r = rule(&db, "2026-09-01", false, true, today);
        let pending: Vec<_> = occurrences(&db.conn(), today, today).unwrap();
        assert_eq!(pending.iter().map(|o| o.date.as_str()).collect::<Vec<_>>(), ["2026-09-01", "2026-10-01"]);
        assert!(pending.iter().all(|o| o.overdue));

        confirm(&db, &r.id, "2026-09-01", Some(79_000), today).unwrap();
        skip(&db, &r.id, "2026-10-01").unwrap();
        assert!(occurrences(&db.conn(), today, today).unwrap().is_empty());
        let txs = transactions::list(&db.conn(), &Default::default()).unwrap();
        assert_eq!(txs.len(), 1);
        assert_eq!(txs[0].amount_minor, 79_000);

        let upcoming = occurrences(&db.conn(), today, d("2026-12-31")).unwrap();
        assert_eq!(upcoming.iter().map(|o| o.date.as_str()).collect::<Vec<_>>(), ["2026-11-01", "2026-12-01"]);
    }
}
