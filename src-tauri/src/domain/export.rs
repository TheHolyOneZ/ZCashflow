use std::collections::HashMap;
use std::io::Write;
use std::path::Path;

use chrono::{Datelike, NaiveDate, Timelike};
use rusqlite::Connection;
use serde::Deserialize;

use super::transactions::{self, TransactionFilter};
use super::{accounts, budgets, categories, debts, goals, recurring};
use crate::error::{AppError, AppResult};

pub const DATASETS: &[&str] = &["transactions", "accounts", "categories", "recurring", "budgets", "goals", "debts"];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportOptions {
    pub datasets: Vec<String>,
    #[serde(default = "default_delimiter")]
    pub delimiter: String,
    #[serde(default)]
    pub decimal_comma: bool,
    #[serde(default)]
    pub labels: HashMap<String, String>,
    pub filter: Option<TransactionFilter>,
}

fn default_delimiter() -> String {
    ",".into()
}

pub struct Format {
    delimiter: char,
    decimal_comma: bool,
}

impl Format {
    pub fn new(delimiter: &str, decimal_comma: bool) -> Self {
        let delimiter = match delimiter {
            ";" => ';',
            "\t" | "tab" => '\t',
            _ => ',',
        };
        Self { delimiter, decimal_comma: decimal_comma && delimiter != ',' }
    }

    fn field(&self, s: &str) -> String {
        if s.contains([self.delimiter, '"', '\n', '\r']) || s.starts_with([' ', '=']) {
            format!("\"{}\"", s.replace('"', "\"\""))
        } else {
            s.to_owned()
        }
    }

    pub fn money(&self, minor: i64, currency: &str) -> String {
        let digits = minor_digits(currency);
        let sign = if minor < 0 { "-" } else { "" };
        let abs = minor.unsigned_abs();
        if digits == 0 {
            return format!("{sign}{abs}");
        }
        let scale = 10u64.pow(digits);
        let sep = if self.decimal_comma { ',' } else { '.' };
        format!("{sign}{}{sep}{:0width$}", abs / scale, abs % scale, width = digits as usize)
    }

    fn line(&self, out: &mut Vec<u8>, fields: &[String]) {
        let joined: Vec<String> = fields.iter().map(|f| self.field(f)).collect();
        out.extend_from_slice(joined.join(&self.delimiter.to_string()).as_bytes());
        out.extend_from_slice(b"\r\n");
    }

    fn table(&self, header: &[&str], rows: Vec<Vec<String>>) -> Vec<u8> {
        let mut out = b"\xEF\xBB\xBF".to_vec();
        self.line(&mut out, &header.iter().map(|h| (*h).to_owned()).collect::<Vec<_>>());
        for r in rows {
            self.line(&mut out, &r);
        }
        out
    }
}

pub fn minor_digits(currency: &str) -> u32 {
    match currency {
        "BIF" | "CLP" | "DJF" | "GNF" | "ISK" | "JPY" | "KMF" | "KRW" | "PYG" | "RWF" | "UGX" | "UYI" | "VND" | "VUV" | "XAF"
        | "XOF" | "XPF" => 0,
        "BHD" | "IQD" | "JOD" | "KWD" | "LYD" | "OMR" | "TND" => 3,
        _ => 2,
    }
}

pub const TRANSACTION_HEADER: &[&str] =
    &["date", "time", "type", "amount", "currency", "account", "to_account", "category", "counterparty", "title", "note", "tags", "reference"];

pub struct Names {
    labels: HashMap<String, String>,
    categories: HashMap<String, categories::Category>,
    accounts: HashMap<String, String>,
}

impl Names {
    pub fn load(conn: &Connection, labels: HashMap<String, String>) -> AppResult<Self> {
        let categories = categories::list(conn)?.into_iter().map(|c| (c.id.clone(), c)).collect();
        let mut stmt = conn.prepare("SELECT id, name, system_key FROM accounts")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, Option<String>>(2)?)))?;
        let mut accounts = HashMap::new();
        for row in rows {
            let (id, name, key) = row?;
            let shown = key.and_then(|k| labels.get(&k).cloned()).unwrap_or(name);
            accounts.insert(id, shown);
        }
        Ok(Self { labels, categories, accounts })
    }

    pub fn account(&self, id: &str) -> String {
        self.accounts.get(id).cloned().unwrap_or_default()
    }

    pub fn category_name(&self, c: &categories::Category) -> String {
        c.system_key.as_ref().and_then(|k| self.labels.get(k).cloned()).unwrap_or_else(|| c.name.clone())
    }

    pub fn category_path(&self, id: &str) -> String {
        let mut parts = Vec::new();
        let mut current = self.categories.get(id);
        while let Some(c) = current {
            if parts.len() > 32 {
                break;
            }
            parts.push(self.category_name(c));
            current = c.parent_id.as_ref().and_then(|p| self.categories.get(p));
        }
        parts.reverse();
        parts.join(" > ")
    }

    fn opt_category(&self, id: Option<&String>) -> String {
        id.map(|i| self.category_path(i)).unwrap_or_default()
    }
}

fn transactions_rows(conn: &Connection, f: &Format, names: &Names, filter: &TransactionFilter) -> AppResult<Vec<Vec<String>>> {
    let mut all = Vec::new();
    let mut page = filter.clone();
    page.limit = Some(5000);
    page.offset = Some(0);
    loop {
        let batch = transactions::list(conn, &page)?;
        let n = batch.len();
        all.extend(batch);
        if n < 5000 {
            break;
        }
        page.offset = Some(page.offset.unwrap_or(0) + 5000);
    }
    all.sort_by(|a, b| a.occurred_on.cmp(&b.occurred_on).then(a.occurred_time.cmp(&b.occurred_time)).then(a.created_at.cmp(&b.created_at)));
    Ok(all
        .into_iter()
        .map(|t| {
            let signed = if t.kind == "expense" { -t.amount_minor } else { t.amount_minor };
            vec![
                t.occurred_on.clone(),
                t.occurred_time.clone().unwrap_or_default(),
                t.kind.clone(),
                f.money(signed, &t.currency),
                t.currency.clone(),
                names.account(&t.account_id),
                t.to_account_id.as_deref().map(|a| names.account(a)).unwrap_or_default(),
                names.opt_category(t.category_id.as_ref()),
                t.counterparty_name.clone().unwrap_or_default(),
                t.title.clone(),
                t.note.clone().unwrap_or_default(),
                t.tags.join(" "),
                t.r#ref.clone(),
            ]
        })
        .collect())
}

fn dataset(conn: &Connection, name: &str, f: &Format, names: &Names, filter: &TransactionFilter, today: NaiveDate) -> AppResult<Vec<u8>> {
    let yes_no = |b: bool| if b { "yes".to_owned() } else { "no".to_owned() };
    Ok(match name {
        "transactions" => f.table(TRANSACTION_HEADER, transactions_rows(conn, f, names, filter)?),
        "accounts" => f.table(
            &["name", "type", "currency", "balance", "opening_balance", "corrected_on", "archived", "color"],
            accounts::list_as_of(conn, today)?
                .into_iter()
                .map(|a| {
                    vec![
                        names.account(&a.id),
                        a.kind.clone(),
                        a.currency.clone(),
                        f.money(a.balance_minor, &a.currency),
                        f.money(a.opening_minor, &a.currency),
                        a.anchor_on.clone().unwrap_or_default(),
                        yes_no(a.archived),
                        a.color.clone().unwrap_or_default(),
                    ]
                })
                .collect(),
        ),
        "categories" => f.table(
            &["path", "name", "parent", "type", "icon", "color"],
            categories::list(conn)?
                .iter()
                .map(|c| {
                    vec![
                        names.category_path(&c.id),
                        names.category_name(c),
                        names.opt_category(c.parent_id.as_ref()),
                        c.kind.clone(),
                        c.icon.clone().unwrap_or_default(),
                        c.color.clone().unwrap_or_default(),
                    ]
                })
                .collect(),
        ),
        "recurring" => f.table(
            &[
                "title", "type", "amount", "currency", "account", "to_account", "category", "counterparty", "frequency", "every",
                "start", "end", "time", "max_count", "automatic", "next", "per_month", "note",
            ],
            recurring::list(conn, today)?
                .into_iter()
                .map(|r| {
                    vec![
                        r.title.clone(),
                        r.kind.clone(),
                        f.money(r.amount_minor, &r.currency),
                        r.currency.clone(),
                        names.account(&r.account_id),
                        r.to_account_id.as_deref().map(|a| names.account(a)).unwrap_or_default(),
                        names.opt_category(r.category_id.as_ref()),
                        r.counterparty_name.clone().unwrap_or_default(),
                        r.freq.clone(),
                        r.interval_n.to_string(),
                        r.start_on.clone(),
                        r.end_on.clone().unwrap_or_default(),
                        r.occurred_time.clone().unwrap_or_default(),
                        r.max_count.map(|n| n.to_string()).unwrap_or_default(),
                        yes_no(r.auto_post),
                        r.next_on.clone().unwrap_or_default(),
                        f.money(r.monthly_minor, &r.currency),
                        r.note.clone().unwrap_or_default(),
                    ]
                })
                .collect(),
        ),
        "budgets" => f.table(
            &["category", "period", "limit", "currency", "spent", "remaining", "from", "to"],
            budgets::list(conn, today)?
                .into_iter()
                .map(|b| {
                    vec![
                        names.category_path(&b.category_id),
                        b.period.clone(),
                        f.money(b.limit_minor, &b.currency),
                        b.currency.clone(),
                        f.money(b.spent_minor, &b.currency),
                        f.money(b.remaining_minor, &b.currency),
                        b.from.clone(),
                        b.to.clone(),
                    ]
                })
                .collect(),
        ),
        "goals" => f.table(
            &["title", "target", "saved", "remaining", "currency", "target_date", "per_month_needed", "archived", "note"],
            goals::list(conn, today)?
                .into_iter()
                .map(|g| {
                    vec![
                        g.title.clone(),
                        f.money(g.target_minor, &g.currency),
                        f.money(g.saved_minor, &g.currency),
                        f.money(g.remaining_minor, &g.currency),
                        g.currency.clone(),
                        g.target_on.clone().unwrap_or_default(),
                        g.monthly_needed_minor.map(|m| f.money(m, &g.currency)).unwrap_or_default(),
                        yes_no(g.archived),
                        g.note.clone().unwrap_or_default(),
                    ]
                })
                .collect(),
        ),
        "debts" => f.table(
            &[
                "title", "direction", "counterparty", "principal", "paid", "remaining", "currency", "start", "due", "interest_percent",
                "next_payment", "paid_off_by", "archived", "note",
            ],
            debts::list(conn, today)?
                .into_iter()
                .map(|d| {
                    vec![
                        d.title.clone(),
                        d.direction.clone(),
                        d.counterparty_name.clone().unwrap_or_default(),
                        f.money(d.principal_minor, &d.currency),
                        f.money(d.paid_minor, &d.currency),
                        f.money(d.remaining_minor, &d.currency),
                        d.currency.clone(),
                        d.start_on.clone(),
                        d.due_on.clone().unwrap_or_default(),
                        d.interest_bp.map(|bp| f.money(bp, "EUR")).unwrap_or_default(),
                        d.next_payment_on.clone().unwrap_or_default(),
                        d.payoff_on.clone().unwrap_or_default(),
                        yes_no(d.archived),
                        d.note.clone().unwrap_or_default(),
                    ]
                })
                .collect(),
        ),
        other => return Err(AppError::Invalid(format!("unknown dataset {other:?}"))),
    })
}

pub struct Exported {
    pub bytes: Vec<u8>,
    pub files: usize,
}

pub fn export(conn: &Connection, opts: &ExportOptions, today: NaiveDate) -> AppResult<Exported> {
    let selected: Vec<&str> = DATASETS.iter().copied().filter(|d| opts.datasets.iter().any(|x| x == d)).collect();
    if selected.is_empty() {
        return Err(AppError::Invalid("nothing selected to export".into()));
    }
    let f = Format::new(&opts.delimiter, opts.decimal_comma);
    let names = Names::load(conn, opts.labels.clone())?;
    let filter = opts.filter.clone().unwrap_or_default();
    let mut files = Vec::new();
    for name in &selected {
        files.push((format!("{name}.csv"), dataset(conn, name, &f, &names, &filter, today)?));
    }
    if files.len() == 1 {
        return Ok(Exported { bytes: files.remove(0).1, files: 1 });
    }
    let mut zip = Vec::new();
    write_zip(&mut zip, &files, chrono::Local::now().naive_local())?;
    Ok(Exported { bytes: zip, files: files.len() })
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for &b in data {
        crc ^= u32::from(b);
        for _ in 0..8 {
            crc = if crc & 1 != 0 { 0xEDB8_8320 ^ (crc >> 1) } else { crc >> 1 };
        }
    }
    !crc
}

pub fn write_zip(out: &mut impl Write, files: &[(String, Vec<u8>)], at: chrono::NaiveDateTime) -> std::io::Result<()> {
    let dos_time = ((at.hour() << 11) | (at.minute() << 5) | (at.second() / 2)) as u16;
    let dos_date = (((at.year().clamp(1980, 2107) - 1980) as u32) << 9 | (at.month() << 5) | at.day()) as u16;
    let mut central = Vec::new();
    let mut offset = 0u32;
    for (name, data) in files {
        let crc = crc32(data);
        let size = data.len() as u32;
        let name = name.as_bytes();
        let mut local = Vec::with_capacity(30 + name.len());
        local.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
        local.extend_from_slice(&20u16.to_le_bytes());
        local.extend_from_slice(&0x0800u16.to_le_bytes());
        local.extend_from_slice(&0u16.to_le_bytes());
        local.extend_from_slice(&dos_time.to_le_bytes());
        local.extend_from_slice(&dos_date.to_le_bytes());
        local.extend_from_slice(&crc.to_le_bytes());
        local.extend_from_slice(&size.to_le_bytes());
        local.extend_from_slice(&size.to_le_bytes());
        local.extend_from_slice(&(name.len() as u16).to_le_bytes());
        local.extend_from_slice(&0u16.to_le_bytes());
        local.extend_from_slice(name);
        out.write_all(&local)?;
        out.write_all(data)?;

        central.extend_from_slice(&0x0201_4b50u32.to_le_bytes());
        central.extend_from_slice(&20u16.to_le_bytes());
        central.extend_from_slice(&20u16.to_le_bytes());
        central.extend_from_slice(&0x0800u16.to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes());
        central.extend_from_slice(&dos_time.to_le_bytes());
        central.extend_from_slice(&dos_date.to_le_bytes());
        central.extend_from_slice(&crc.to_le_bytes());
        central.extend_from_slice(&size.to_le_bytes());
        central.extend_from_slice(&size.to_le_bytes());
        central.extend_from_slice(&(name.len() as u16).to_le_bytes());
        central.extend_from_slice(&[0u8; 8]);
        central.extend_from_slice(&0u32.to_le_bytes());
        central.extend_from_slice(&offset.to_le_bytes());
        central.extend_from_slice(name);
        offset += (local.len() + data.len()) as u32;
    }
    out.write_all(&central)?;
    let mut end = Vec::with_capacity(22);
    end.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
    end.extend_from_slice(&[0u8; 4]);
    end.extend_from_slice(&(files.len() as u16).to_le_bytes());
    end.extend_from_slice(&(files.len() as u16).to_le_bytes());
    end.extend_from_slice(&(central.len() as u32).to_le_bytes());
    end.extend_from_slice(&offset.to_le_bytes());
    end.extend_from_slice(&0u16.to_le_bytes());
    out.write_all(&end)
}

pub fn template(delimiter: &str) -> Vec<u8> {
    Format::new(delimiter, false).table(TRANSACTION_HEADER, vec![])
}

pub fn backup(conn: &Connection, path: &Path) -> AppResult<()> {
    if path.exists() {
        std::fs::remove_file(path)?;
    }
    let target = path.to_str().ok_or_else(|| AppError::Invalid("path is not valid UTF-8".into()))?;
    conn.execute("VACUUM INTO ?1", [target])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    #[test]
    fn quotes_only_when_needed() {
        let f = Format::new(",", false);
        assert_eq!(f.field("Döner"), "Döner");
        assert_eq!(f.field("a,b"), "\"a,b\"");
        assert_eq!(f.field("say \"hi\""), "\"say \"\"hi\"\"\"");
        assert_eq!(f.field("=SUM(A1)"), "\"=SUM(A1)\"");
        let f = Format::new(";", true);
        assert_eq!(f.field("a,b"), "a,b");
        assert_eq!(f.money(-123_456, "EUR"), "-1234,56");
        assert_eq!(Format::new(",", true).money(5, "EUR"), "0.05", "a comma list never uses decimal commas");
        assert_eq!(f.money(500, "JPY"), "500");
    }

    #[test]
    fn crc_matches_the_standard_check_value() {
        assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
    }

    #[test]
    fn exports_everything_into_one_zip() {
        let db = Db::open_in_memory().unwrap();
        crate::domain::demo::load(&db, NaiveDate::from_ymd_opt(2026, 10, 8).unwrap()).unwrap();
        let mut labels = HashMap::new();
        labels.insert("category.food".to_owned(), "Essen & Trinken".to_owned());
        let opts = ExportOptions {
            datasets: DATASETS.iter().map(|s| (*s).to_owned()).collect(),
            delimiter: ";".into(),
            decimal_comma: true,
            labels,
            filter: None,
        };
        let out = export(&db.conn(), &opts, NaiveDate::from_ymd_opt(2026, 10, 8).unwrap()).unwrap();
        assert_eq!(out.files, DATASETS.len());
        assert_eq!(&out.bytes[..4], b"PK\x03\x04");

        let single = export(&db.conn(), &ExportOptions { datasets: vec!["transactions".into()], ..opts.clone() }, NaiveDate::from_ymd_opt(2026, 10, 8).unwrap()).unwrap();
        let text = String::from_utf8(single.bytes).unwrap();
        assert!(text.starts_with("\u{feff}date;time;type;amount;"));
        assert!(text.contains("Essen & Trinken > "), "subcategories are exported with their path");
        assert!(text.lines().count() > 50);
    }
}
