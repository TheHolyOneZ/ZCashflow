use std::io::Write;
use std::path::Path;

use rusqlite::Connection;

use crate::error::{AppError, AppResult};

fn csv_field(s: &str) -> String {
    if s.contains([',', ';', '"', '\n', '\r']) {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_owned()
    }
}

pub fn transactions_csv(conn: &Connection, path: &Path) -> AppResult<usize> {
    let mut stmt = conn.prepare(
        "SELECT t.ref, t.occurred_on, t.kind, t.amount_minor, t.currency, a.name, ta.name,
                coalesce(c.name, ''), coalesce(cp.name, ''), t.title, coalesce(t.note, ''), t.tags
         FROM transactions t
         JOIN accounts a ON a.id = t.account_id
         LEFT JOIN accounts ta ON ta.id = t.to_account_id
         LEFT JOIN categories c ON c.id = t.category_id
         LEFT JOIN counterparties cp ON cp.id = t.counterparty_id
         WHERE t.deleted = 0
         ORDER BY t.occurred_on, t.created_at",
    )?;
    let mut out = std::io::BufWriter::new(std::fs::File::create(path)?);
    writeln!(out, "reference,date,type,amount,currency,account,to_account,category,counterparty,title,note,tags")?;
    let mut n = 0;
    let mut rows = stmt.query([])?;
    while let Some(r) = rows.next()? {
        let kind: String = r.get(2)?;
        let amount: i64 = r.get(3)?;
        let signed = if kind == "expense" { -amount } else { amount };
        let tags: Vec<String> = serde_json::from_str(&r.get::<_, String>(11)?).unwrap_or_default();
        let fields = [
            r.get::<_, String>(0)?,
            r.get(1)?,
            kind,
            format!("{}{}.{:02}", if signed < 0 { "-" } else { "" }, signed.abs() / 100, signed.abs() % 100),
            r.get(4)?,
            r.get(5)?,
            r.get::<_, Option<String>>(6)?.unwrap_or_default(),
            r.get(7)?,
            r.get(8)?,
            r.get(9)?,
            r.get(10)?,
            tags.join(" "),
        ];
        let line: Vec<String> = fields.iter().map(|f| csv_field(f)).collect();
        writeln!(out, "{}", line.join(","))?;
        n += 1;
    }
    out.flush()?;
    Ok(n)
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

    #[test]
    fn quotes_only_when_needed() {
        assert_eq!(csv_field("Döner"), "Döner");
        assert_eq!(csv_field("a,b"), "\"a,b\"");
        assert_eq!(csv_field("say \"hi\""), "\"say \"\"hi\"\"\"");
    }
}
