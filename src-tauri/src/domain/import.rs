use std::collections::{HashMap, HashSet};

use chrono::{Datelike, NaiveDate};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use super::export::minor_digits;
use super::transactions::{self, SystemLinks, TransactionInput};
use super::{accounts, categories};
use crate::db::{new_id, now_rfc3339, Db};
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportOptions {
    pub default_account_id: Option<String>,
    #[serde(default)]
    pub auto_category: bool,
    #[serde(default)]
    pub skip_duplicates: bool,
    #[serde(default)]
    pub keep_balances: bool,
    #[serde(default)]
    pub labels: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RowError {
    pub line: usize,
    pub code: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewRow {
    pub line: usize,
    pub date: String,
    pub kind: String,
    pub amount_minor: i64,
    pub currency: String,
    pub account: String,
    pub category: String,
    pub title: String,
    pub duplicate: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub columns: Vec<String>,
    pub total_rows: usize,
    pub valid_rows: usize,
    pub duplicates: usize,
    pub errors: Vec<RowError>,
    pub new_accounts: Vec<String>,
    pub new_categories: Vec<String>,
    pub income_minor: i64,
    pub expense_minor: i64,
    pub first_date: Option<String>,
    pub last_date: Option<String>,
    pub rows: Vec<PreviewRow>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub imported: usize,
    pub skipped: usize,
    pub new_accounts: usize,
    pub new_categories: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum Col {
    Date,
    Time,
    Kind,
    Amount,
    Currency,
    Account,
    ToAccount,
    Category,
    Counterparty,
    Title,
    Note,
    Tags,
    Reference,
}

const ALIASES: &[(Col, &[&str])] = &[
    (Col::Date, &["date", "datum", "buchungstag", "buchungsdatum", "fecha", "data", "tarih", "bookingdate", "transactiondate", "datadioperazione", "dataoperacji", "dateoperation"]),
    (Col::Time, &["time", "uhrzeit", "zeit", "buchungszeit", "hora", "heure", "ora", "godzina", "saat", "zaman"]),
    (Col::Kind, &["type", "typ", "art", "kind", "tipo", "rodzaj", "tur", "tuer", "turu"]),
    (Col::Amount, &["amount", "betrag", "umsatz", "betrageur", "importe", "montant", "importo", "kwota", "tutar", "summe", "wert"]),
    (Col::Currency, &["currency", "waehrung", "wahrung", "moneda", "devise", "divisa", "waluta", "parabirimi"]),
    (Col::Account, &["account", "konto", "cuenta", "compte", "conto", "rachunek", "hesap"]),
    (Col::ToAccount, &["toaccount", "zielkonto", "cuentadestino", "comptedestination", "contodestinazione", "rachunekdocelowy", "hedefhesap"]),
    (Col::Category, &["category", "kategorie", "categoria", "categorie", "kategoria", "kategori"]),
    (
        Col::Counterparty,
        &[
            "counterparty", "empfaenger", "empfanger", "auftraggeber", "zahlungsempfaenger", "zahlungsempfanger", "auftraggeberempfaenger",
            "beguenstigterzahlungspflichtiger", "begunstigterzahlungspflichtiger", "nameauftraggeberbeguenstigter", "payee", "name",
            "gegenueber", "haendler", "merchant", "beneficiario", "beneficiaire", "kontrahent", "alici",
        ],
    ),
    (
        Col::Title,
        &["title", "titel", "verwendungszweck", "beschreibung", "description", "buchungstext", "text", "purpose", "bezeichnung", "concepto", "libelle", "descrizione", "opis", "aciklama"],
    ),
    (Col::Note, &["note", "notiz", "bemerkung", "notes", "nota", "remarque", "uwagi", "not"]),
    (Col::Tags, &["tags", "schlagwoerter", "etiquetas", "etichette", "etykiety", "etiketler"]),
    (Col::Reference, &["reference", "referenz", "ref", "referencia", "riferimento", "referans"]),
];

fn fold(s: &str) -> String {
    s.to_lowercase()
        .replace('ä', "ae")
        .replace('ö', "oe")
        .replace('ü', "ue")
        .replace('ß', "ss")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect()
}

fn column_for(header: &str) -> Option<Col> {
    let key = fold(header);
    ALIASES.iter().find(|(_, names)| names.contains(&key.as_str())).map(|(c, _)| *c)
}

fn detect_delimiter(text: &str) -> char {
    let first = text.lines().find(|l| !l.trim().is_empty()).unwrap_or("");
    let mut best = (',', 0);
    for d in [';', ',', '\t', '|'] {
        let mut quoted = false;
        let n = first
            .chars()
            .filter(|c| {
                if *c == '"' {
                    quoted = !quoted;
                }
                !quoted && *c == d
            })
            .count();
        if n > best.1 {
            best = (d, n);
        }
    }
    best.0
}

pub fn parse_csv(text: &str) -> Vec<(usize, Vec<String>)> {
    let text = text.trim_start_matches('\u{feff}');
    let delim = detect_delimiter(text);
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut line = 1;
    let mut row_line = 1;
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if quoted {
            match c {
                '"' if chars.peek() == Some(&'"') => {
                    field.push('"');
                    chars.next();
                }
                '"' => quoted = false,
                '\n' => {
                    line += 1;
                    field.push('\n');
                }
                _ => field.push(c),
            }
            continue;
        }
        match c {
            '"' if field.trim().is_empty() => {
                field.clear();
                quoted = true;
            }
            c if c == delim => row.push(std::mem::take(&mut field)),
            '\r' => {}
            '\n' => {
                row.push(std::mem::take(&mut field));
                if row.iter().any(|f| !f.trim().is_empty()) {
                    rows.push((row_line, std::mem::take(&mut row)));
                }
                row.clear();
                line += 1;
                row_line = line;
            }
            _ => field.push(c),
        }
    }
    row.push(field);
    if row.iter().any(|f| !f.trim().is_empty()) {
        rows.push((row_line, row));
    }
    rows
}

pub fn parse_date(s: &str) -> Option<NaiveDate> {
    let s = s.trim();
    let s = s.split(['T', ' ']).next().unwrap_or(s);
    for fmt in ["%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y", "%Y/%m/%d", "%d-%m-%Y", "%Y.%m.%d"] {
        if let Ok(d) = NaiveDate::parse_from_str(s, fmt) {
            if d.year() >= 1000 {
                return Some(d);
            }
        }
    }
    for fmt in ["%d.%m.%y", "%d/%m/%y"] {
        if let Ok(d) = NaiveDate::parse_from_str(s, fmt) {
            return Some(d);
        }
    }
    None
}

pub fn parse_time_of(date_cell: &str, time_cell: &str) -> Option<String> {
    let rest = date_cell.trim().split_once(['T', ' ']).map(|(_, t)| t).unwrap_or("");
    [time_cell, rest]
        .into_iter()
        .map(|s| {
            let s = s.trim().trim_end_matches('Z');
            let s = s.split(['+', '-']).next().unwrap_or("");
            if s.contains(':') { s.split('.').next().unwrap_or("") } else { s }.trim()
        })
        .filter(|s| !s.is_empty())
        .find_map(transactions::parse_time)
        .map(|t| t.format("%H:%M").to_string())
}

pub fn parse_amount(s: &str, currency: &str) -> Option<i64> {
    let raw: String = s.chars().filter(|c| !c.is_whitespace() && *c != '\u{a0}' && *c != '\'').collect();
    let negative = raw.starts_with('-') || raw.ends_with('-') || (raw.starts_with('(') && raw.ends_with(')'));
    let body: String = raw.chars().filter(|c| c.is_ascii_digit() || *c == '.' || *c == ',').collect();
    if body.is_empty() || !body.chars().any(|c| c.is_ascii_digit()) {
        return None;
    }
    let last_dot = body.rfind('.');
    let last_comma = body.rfind(',');
    let decimal = match (last_dot, last_comma) {
        (Some(d), Some(c)) => Some(d.max(c)),
        (Some(p), None) | (None, Some(p)) => {
            let sep = body.as_bytes()[p] as char;
            let count = body.matches(sep).count();
            let after = body.len() - p - 1;
            (count == 1 && after != 3).then_some(p)
        }
        (None, None) => None,
    };
    let (int_part, frac_part) = match decimal {
        Some(p) => (&body[..p], &body[p + 1..]),
        None => (body.as_str(), ""),
    };
    let int_digits: String = int_part.chars().filter(char::is_ascii_digit).collect();
    let digits = minor_digits(currency) as usize;
    let mut frac: String = frac_part.chars().filter(char::is_ascii_digit).take(digits).collect();
    while frac.len() < digits {
        frac.push('0');
    }
    let int: i64 = if int_digits.is_empty() { 0 } else { int_digits.parse().ok()? };
    let frac: i64 = if frac.is_empty() { 0 } else { frac.parse().ok()? };
    let minor = int.checked_mul(10i64.pow(digits as u32))?.checked_add(frac)?;
    Some(if negative { -minor } else { minor })
}

fn parse_kind(s: &str) -> Option<&'static str> {
    match fold(s).as_str() {
        "income" | "einnahme" | "einnahmen" | "eingang" | "gutschrift" | "ingreso" | "revenu" | "entree" | "entrata" | "przychod" | "gelir" | "haben" => Some("income"),
        "expense" | "ausgabe" | "ausgaben" | "ausgang" | "lastschrift" | "gasto" | "depense" | "uscita" | "spesa" | "wydatek" | "gider" | "soll" => {
            Some("expense")
        }
        "transfer" | "umbuchung" | "uebertrag" | "transferencia" | "virement" | "trasferimento" | "przelew" | "przeniesienie" => Some("transfer"),
        _ => None,
    }
}

struct AccountRef {
    id: Option<String>,
    name: String,
    currency: String,
}

struct Lookup {
    accounts: Vec<(String, String, String)>,
    categories: Vec<categories::Category>,
    labels: HashMap<String, String>,
    default_currency: String,
}

impl Lookup {
    fn load(conn: &Connection, labels: HashMap<String, String>) -> AppResult<Self> {
        let accounts = accounts::list(conn)?
            .into_iter()
            .filter(|a| !a.archived)
            .map(|a| {
                let shown = a.system_key.as_ref().and_then(|k| labels.get(k).cloned()).unwrap_or(a.name.clone());
                (a.id, shown, a.currency)
            })
            .collect();
        Ok(Self {
            accounts,
            categories: categories::list(conn)?,
            labels,
            default_currency: super::currency::main_currency(conn)?,
        })
    }

    fn account(&self, name: &str) -> AccountRef {
        let key = name.trim().to_lowercase();
        match self.accounts.iter().find(|(_, n, _)| n.to_lowercase() == key) {
            Some((id, n, c)) => AccountRef { id: Some(id.clone()), name: n.clone(), currency: c.clone() },
            None => AccountRef { id: None, name: name.trim().to_owned(), currency: self.default_currency.clone() },
        }
    }

    fn account_by_id(&self, id: &str) -> Option<AccountRef> {
        self.accounts
            .iter()
            .find(|(i, _, _)| i == id)
            .map(|(i, n, c)| AccountRef { id: Some(i.clone()), name: n.clone(), currency: c.clone() })
    }

    fn category_name(&self, c: &categories::Category) -> String {
        c.system_key.as_ref().and_then(|k| self.labels.get(k).cloned()).unwrap_or_else(|| c.name.clone())
    }

    fn matches(&self, c: &categories::Category, name: &str) -> bool {
        let wanted = name.trim().to_lowercase();
        self.category_name(c).to_lowercase() == wanted || c.name.to_lowercase() == wanted
    }

    fn fits(c: &categories::Category, kind: &str) -> bool {
        c.kind == "both" || c.kind == kind
    }

    fn category(&self, path: &str, kind: &str) -> Result<String, Vec<String>> {
        let parts: Vec<&str> = path.split('>').map(str::trim).filter(|p| !p.is_empty()).collect();
        if parts.len() == 1 {
            let candidates: Vec<&categories::Category> = self.categories.iter().filter(|c| self.matches(c, parts[0])).collect();
            if let Some(c) = candidates.iter().find(|c| Self::fits(c, kind)).or(candidates.first()) {
                return Ok(c.id.clone());
            }
            return Err(vec![parts[0].to_owned()]);
        }
        let mut parent: Option<String> = None;
        for part in &parts {
            match self.categories.iter().find(|c| c.parent_id == parent && self.matches(c, part)) {
                Some(c) => parent = Some(c.id.clone()),
                None => return Err(parts.iter().map(|p| (*p).to_owned()).collect()),
            }
        }
        parent.ok_or_else(|| parts.iter().map(|p| (*p).to_owned()).collect())
    }
}

struct Planned {
    line: usize,
    input: TransactionInput,
    account: AccountRef,
    to_account: Option<AccountRef>,
    category: Option<Result<String, Vec<String>>>,
    category_label: String,
    duplicate: bool,
}

fn cell(row: &[String], map: &HashMap<Col, usize>, col: Col) -> String {
    map.get(&col).and_then(|&i| row.get(i)).map(|s| s.trim().to_owned()).unwrap_or_default()
}

fn dup_key(date: &str, kind: &str, amount: i64, account: &str, title: &str) -> String {
    format!("{date}|{kind}|{amount}|{account}|{}", fold(title))
}

fn existing_keys(conn: &Connection) -> AppResult<(HashMap<String, usize>, HashSet<String>)> {
    let mut stmt = conn.prepare("SELECT occurred_on, kind, amount_minor, account_id, title, ref FROM transactions WHERE deleted = 0")?;
    let mut keys = HashMap::new();
    let mut refs = HashSet::new();
    let rows = stmt.query_map([], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?, r.get::<_, String>(3)?, r.get::<_, String>(4)?, r.get::<_, String>(5)?))
    })?;
    for row in rows {
        let (d, k, a, acc, title, r) = row?;
        *keys.entry(dup_key(&d, &k, a, &acc, &title)).or_insert(0) += 1;
        refs.insert(r);
    }
    Ok((keys, refs))
}

struct Parsed {
    columns: Vec<String>,
    total: usize,
    rows: Vec<Planned>,
    errors: Vec<RowError>,
}

fn plan(conn: &Connection, text: &str, opts: &ImportOptions) -> AppResult<Parsed> {
    let rows = parse_csv(text);
    let Some(((_, header), body)) = rows.split_first() else {
        return Err(AppError::Unsupported("empty_file".into()));
    };
    let mut map = HashMap::new();
    for (i, h) in header.iter().enumerate() {
        if let Some(col) = column_for(h) {
            map.entry(col).or_insert(i);
        }
    }
    if !map.contains_key(&Col::Date) || !map.contains_key(&Col::Amount) {
        return Err(AppError::Unsupported("missing_columns".into()));
    }
    let look = Lookup::load(conn, opts.labels.clone())?;
    let default_account = match opts.default_account_id.as_deref().filter(|s| !s.is_empty()) {
        Some(id) => look.account_by_id(id),
        None => look.accounts.first().and_then(|(id, _, _)| look.account_by_id(id)),
    };
    let (mut existing, refs) = existing_keys(conn)?;
    let mut planned = Vec::new();
    let mut errors = Vec::new();

    for (line, row) in body {
        let line = *line;
        let fail = |errors: &mut Vec<RowError>, code: &str, value: &str| {
            errors.push(RowError { line, code: code.to_owned(), value: value.chars().take(60).collect() })
        };
        let date_s = cell(row, &map, Col::Date);
        let Some(date) = parse_date(&date_s) else {
            fail(&mut errors, "invalid_date", &date_s);
            continue;
        };
        let time = parse_time_of(&date_s, &cell(row, &map, Col::Time));
        let account_name = cell(row, &map, Col::Account);
        let account = if account_name.is_empty() {
            match &default_account {
                Some(a) => AccountRef { id: a.id.clone(), name: a.name.clone(), currency: a.currency.clone() },
                None => {
                    fail(&mut errors, "no_account", "");
                    continue;
                }
            }
        } else {
            look.account(&account_name)
        };
        let currency = Some(cell(row, &map, Col::Currency).to_uppercase()).filter(|c| c.len() == 3).unwrap_or(account.currency.clone());
        let amount_s = cell(row, &map, Col::Amount);
        let Some(amount) = parse_amount(&amount_s, &currency) else {
            fail(&mut errors, "invalid_amount", &amount_s);
            continue;
        };
        if amount == 0 {
            fail(&mut errors, "zero_amount", &amount_s);
            continue;
        }
        let kind_s = cell(row, &map, Col::Kind);
        let kind = if kind_s.is_empty() {
            if amount < 0 { "expense" } else { "income" }
        } else {
            match parse_kind(&kind_s) {
                Some(k) => k,
                None => {
                    fail(&mut errors, "unknown_type", &kind_s);
                    continue;
                }
            }
        };
        let to_name = cell(row, &map, Col::ToAccount);
        let to_account = if kind == "transfer" {
            if to_name.is_empty() {
                fail(&mut errors, "missing_target", "");
                continue;
            }
            let to = look.account(&to_name);
            if to.name.to_lowercase() == account.name.to_lowercase() {
                fail(&mut errors, "same_target", &to_name);
                continue;
            }
            Some(to)
        } else {
            None
        };
        let counterparty = cell(row, &map, Col::Counterparty);
        let mut title = cell(row, &map, Col::Title);
        if title.is_empty() {
            title = counterparty.clone();
        }
        let category_s = cell(row, &map, Col::Category);
        let (category, category_label) = if kind == "transfer" {
            (None, String::new())
        } else if !category_s.is_empty() {
            (Some(look.category(&category_s, kind)), category_s.clone())
        } else if opts.auto_category {
            let candidates: Vec<&str> = [title.as_str(), counterparty.as_str()].into_iter().filter(|s| !s.is_empty()).collect();
            let by_name = candidates
                .iter()
                .find_map(|s| look.categories.iter().find(|c| Lookup::fits(c, kind) && look.matches(c, s)).map(|c| c.id.clone()));
            let guess = by_name.or_else(|| candidates.iter().find_map(|s| transactions::suggest_category(conn, s).ok().flatten()));
            let label = guess
                .as_ref()
                .and_then(|id| look.categories.iter().find(|c| &c.id == id))
                .map(|c| look.category_name(c))
                .unwrap_or_default();
            (guess.map(Ok), label)
        } else {
            (None, String::new())
        };
        let reference = Some(cell(row, &map, Col::Reference)).filter(|r| !r.is_empty());
        let tags: Vec<String> = cell(row, &map, Col::Tags).split([' ', ',']).filter(|t| !t.is_empty()).map(str::to_owned).collect();
        let note = Some(cell(row, &map, Col::Note)).filter(|n| !n.is_empty());
        let abs = amount.abs();
        let duplicate = reference.as_ref().is_some_and(|r| refs.contains(r))
            || account.id.as_ref().is_some_and(|acc| {
                let key = dup_key(&date.to_string(), kind, abs, acc, &title);
                match existing.get_mut(&key) {
                    Some(n) if *n > 0 => {
                        *n -= 1;
                        true
                    }
                    _ => false,
                }
            });
        planned.push(Planned {
            line,
            input: TransactionInput {
                kind: kind.into(),
                amount_minor: abs,
                currency: Some(currency),
                occurred_on: date.to_string(),
                occurred_time: time,
                account_id: account.id.clone().unwrap_or_default(),
                to_account_id: None,
                category_id: None,
                counterparty: Some(counterparty).filter(|c| !c.is_empty()),
                title,
                note,
                tags,
                debt_id: None,
                goal_id: None,
            },
            account,
            to_account,
            category,
            category_label,
            duplicate,
        });
    }
    Ok(Parsed { columns: header.clone(), total: body.len(), rows: planned, errors })
}

fn unique(items: impl Iterator<Item = String>) -> Vec<String> {
    let mut seen = HashSet::new();
    items.filter(|s| seen.insert(s.to_lowercase())).collect()
}

pub fn preview(conn: &Connection, text: &str, opts: &ImportOptions) -> AppResult<ImportPreview> {
    let Parsed { columns, total, rows: planned, errors } = plan(conn, text, opts)?;
    let counted: Vec<&Planned> = planned.iter().filter(|p| !(opts.skip_duplicates && p.duplicate)).collect();
    let new_accounts = unique(
        planned
            .iter()
            .flat_map(|p| [Some(&p.account), p.to_account.as_ref()])
            .flatten()
            .filter(|a| a.id.is_none())
            .map(|a| a.name.clone()),
    );
    let new_categories = unique(planned.iter().filter_map(|p| match &p.category {
        Some(Err(missing)) if !missing.is_empty() => Some(missing.join(" > ")),
        _ => None,
    }));
    let sum = |kind: &str| counted.iter().filter(|p| p.input.kind == kind).map(|p| p.input.amount_minor).sum();
    Ok(ImportPreview {
        columns,
        total_rows: total,
        valid_rows: planned.len(),
        duplicates: planned.iter().filter(|p| p.duplicate).count(),
        errors: errors.into_iter().take(100).collect(),
        new_accounts,
        new_categories,
        income_minor: sum("income"),
        expense_minor: sum("expense"),
        first_date: planned.iter().map(|p| p.input.occurred_on.clone()).min(),
        last_date: planned.iter().map(|p| p.input.occurred_on.clone()).max(),
        rows: planned
            .iter()
            .take(200)
            .map(|p| PreviewRow {
                line: p.line,
                date: p.input.occurred_on.clone(),
                kind: p.input.kind.clone(),
                amount_minor: p.input.amount_minor,
                currency: p.input.currency.clone().unwrap_or_default(),
                account: p.account.name.clone(),
                category: p.category_label.clone(),
                title: p.input.title.clone(),
                duplicate: p.duplicate,
            })
            .collect(),
    })
}

fn create_account(db: &Db, conn: &Connection, name: &str, currency: &str) -> AppResult<String> {
    let id = new_id();
    conn.execute(
        "INSERT INTO accounts (id, name, kind, currency, opening_minor, created_at, device_id, updated_hlc)
         VALUES (?1, ?2, 'checking', ?3, 0, ?4, ?5, ?6)",
        params![id, name, currency, now_rfc3339(), db.device_id(), db.hlc.tick()],
    )?;
    Ok(id)
}

fn create_category(db: &Db, conn: &Connection, name: &str, parent: Option<&str>, kind: &str) -> AppResult<String> {
    let id = new_id();
    conn.execute(
        "INSERT INTO categories (id, parent_id, name, kind, icon, color, created_at, device_id, updated_hlc)
         VALUES (?1, ?2, ?3, ?4, 'circle-dashed', '#64748b', ?5, ?6, ?7)",
        params![id, parent, name, kind, now_rfc3339(), db.device_id(), db.hlc.tick()],
    )?;
    Ok(id)
}

pub fn commit(db: &Db, text: &str, opts: &ImportOptions, today: NaiveDate) -> AppResult<ImportResult> {
    let mut conn = db.conn();
    let planned = plan(&conn, text, opts)?.rows;
    let tx = conn.transaction()?;
    let mut account_ids: HashMap<String, String> = HashMap::new();
    let mut category_ids: HashMap<String, String> = HashMap::new();
    let mut touched: HashSet<String> = HashSet::new();
    let mut result = ImportResult { imported: 0, skipped: 0, new_accounts: 0, new_categories: 0 };

    let mut resolve_account = |a: &AccountRef, result: &mut ImportResult, tx: &Connection| -> AppResult<(String, bool)> {
        if let Some(id) = &a.id {
            return Ok((id.clone(), true));
        }
        let key = a.name.to_lowercase();
        if let Some(id) = account_ids.get(&key) {
            return Ok((id.clone(), false));
        }
        let id = create_account(db, tx, &a.name, &a.currency)?;
        result.new_accounts += 1;
        account_ids.insert(key, id.clone());
        Ok((id, false))
    };

    let mut before: HashMap<String, i64> = HashMap::new();
    for p in &planned {
        for a in [Some(&p.account), p.to_account.as_ref()].into_iter().flatten() {
            if let Some(id) = &a.id {
                if !before.contains_key(id) {
                    before.insert(id.clone(), accounts::get_as_of(&tx, id, today)?.balance_minor);
                }
            }
        }
    }

    for p in planned {
        if opts.skip_duplicates && p.duplicate {
            result.skipped += 1;
            continue;
        }
        let mut input = p.input.clone();
        let (from_id, existed) = resolve_account(&p.account, &mut result, &tx)?;
        input.account_id = from_id.clone();
        if existed {
            touched.insert(from_id);
        }
        if let Some(to) = &p.to_account {
            let (to_id, existed) = resolve_account(to, &mut result, &tx)?;
            input.to_account_id = Some(to_id.clone());
            if existed {
                touched.insert(to_id);
            }
        }
        input.category_id = match p.category {
            Some(Ok(id)) => Some(id),
            Some(Err(missing)) => {
                let full = missing.join(" > ");
                let cache_key = format!("{}|{}", input.kind, full.to_lowercase());
                if let Some(id) = category_ids.get(&cache_key) {
                    Some(id.clone())
                } else {
                    let look = Lookup::load(&tx, opts.labels.clone())?;
                    let mut parent: Option<String> = None;
                    let mut created = None;
                    for part in &missing {
                        let existing = look.categories.iter().find(|c| c.parent_id == parent && look.matches(c, part)).map(|c| c.id.clone());
                        let id = match existing {
                            Some(id) => id,
                            None => {
                                result.new_categories += 1;
                                create_category(db, &tx, part, parent.as_deref(), &input.kind)?
                            }
                        };
                        parent = Some(id.clone());
                        created = Some(id);
                    }
                    if let Some(id) = &created {
                        category_ids.insert(cache_key, id.clone());
                    }
                    created
                }
            }
            None => None,
        };
        transactions::insert(db, &tx, &input, SystemLinks::default())?;
        result.imported += 1;
    }

    if opts.keep_balances {
        for id in touched {
            if let Some(balance) = before.get(&id) {
                tx.execute(
                    "INSERT INTO account_balance_anchors (account_id, anchor_minor, anchor_on, anchor_at, device_id, updated_hlc)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                     ON CONFLICT(account_id) DO UPDATE SET anchor_minor = excluded.anchor_minor,
                         anchor_on = excluded.anchor_on, anchor_at = excluded.anchor_at,
                         device_id = excluded.device_id, updated_hlc = excluded.updated_hlc",
                    params![id, balance, today.to_string(), now_rfc3339(), db.device_id(), db.hlc.tick()],
                )?;
            }
        }
    }
    tx.commit()?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn reads_amounts_the_way_banks_write_them() {
        assert_eq!(parse_amount("-1.234,56", "EUR"), Some(-123_456));
        assert_eq!(parse_amount("1,234.56", "EUR"), Some(123_456));
        assert_eq!(parse_amount("12,5", "EUR"), Some(1_250));
        assert_eq!(parse_amount("12.50 €", "EUR"), Some(1_250));
        assert_eq!(parse_amount("1.234", "EUR"), Some(123_400));
        assert_eq!(parse_amount("8,99-", "EUR"), Some(-899));
        assert_eq!(parse_amount("(5.00)", "EUR"), Some(-500));
        assert_eq!(parse_amount("1 000,00", "EUR"), Some(100_000));
        assert_eq!(parse_amount("500", "JPY"), Some(500));
        assert_eq!(parse_amount("abc", "EUR"), None);
    }

    #[test]
    fn reads_dates_and_quoted_fields() {
        assert_eq!(parse_date("06.10.2026"), Some(d("2026-10-06")));
        assert_eq!(parse_date("6.10.26"), Some(d("2026-10-06")));
        assert_eq!(parse_date("2026-10-06T10:00:00"), Some(d("2026-10-06")));
        assert_eq!(parse_date("06/10/2026"), Some(d("2026-10-06")));
        assert_eq!(parse_date("31.02.2026"), None);
        assert_eq!(parse_time_of("2026-10-06T10:05:00+02:00", "").as_deref(), Some("10:05"));
        assert_eq!(parse_time_of("06.10.2026 18:30", "").as_deref(), Some("18:30"));
        assert_eq!(parse_time_of("06.10.2026", "7:45").as_deref(), Some("07:45"));
        assert_eq!(parse_time_of("06.10.2026", "14:30:12.250").as_deref(), Some("14:30"));
        assert_eq!(parse_time_of("06.10.2026", ""), None);
        assert_eq!(parse_time_of("06.10.2026", "25:00"), None);
        let rows = parse_csv("\u{feff}a;b;c\r\n1;\"x;\"\"y\"\"\";3\n\n4;\"multi\nline\";6");
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[1].1, vec!["1", "x;\"y\"", "3"]);
        assert_eq!(rows[2].0, 4);
        assert_eq!(rows[2].1[1], "multi\nline");
    }

    #[test]
    fn imports_a_bank_export_and_keeps_todays_balance() {
        let db = Db::open_in_memory().unwrap();
        let today = d("2026-10-26");
        let cash = accounts::list(&db.conn()).unwrap()[0].id.clone();
        crate::domain::accounts::set_balance(&db, &cash, 50_000, "2026-10-26").unwrap();
        let csv = "Buchungstag;Empfänger;Verwendungszweck;Betrag;Kategorie\n\
                   01.03.2026;REWE Markt;Einkauf;-45,20;\n\
                   02.03.2026;Arbeitgeber GmbH;Gehalt März;2.500,00;Einkommen > Lohn\n\
                   02.03.2026;Netflix;Abo;-13,99;Lebensmittel\n\
                   kaputt;x;y;1;\n";
        let mut labels = HashMap::new();
        labels.insert("category.groceries".to_owned(), "Lebensmittel".to_owned());
        let opts = ImportOptions { default_account_id: Some(cash.clone()), auto_category: true, skip_duplicates: true, keep_balances: true, labels };
        let p = preview(&db.conn(), csv, &opts).unwrap();
        assert_eq!(p.total_rows, 4);
        assert_eq!(p.valid_rows, 3);
        assert_eq!(p.errors.len(), 1);
        assert_eq!(p.errors[0].line, 5);
        assert_eq!((p.errors[0].code.as_str(), p.errors[0].value.as_str()), ("invalid_date", "kaputt"));
        assert_eq!(p.expense_minor, 4_520 + 1_399);
        assert_eq!(p.income_minor, 250_000);
        assert_eq!(p.new_categories, vec!["Einkommen > Lohn".to_owned()]);
        assert_eq!(p.rows[0].category, "Lebensmittel", "suggested from the merchant");

        let r = commit(&db, csv, &opts, today).unwrap();
        assert_eq!(r.imported, 3);
        assert_eq!(r.new_categories, 2);
        assert_eq!(accounts::get_as_of(&db.conn(), &cash, today).unwrap().balance_minor, 50_000);
        let cats = categories::list(&db.conn()).unwrap();
        let lohn = cats.iter().find(|c| c.name == "Lohn").unwrap();
        let parent = cats.iter().find(|c| Some(&c.id) == lohn.parent_id.as_ref()).unwrap();
        assert_eq!(parent.name, "Einkommen");
        assert_eq!(lohn.kind, "income");

        let again = preview(&db.conn(), csv, &opts).unwrap();
        assert_eq!(again.duplicates, 3, "importing the same file twice is detected");
        let r = commit(&db, csv, &opts, today).unwrap();
        assert_eq!((r.imported, r.skipped), (0, 3));
    }

    #[test]
    fn round_trips_its_own_export() {
        let db = Db::open_in_memory().unwrap();
        let today = d("2026-10-08");
        crate::domain::demo::load(&db, today).unwrap();
        let opts = crate::domain::export::ExportOptions {
            datasets: vec!["transactions".into()],
            delimiter: ";".into(),
            decimal_comma: true,
            labels: HashMap::new(),
            filter: None,
            expense_minus: false,
            split_categories: true,
        };
        let bytes = crate::domain::export::export(&db.conn(), &opts, today).unwrap().bytes;
        let text = String::from_utf8(bytes).unwrap();
        let fresh = Db::open_in_memory().unwrap();
        let p = preview(&fresh.conn(), &text, &ImportOptions { skip_duplicates: true, ..Default::default() }).unwrap();
        assert!(p.errors.is_empty(), "{:?}", p.errors);
        let same = preview(&db.conn(), &text, &ImportOptions { skip_duplicates: true, ..Default::default() }).unwrap();
        assert_eq!(same.duplicates, same.valid_rows, "every exported row is recognised by its reference");
    }

    #[test]
    fn rejects_files_without_date_or_amount() {
        let db = Db::open_in_memory().unwrap();
        let err = preview(&db.conn(), "foo;bar\n1;2", &ImportOptions::default()).unwrap_err();
        assert!(err.to_string().contains("missing_columns"));
    }
}
