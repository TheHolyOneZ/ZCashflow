use chrono::{Datelike, NaiveDate, NaiveTime};
use rusqlite::{params, params_from_iter, types::Value, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use super::{accounts, counterparties};
use crate::db::{get_meta, new_id, now_rfc3339, set_meta, Db};
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Transaction {
    pub id: String,
    pub r#ref: String,
    pub kind: String,
    pub amount_minor: i64,
    pub currency: String,
    pub occurred_on: String,
    pub occurred_time: Option<String>,
    pub account_id: String,
    pub to_account_id: Option<String>,
    pub category_id: Option<String>,
    pub counterparty_id: Option<String>,
    pub counterparty_name: Option<String>,
    pub title: String,
    pub note: Option<String>,
    pub tags: Vec<String>,
    pub recurring_rule_id: Option<String>,
    pub debt_id: Option<String>,
    pub goal_id: Option<String>,
    pub created_at: String,
    pub attachment_count: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionInput {
    pub kind: String,
    pub amount_minor: i64,

    pub currency: Option<String>,
    pub occurred_on: String,
    #[serde(default)]
    pub occurred_time: Option<String>,
    pub account_id: String,
    pub to_account_id: Option<String>,
    pub category_id: Option<String>,

    pub counterparty: Option<String>,
    pub title: String,
    pub note: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub debt_id: Option<String>,
    pub goal_id: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionFilter {
    pub from: Option<String>,
    pub to: Option<String>,
    pub kind: Option<String>,
    pub account_id: Option<String>,
    pub category_id: Option<String>,
    pub category_ids: Option<Vec<String>>,
    pub query: Option<String>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

const SELECT: &str = "
    SELECT t.id, t.ref, t.kind, t.amount_minor, t.currency, t.occurred_on, t.account_id,
           t.to_account_id, t.category_id, t.counterparty_id, c.name, t.title, t.note, t.tags,
           t.recurring_rule_id, t.debt_id, t.goal_id, t.created_at,
           (SELECT count(*) FROM attachments a WHERE a.transaction_id = t.id AND a.deleted = 0),
           t.occurred_time
    FROM transactions t
    LEFT JOIN counterparties c ON c.id = t.counterparty_id
    WHERE t.deleted = 0";

fn from_row(r: &Row) -> rusqlite::Result<Transaction> {
    let tags: String = r.get(13)?;
    Ok(Transaction {
        id: r.get(0)?,
        r#ref: r.get(1)?,
        kind: r.get(2)?,
        amount_minor: r.get(3)?,
        currency: r.get(4)?,
        occurred_on: r.get(5)?,
        occurred_time: r.get(19)?,
        account_id: r.get(6)?,
        to_account_id: r.get(7)?,
        category_id: r.get(8)?,
        counterparty_id: r.get(9)?,
        counterparty_name: r.get(10)?,
        title: r.get(11)?,
        note: r.get(12)?,
        tags: serde_json::from_str(&tags).unwrap_or_default(),
        recurring_rule_id: r.get(14)?,
        debt_id: r.get(15)?,
        goal_id: r.get(16)?,
        created_at: r.get(17)?,
        attachment_count: r.get(18)?,
    })
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Transaction> {
    conn.query_row(&format!("{SELECT} AND t.id = ?1"), [id], from_row)
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("transaction {id}")),
            e => e.into(),
        })
}

fn fts_query(input: &str) -> Option<String> {
    let parts: Vec<String> = input
        .split_whitespace()
        .map(|w| format!("\"{}\"*", w.replace('"', "\"\"")))
        .collect();
    (!parts.is_empty()).then(|| parts.join(" "))
}

fn filter_sql(f: &TransactionFilter) -> (String, Vec<Value>) {
    let mut sql = String::new();
    let mut args: Vec<Value> = Vec::new();
    let mut push = |clause: &str, v: Value| {
        args.push(v);
        sql.push_str(&format!(" AND {clause} ?{}", args.len()));
    };
    if let Some(v) = &f.from {
        push("t.occurred_on >=", v.clone().into());
    }
    if let Some(v) = &f.to {
        push("t.occurred_on <=", v.clone().into());
    }
    if let Some(v) = &f.kind {
        push("t.kind =", v.clone().into());
    }
    if let Some(v) = &f.account_id {
        args.push(v.clone().into());
        let n = args.len();
        sql.push_str(&format!(" AND (t.account_id = ?{n} OR t.to_account_id = ?{n})"));
    }
    if let Some(v) = &f.category_id {
        args.push(v.clone().into());
        sql.push_str(&format!(
            " AND t.category_id IN (WITH RECURSIVE tree(id) AS (SELECT ?{n} UNION SELECT c.id FROM categories c JOIN tree ON c.parent_id = tree.id WHERE c.deleted = 0) SELECT id FROM tree)",
            n = args.len()
        ));
    }
    if let Some(ids) = f.category_ids.as_ref().filter(|ids| !ids.is_empty()) {
        let mut seeds = Vec::new();
        for id in ids.iter().filter(|id| !id.is_empty()) {
            args.push(id.clone().into());
            seeds.push(format!("SELECT ?{}", args.len()));
        }
        let mut parts = Vec::new();
        if !seeds.is_empty() {
            parts.push(format!(
                "t.category_id IN (WITH RECURSIVE tree(id) AS ({} UNION SELECT c.id FROM categories c JOIN tree ON c.parent_id = tree.id WHERE c.deleted = 0) SELECT id FROM tree)",
                seeds.join(" UNION ")
            ));
        }
        if ids.iter().any(String::is_empty) {
            parts.push("(t.category_id IS NULL AND t.kind <> 'transfer')".into());
        }
        sql.push_str(&format!(" AND ({})", parts.join(" OR ")));
    }
    if let Some(q) = f.query.as_deref().and_then(fts_query) {
        args.push(q.into());
        sql.push_str(&format!(
            " AND t.id IN (SELECT tx_id FROM transactions_fts WHERE transactions_fts MATCH ?{})",
            args.len()
        ));
    }
    (sql, args)
}

pub fn list(conn: &Connection, f: &TransactionFilter) -> AppResult<Vec<Transaction>> {
    let (filter, args) = filter_sql(f);
    let mut sql = format!("{SELECT}{filter}");
    sql.push_str(" ORDER BY t.occurred_on DESC, t.occurred_time DESC, t.created_at DESC");
    sql.push_str(&format!(
        " LIMIT {} OFFSET {}",
        f.limit.unwrap_or(500).min(5000),
        f.offset.unwrap_or(0)
    ));
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(args), from_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CurrencyTotal {
    pub currency: String,
    pub count: u32,
    pub income_minor: i64,
    pub expense_minor: i64,
    pub opening_minor: Option<i64>,
    pub closing_minor: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DayTotal {
    pub date: String,
    pub currency: String,
    pub income_minor: i64,
    pub expense_minor: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Totals {
    pub count: u32,
    pub currencies: Vec<CurrencyTotal>,
    pub days: Vec<DayTotal>,
}

pub fn totals(conn: &Connection, f: &TransactionFilter, today: NaiveDate) -> AppResult<Totals> {
    let (filter, args) = filter_sql(f);
    let mut stmt = conn.prepare(&format!(
        "SELECT t.occurred_on, t.currency, count(*),
                coalesce(sum(CASE WHEN t.kind = 'income'  THEN t.amount_minor END), 0),
                coalesce(sum(CASE WHEN t.kind = 'expense' THEN t.amount_minor END), 0)
         FROM transactions t WHERE t.deleted = 0{filter}
         GROUP BY t.occurred_on, t.currency
         ORDER BY t.occurred_on DESC, t.currency"
    ))?;
    let rows = stmt.query_map(params_from_iter(args), |r| {
        Ok((
            r.get::<_, u32>(2)?,
            DayTotal { date: r.get(0)?, currency: r.get(1)?, income_minor: r.get(3)?, expense_minor: r.get(4)? },
        ))
    })?;
    let mut out = Totals { count: 0, currencies: Vec::new(), days: Vec::new() };
    for row in rows {
        let (n, day) = row?;
        out.count += n;
        match out.currencies.iter_mut().find(|c| c.currency == day.currency) {
            Some(c) => {
                c.count += n;
                c.income_minor += day.income_minor;
                c.expense_minor += day.expense_minor;
            }
            None => out.currencies.push(CurrencyTotal {
                currency: day.currency.clone(),
                count: n,
                income_minor: day.income_minor,
                expense_minor: day.expense_minor,
                opening_minor: None,
                closing_minor: None,
            }),
        }
        out.days.push(day);
    }
    add_balances(conn, f, today, &mut out.currencies)?;
    out.currencies.sort_by_key(|c| std::cmp::Reverse(c.count));
    Ok(out)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategorySum {
    pub category_id: Option<String>,
    pub kind: String,
    pub currency: String,
    pub count: u32,
    pub total_minor: i64,
}

pub fn category_totals(conn: &Connection, f: &TransactionFilter) -> AppResult<Vec<CategorySum>> {
    let (filter, args) = filter_sql(f);
    let mut stmt = conn.prepare(&format!(
        "SELECT t.category_id, t.kind, t.currency, count(*), sum(t.amount_minor)
         FROM transactions t WHERE t.deleted = 0 AND t.kind IN ('income', 'expense'){filter}
         GROUP BY t.category_id, t.kind, t.currency
         ORDER BY sum(t.amount_minor) DESC"
    ))?;
    let rows = stmt.query_map(params_from_iter(args), |r| {
        Ok(CategorySum { category_id: r.get(0)?, kind: r.get(1)?, currency: r.get(2)?, count: r.get(3)?, total_minor: r.get(4)? })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn add_balances(conn: &Connection, f: &TransactionFilter, today: NaiveDate, out: &mut Vec<CurrencyTotal>) -> AppResult<()> {
    if f.kind.is_some() || f.category_id.is_some() || f.category_ids.as_ref().is_some_and(|ids| !ids.is_empty()) || f.query.as_deref().is_some_and(|q| !q.trim().is_empty()) {
        return Ok(());
    }
    let date = |s: &Option<String>| s.as_deref().and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok());
    let from = date(&f.from);
    let end = date(&f.to).unwrap_or(today);
    let picked = |a: &accounts::Account| match &f.account_id {
        Some(id) => &a.id == id,
        None => !a.archived,
    };
    let at_end: Vec<accounts::Account> = accounts::list_as_of(conn, end)?.into_iter().filter(picked).collect();
    let before = match from.and_then(|d| d.pred_opt()) {
        Some(d) => Some(accounts::list_as_of(conn, d)?.into_iter().filter(picked).collect::<Vec<_>>()),
        None => None,
    };
    for a in &at_end {
        let row = match out.iter_mut().position(|c| c.currency == a.currency) {
            Some(i) => &mut out[i],
            None => {
                out.push(CurrencyTotal {
                    currency: a.currency.clone(),
                    count: 0,
                    income_minor: 0,
                    expense_minor: 0,
                    opening_minor: None,
                    closing_minor: None,
                });
                out.last_mut().expect("just pushed")
            }
        };
        row.closing_minor = Some(row.closing_minor.unwrap_or(0) + a.balance_minor);
    }
    if let (Some(from), Some(before)) = (from, before) {
        for row in out.iter_mut() {
            let mine: Vec<&accounts::Account> = before.iter().filter(|a| a.currency == row.currency).collect();
            let corrected_in_period = mine.iter().any(|a| a.anchor_on.as_deref().is_some_and(|on| on >= (from - chrono::Duration::days(1)).to_string().as_str()));
            if !mine.is_empty() && !corrected_in_period {
                row.opening_minor = Some(mine.iter().map(|a| a.balance_minor).sum());
            }
        }
    }
    Ok(())
}

pub fn parse_time(s: &str) -> Option<NaiveTime> {
    let s = s.trim();
    ["%H:%M", "%H:%M:%S", "%H.%M", "%H%M"]
        .iter()
        .find_map(|fmt| NaiveTime::parse_from_str(s, fmt).ok())
}

struct Validated {
    occurred_on: NaiveDate,
    occurred_time: Option<String>,
    currency: String,
    title: String,
    tags: String,
}

fn validate(conn: &Connection, input: &TransactionInput) -> AppResult<Validated> {
    if !matches!(input.kind.as_str(), "income" | "expense" | "transfer") {
        return Err(AppError::Invalid(format!("unknown kind {:?}", input.kind)));
    }
    if input.amount_minor <= 0 {
        return Err(AppError::Invalid("amount must be positive".into()));
    }
    let occurred_on = NaiveDate::parse_from_str(&input.occurred_on, "%Y-%m-%d")
        .map_err(|_| AppError::Invalid(format!("invalid date {:?}", input.occurred_on)))?;
    let occurred_time = match input.occurred_time.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(s) => Some(
            parse_time(s)
                .ok_or_else(|| AppError::Invalid(format!("invalid time {s:?}")))?
                .format("%H:%M")
                .to_string(),
        ),
        None => None,
    };
    let account = accounts::get(conn, &input.account_id)?;
    match (input.kind.as_str(), &input.to_account_id) {
        ("transfer", None) => return Err(AppError::Invalid("transfer needs a target account".into())),
        ("transfer", Some(to)) if *to == input.account_id => {
            return Err(AppError::Invalid("transfer target must differ from source".into()))
        }
        ("transfer", Some(to)) => {
            accounts::get(conn, to)?;
        }
        (_, Some(_)) => return Err(AppError::Invalid("only transfers have a target account".into())),
        _ => {}
    }
    let currency = input
        .currency
        .as_deref()
        .map(|c| c.trim().to_uppercase())
        .filter(|c| !c.is_empty())
        .unwrap_or(account.currency);
    let tags: Vec<&str> = input.tags.iter().map(|t| t.trim()).filter(|t| !t.is_empty()).collect();
    Ok(Validated {
        occurred_on,
        occurred_time,
        currency,
        title: input.title.trim().to_owned(),
        tags: serde_json::to_string(&tags).expect("tags serialize"),
    })
}

fn next_ref(conn: &Connection, year: i32) -> AppResult<String> {
    let key = format!("ref_seq:{year}");
    let seq: u64 = get_meta(conn, &key)?.and_then(|s| s.parse().ok()).unwrap_or(0) + 1;
    set_meta(conn, &key, &seq.to_string())?;
    Ok(format!("TX-{year}-{seq:06}"))
}

#[derive(Debug, Default)]
pub struct SystemLinks<'a> {
    pub id: Option<String>,
    pub recurring_rule_id: Option<&'a str>,
    pub occurrence_key: Option<&'a str>,
}

pub fn insert(db: &Db, conn: &Connection, input: &TransactionInput, links: SystemLinks) -> AppResult<String> {
    let v = validate(conn, input)?;
    let counterparty_id = match &input.counterparty {
        Some(name) => counterparties::find_or_create(db, conn, name)?,
        None => None,
    };
    let id = links.id.clone().unwrap_or_else(new_id);
    let r#ref = next_ref(conn, v.occurred_on.year())?;
    conn.execute(
        "INSERT INTO transactions (id, ref, kind, amount_minor, currency, occurred_on, account_id,
                                   to_account_id, category_id, counterparty_id, title, note, tags,
                                   recurring_rule_id, occurrence_key, debt_id, goal_id, created_at,
                                   device_id, updated_hlc, occurred_time)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)",
        params![
            id, r#ref, input.kind, input.amount_minor, v.currency, v.occurred_on.to_string(),
            input.account_id, input.to_account_id, input.category_id, counterparty_id, v.title,
            input.note, v.tags, links.recurring_rule_id, links.occurrence_key, input.debt_id,
            input.goal_id, now_rfc3339(), db.device_id(), db.hlc.tick(), v.occurred_time
        ],
    )?;
    Ok(id)
}

pub fn create(db: &Db, input: TransactionInput) -> AppResult<Transaction> {
    let mut conn = db.conn();
    let tx = conn.transaction()?;
    let id = insert(db, &tx, &input, SystemLinks::default())?;
    let created = get(&tx, &id)?;
    tx.commit()?;
    Ok(created)
}

pub fn update(db: &Db, id: &str, input: TransactionInput) -> AppResult<Transaction> {
    let mut conn = db.conn();
    let tx = conn.transaction()?;
    let v = validate(&tx, &input)?;
    let counterparty_id = match &input.counterparty {
        Some(name) => counterparties::find_or_create(db, &tx, name)?,
        None => None,
    };
    let n = tx.execute(
        "UPDATE transactions SET kind = ?2, amount_minor = ?3, currency = ?4, occurred_on = ?5,
                account_id = ?6, to_account_id = ?7, category_id = ?8, counterparty_id = ?9,
                title = ?10, note = ?11, tags = ?12, debt_id = ?13, goal_id = ?14, updated_hlc = ?15,
                occurred_time = ?16
         WHERE id = ?1 AND deleted = 0",
        params![
            id, input.kind, input.amount_minor, v.currency, v.occurred_on.to_string(),
            input.account_id, input.to_account_id, input.category_id, counterparty_id, v.title,
            input.note, v.tags, input.debt_id, input.goal_id, db.hlc.tick(), v.occurred_time
        ],
    )?;
    if n == 0 {
        return Err(AppError::NotFound(format!("transaction {id}")));
    }
    let updated = get(&tx, id)?;
    tx.commit()?;
    Ok(updated)
}

pub fn delete(db: &Db, id: &str) -> AppResult<()> {
    let n = db.conn().execute(
        "UPDATE transactions SET deleted = 1, updated_hlc = ?2 WHERE id = ?1 AND deleted = 0",
        params![id, db.hlc.tick()],
    )?;
    if n == 0 {
        return Err(AppError::NotFound(format!("transaction {id}")));
    }
    Ok(())
}

const KEYWORDS: &[(&str, &[&str])] = &[
    (
        "category.groceries",
        &[
            "rewe", "edeka", "aldi", "lidl", "netto", "penny", "kaufland", "norma", "tegut", "globus", "spar", "supermarkt",
            "lebensmittel", "wocheneinkauf", "einkauf", "groceries", "biomarkt", "alnatura", "denns",
        ],
    ),
    (
        "category.food",
        &[
            "doener", "doner", "kebab", "pizza", "burger", "mcdonalds", "mcdonald", "kfc", "subway", "restaurant", "cafe",
            "kaffee", "coffee", "starbucks", "baecker", "baeckerei", "backerei", "broetchen", "brezel", "croissant", "kuchen", "imbiss", "mittag", "mittagessen", "abendessen",
            "fruehstueck", "lieferando", "wolt", "sushi", "snack", "mensa", "kantine", "bier", "bar", "eis", "essen",
        ],
    ),
    (
        "category.transport",
        &[
            "tanken", "tankstelle", "aral", "shell", "esso", "jet", "benzin", "diesel", "sprit", "bahn", "db", "deutschlandticket",
            "ticket", "fahrkarte", "bus", "taxi", "uber", "bolt", "parken", "parkhaus", "maut", "mvg", "bvg", "hvv", "kvb",
            "flixbus", "zug", "werkstatt", "tuev", "carsharing", "sixt",
        ],
    ),
    (
        "category.subscriptions",
        &[
            "netflix", "spotify", "disney", "prime", "youtube", "icloud", "chatgpt", "abo", "dazn", "sky", "crunchyroll",
            "audible", "patreon", "twitch",
        ],
    ),
    (
        "category.shopping",
        &[
            "amazon", "zalando", "ikea", "mediamarkt", "saturn", "otto", "ebay", "rossmann", "dm", "mueller", "primark", "kleidung",
            "schuhe", "kik", "tk", "action", "temu", "shein", "obi", "hornbach", "bauhaus",
        ],
    ),
    (
        "category.health",
        &[
            "apotheke", "arzt", "zahnarzt", "physio", "medikamente", "optiker", "brille", "fitness", "fitnessstudio", "gym",
            "mcfit", "krankenhaus", "therapie",
        ],
    ),
    (
        "category.leisure",
        &[
            "kino", "cinema", "konzert", "steam", "playstation", "xbox", "nintendo", "museum", "theater", "freizeitpark",
            "schwimmbad", "bowling", "festival", "urlaub", "hotel", "airbnb", "zoo", "club",
        ],
    ),
    ("category.housing", &["miete", "rent", "hausrat", "moebel", "wohnung"]),
    (
        "category.utilities",
        &[
            "strom", "gas", "wasser", "internet", "handy", "telekom", "vodafone", "o2", "congstar", "rundfunk", "gez",
            "nebenkosten", "heizung",
        ],
    ),
    ("category.salary", &["gehalt", "lohn", "salary", "paycheck"]),
];

fn fold(text: &str) -> String {
    text.to_lowercase()
        .replace('ä', "ae")
        .replace('ö', "oe")
        .replace('ü', "ue")
        .replace('ß', "ss")
        .replace(['é', 'è'], "e")
}

fn keyword_category(name: &str) -> Option<&'static str> {
    let folded = fold(name);
    let words: Vec<&str> = folded.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).collect();
    KEYWORDS.iter().find_map(|(key, list)| {
        words
            .iter()
            .any(|w| list.iter().any(|k| w == k || (k.len() >= 4 && w.starts_with(k))))
            .then_some(*key)
    })
}

pub fn recent_titles(conn: &Connection, kind: Option<&str>, limit: u32) -> AppResult<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT min(title) FROM transactions
         WHERE deleted = 0 AND trim(title) <> '' AND (?1 IS NULL OR kind = ?1)
         GROUP BY lower(trim(title))
         ORDER BY count(*) DESC, max(occurred_on) DESC
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![kind, limit.min(1000)], |r| r.get(0))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn suggest_category(conn: &Connection, name: &str) -> AppResult<Option<String>> {
    let name = name.trim();
    if name.is_empty() {
        return Ok(None);
    }
    if let Some(found) = learned_category(conn, name)? {
        return Ok(Some(found));
    }
    let Some(key) = keyword_category(name) else { return Ok(None) };
    Ok(conn
        .query_row("SELECT id FROM categories WHERE system_key = ?1 AND deleted = 0", [key], |r| r.get(0))
        .optional()?)
}

fn learned_category(conn: &Connection, name: &str) -> AppResult<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT t.category_id FROM transactions t
             LEFT JOIN counterparties c ON c.id = t.counterparty_id
             JOIN categories k ON k.id = t.category_id AND k.deleted = 0
             WHERE t.deleted = 0 AND (c.name = ?1 COLLATE NOCASE OR t.title = ?1 COLLATE NOCASE)
             GROUP BY t.category_id
             ORDER BY count(*) DESC, max(t.occurred_on) DESC
             LIMIT 1",
            [name],
            |r| r.get(0),
        )
        .optional()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    fn cash_account(db: &Db) -> String {
        accounts::list(&db.conn()).unwrap()[0].id.clone()
    }

    fn expense(account_id: &str, title: &str, cents: i64, date: &str) -> TransactionInput {
        TransactionInput {
            kind: "expense".into(),
            amount_minor: cents,
            currency: None,
            occurred_on: date.into(),
            occurred_time: None,
            account_id: account_id.into(),
            to_account_id: None,
            category_id: None,
            counterparty: Some("Kebab Haus".into()),
            title: title.into(),
            note: None,
            tags: vec![],
            debt_id: None,
            goal_id: None,
        }
    }

    #[test]
    fn create_assigns_ref_and_updates_balance() {
        let db = Db::open_in_memory().unwrap();
        let acc = cash_account(&db);
        let a = create(&db, expense(&acc, "Döner", 850, "2026-10-08")).unwrap();
        let b = create(&db, expense(&acc, "Cola", 250, "2026-10-08")).unwrap();
        assert_eq!(a.r#ref, "TX-2026-000001");
        assert_eq!(b.r#ref, "TX-2026-000002");
        assert_eq!(a.currency, "EUR");
        assert_eq!(accounts::get(&db.conn(), &acc).unwrap().balance_minor, -1100);
    }

    #[test]
    fn counterparty_is_reused_case_insensitively() {
        let db = Db::open_in_memory().unwrap();
        let acc = cash_account(&db);
        let a = create(&db, expense(&acc, "x", 100, "2026-01-01")).unwrap();
        let mut input = expense(&acc, "y", 100, "2026-01-02");
        input.counterparty = Some("kebab haus".into());
        let b = create(&db, input).unwrap();
        assert_eq!(a.counterparty_id, b.counterparty_id);
    }

    #[test]
    fn search_finds_by_title_counterparty_and_umlaut_free_spelling() {
        let db = Db::open_in_memory().unwrap();
        let acc = cash_account(&db);
        create(&db, expense(&acc, "Döner mit Soße", 850, "2026-10-08")).unwrap();
        create(&db, expense(&acc, "Bus ticket", 300, "2026-10-08")).unwrap();
        let find = |q: &str| {
            list(&db.conn(), &TransactionFilter { query: Some(q.into()), ..Default::default() })
                .unwrap()
                .len()
        };
        assert_eq!(find("Döner"), 1);
        assert_eq!(find("doner"), 1);
        assert_eq!(find("kebab"), 2);
        assert_eq!(find("bus tick"), 1);
        assert_eq!(find("\"-weird"), 0);
    }

    #[test]
    fn delete_hides_row_and_restores_balance() {
        let db = Db::open_in_memory().unwrap();
        let acc = cash_account(&db);
        let t = create(&db, expense(&acc, "x", 500, "2026-01-01")).unwrap();
        delete(&db, &t.id).unwrap();
        assert!(list(&db.conn(), &TransactionFilter::default()).unwrap().is_empty());
        assert_eq!(accounts::get(&db.conn(), &acc).unwrap().balance_minor, 0);
        assert!(matches!(delete(&db, &t.id), Err(AppError::NotFound(_))));
    }

    #[test]
    fn transfer_moves_money_between_accounts() {
        let db = Db::open_in_memory().unwrap();
        let cash = cash_account(&db);
        let bank = accounts::upsert(
            &db,
            accounts::AccountInput {
                id: None,
                name: "Giro".into(),
                kind: "checking".into(),
                currency: "eur".into(),
                opening_minor: 10_000,
                color: None,
                archived: false,
            },
        )
        .unwrap();
        let mut input = expense(&bank.id, "ATM", 2_000, "2026-03-01");
        input.kind = "transfer".into();
        input.to_account_id = Some(cash.clone());
        create(&db, input).unwrap();
        let conn = db.conn();
        assert_eq!(accounts::get(&conn, &bank.id).unwrap().balance_minor, 8_000);
        assert_eq!(accounts::get(&conn, &cash).unwrap().balance_minor, 2_000);
    }

    #[test]
    fn learns_category_from_history() {
        let db = Db::open_in_memory().unwrap();
        let acc = cash_account(&db);
        let cats = crate::domain::categories::list(&db.conn()).unwrap();
        let food = cats.iter().find(|c| c.system_key.as_deref() == Some("category.food")).unwrap().id.clone();
        let mut t = expense(&acc, "Mittag", 900, "2026-10-01");
        t.category_id = Some(food.clone());
        create(&db, t).unwrap();
        assert_eq!(suggest_category(&db.conn(), "kebab haus").unwrap(), Some(food));
        assert_eq!(suggest_category(&db.conn(), "Unbekannt").unwrap(), None);
    }

    #[test]
    fn anchored_balance_ignores_backfilled_entries() {
        let db = Db::open_in_memory().unwrap();
        let acc = cash_account(&db);
        let bal = |db: &Db, on: &str| accounts::get_as_of(&db.conn(), &acc, d(on)).unwrap().balance_minor;
        create(&db, expense(&acc, "Alt", 5_000, "2026-10-01")).unwrap();
        assert_eq!(bal(&db, "2026-10-10"), -5_000);

        accounts::set_balance(&db, &acc, 100_000, "2026-10-10").unwrap();
        assert_eq!(bal(&db, "2026-10-10"), 100_000, "today's balance is exactly what the user typed");
        std::thread::sleep(std::time::Duration::from_millis(5));

        create(&db, expense(&acc, "Nachgeholt", 3_000, "2026-10-05")).unwrap();
        assert_eq!(bal(&db, "2026-10-10"), 100_000, "catch-up entries before the anchor are history, not money leaving now");

        create(&db, expense(&acc, "Heute später", 2_000, "2026-10-10")).unwrap();
        create(&db, expense(&acc, "Morgen", 1_000, "2026-10-11")).unwrap();
        assert_eq!(bal(&db, "2026-10-10"), 98_000, "entries dated after today have not left the account yet");
        assert_eq!(bal(&db, "2026-10-11"), 97_000);

        accounts::set_balance(&db, &acc, 50_000, "2026-10-11").unwrap();
        assert_eq!(bal(&db, "2026-10-11"), 50_000, "correcting again resets the anchor");
    }

    #[test]
    fn correction_with_future_entry_keeps_typed_balance() {
        let db = Db::open_in_memory().unwrap();
        let acc = cash_account(&db);
        create(&db, expense(&acc, "Morgen geplant", 300, "2026-10-24")).unwrap();
        let a = accounts::set_balance(&db, &acc, 4_000, "2026-10-23").unwrap();
        assert_eq!(a.balance_minor, 4_000);
        assert_eq!(accounts::get_as_of(&db.conn(), &acc, d("2026-10-24")).unwrap().balance_minor, 3_700);
    }

    #[test]
    fn falls_back_to_keywords_without_history() {
        let db = Db::open_in_memory().unwrap();
        let cats = crate::domain::categories::list(&db.conn()).unwrap();
        let id = |key: &str| cats.iter().find(|c| c.system_key.as_deref() == Some(key)).unwrap().id.clone();
        let conn = db.conn();
        assert_eq!(suggest_category(&conn, "Döner").unwrap(), Some(id("category.food")));
        assert_eq!(suggest_category(&conn, "Doener").unwrap(), Some(id("category.food")));
        assert_eq!(suggest_category(&conn, "REWE Markt GmbH").unwrap(), Some(id("category.groceries")));
        assert_eq!(suggest_category(&conn, "Aral Tankstelle").unwrap(), Some(id("category.transport")));
        assert_eq!(suggest_category(&conn, "Netflix").unwrap(), Some(id("category.subscriptions")));
        assert_eq!(suggest_category(&conn, "Bargeld").unwrap(), None);
        assert_eq!(suggest_category(&conn, "Barbara").unwrap(), None);
    }

    #[test]
    fn filters_several_categories_and_sums_them_per_category() {
        let db = Db::open_in_memory().unwrap();
        let acc = cash_account(&db);
        let parent = crate::domain::categories::upsert(
            &db,
            crate::domain::categories::CategoryInput { id: None, parent_id: None, name: "Büro".into(), kind: "expense".into(), icon: None, color: None },
        )
        .unwrap()
        .id;
        let child = crate::domain::categories::upsert(
            &db,
            crate::domain::categories::CategoryInput { id: None, parent_id: Some(parent.clone()), name: "Tee".into(), kind: "expense".into(), icon: None, color: None },
        )
        .unwrap()
        .id;
        let other = crate::domain::categories::upsert(
            &db,
            crate::domain::categories::CategoryInput { id: None, parent_id: None, name: "Auto".into(), kind: "expense".into(), icon: None, color: None },
        )
        .unwrap()
        .id;
        let with = |title: &str, cents: i64, category: Option<&str>| {
            let mut t = expense(&acc, title, cents, "2026-10-08");
            t.category_id = category.map(str::to_owned);
            t
        };
        create(&db, with("Tee", 300, Some(&child))).unwrap();
        create(&db, with("Drucker", 900, Some(&parent))).unwrap();
        create(&db, with("Benzin", 5_000, Some(&other))).unwrap();
        create(&db, with("Unklar", 100, None)).unwrap();

        let titles = |ids: &[&str]| -> Vec<String> {
            let f = TransactionFilter { category_ids: Some(ids.iter().map(|s| (*s).to_owned()).collect()), ..Default::default() };
            let mut t: Vec<String> = list(&db.conn(), &f).unwrap().into_iter().map(|t| t.title).collect();
            t.sort();
            t
        };
        assert_eq!(titles(&[&parent]), ["Drucker", "Tee"], "a main category includes its subcategories");
        assert_eq!(titles(&[&child, &other]), ["Benzin", "Tee"]);
        assert_eq!(titles(&[""]), ["Unklar"], "an empty id selects entries without a category");
        assert_eq!(titles(&[]).len(), 4, "an empty selection filters nothing");

        let sums = category_totals(&db.conn(), &TransactionFilter::default()).unwrap();
        let of = |id: Option<&str>| sums.iter().find(|s| s.category_id.as_deref() == id).map(|s| (s.count, s.total_minor));
        assert_eq!(of(Some(&child)), Some((1, 300)));
        assert_eq!(of(Some(&parent)), Some((1, 900)), "own bookings only; the app adds subcategories itself");
        assert_eq!(of(None), Some((1, 100)));
        assert_eq!(sums[0].category_id.as_deref(), Some(other.as_str()), "largest first");
    }

    #[test]
    fn totals_cover_every_match_and_times_order_the_day() {
        let db = Db::open_in_memory().unwrap();
        let acc = cash_account(&db);
        let at = |title: &str, cents: i64, date: &str, time: Option<&str>| {
            let mut t = expense(&acc, title, cents, date);
            t.occurred_time = time.map(str::to_owned);
            t
        };
        create(&db, at("Frühstück", 500, "2026-10-08", Some("8:15"))).unwrap();
        create(&db, at("Abendessen", 300, "2026-10-08", Some("19.40"))).unwrap();
        let mut salary = at("Lohn", 10_000, "2026-10-08", None);
        salary.kind = "income".into();
        create(&db, salary).unwrap();
        create(&db, at("Gestern", 200, "2026-10-07", None)).unwrap();

        let titles: Vec<(String, Option<String>)> = list(&db.conn(), &TransactionFilter::default())
            .unwrap()
            .into_iter()
            .map(|t| (t.title, t.occurred_time))
            .collect();
        assert_eq!(
            titles,
            vec![
                ("Abendessen".into(), Some("19:40".into())),
                ("Frühstück".into(), Some("08:15".into())),
                ("Lohn".into(), None),
                ("Gestern".into(), None),
            ]
        );

        let today = d("2026-10-08");
        let t = totals(&db.conn(), &TransactionFilter { limit: Some(1), ..Default::default() }, today).unwrap();
        assert_eq!(t.count, 4);
        assert_eq!(
            t.currencies,
            vec![CurrencyTotal {
                currency: "EUR".into(),
                count: 4,
                income_minor: 10_000,
                expense_minor: 1_000,
                opening_minor: None,
                closing_minor: Some(9_000)
            }]
        );
        assert_eq!(t.days.len(), 2);
        assert_eq!((t.days[0].date.as_str(), t.days[0].income_minor, t.days[0].expense_minor), ("2026-10-08", 10_000, 800));

        let only_today = totals(&db.conn(), &TransactionFilter { from: Some("2026-10-08".into()), ..Default::default() }, today).unwrap();
        let c = &only_today.currencies[0];
        assert_eq!((c.opening_minor, c.income_minor - c.expense_minor, c.closing_minor), (Some(-200), 9_200, Some(9_000)));
        let food = totals(&db.conn(), &TransactionFilter { query: Some("Lohn".into()), ..Default::default() }, today).unwrap();
        assert_eq!(food.currencies[0].closing_minor, None, "balances only make sense without category, kind or search filters");

        accounts::set_balance(&db, &acc, 50_000, "2026-10-08").unwrap();
        let corrected = totals(&db.conn(), &TransactionFilter { from: Some("2026-10-08".into()), ..Default::default() }, today).unwrap();
        assert_eq!((corrected.currencies[0].opening_minor, corrected.currencies[0].closing_minor), (None, Some(50_000)));

        let only_yesterday = totals(&db.conn(), &TransactionFilter { from: Some("2026-10-07".into()), to: Some("2026-10-07".into()), ..Default::default() }, today).unwrap();
        assert_eq!(only_yesterday.currencies[0].expense_minor, 200);

        assert!(create(&db, at("x", 1, "2026-10-08", Some("25:99"))).is_err());
        assert_eq!(create(&db, at("x", 1, "2026-10-08", Some(" "))).unwrap().occurred_time, None);
    }

    #[test]
    fn recent_titles_put_the_most_used_first() {
        let db = Db::open_in_memory().unwrap();
        let acc = cash_account(&db);
        for (title, date) in [("Uber warehouse", "2026-10-01"), ("uber warehouse", "2026-10-02"), ("Uber school", "2026-10-03"), ("  ", "2026-10-03")] {
            create(&db, expense(&acc, title, 100, date)).unwrap();
        }
        let mut salary = expense(&acc, "Salary", 100, "2026-10-04");
        salary.kind = "income".into();
        create(&db, salary).unwrap();
        let conn = db.conn();
        assert_eq!(recent_titles(&conn, Some("expense"), 10).unwrap(), vec!["Uber warehouse", "Uber school"]);
        assert_eq!(recent_titles(&conn, None, 10).unwrap().len(), 3);
        assert_eq!(recent_titles(&conn, Some("expense"), 1).unwrap().len(), 1);
    }

    #[test]
    fn rejects_invalid_input() {
        let db = Db::open_in_memory().unwrap();
        let acc = cash_account(&db);
        assert!(create(&db, expense(&acc, "x", 0, "2026-01-01")).is_err());
        assert!(create(&db, expense(&acc, "x", 1, "2026-13-01")).is_err());
        assert!(create(&db, expense("nope", "x", 1, "2026-01-01")).is_err());
        let mut t = expense(&acc, "x", 1, "2026-01-01");
        t.kind = "transfer".into();
        assert!(create(&db, t).is_err());
    }
}
