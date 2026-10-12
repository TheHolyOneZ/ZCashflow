use std::sync::LazyLock;

use chrono::NaiveDate;
use regex::Regex;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Extracted {
    pub merchant: Option<String>,
    pub date: Option<String>,
    pub total_minor: Option<i64>,
    pub currency: Option<String>,

    #[serde(default)]
    pub category_hint: Option<String>,

    pub source: String,
}

static AMOUNT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?:^|[^\d])(-?\d{1,3}(?:[.\s]\d{3})*|\d+)\s?[.,]\s?(\d{2})(?:[^\d]|$)").unwrap());
static DATE_DMY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?:^|[^\d,.])(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})\b").unwrap());

static DATE_DMY_LOOSE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?m)(?:^|[^\d,.])(\d{1,2}) (\d{1,2})[./-](\d{4})\b").unwrap());
static DATE_ISO: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\b(\d{4})-(\d{2})-(\d{2})\b").unwrap());

const TOTAL_KEYS: &[&str] = &[
    "zu zahlen", "zahlbetrag", "endbetrag", "gesamtbetrag", "summe", "gesamt", "total", "amount due",
    "betrag", "grand total",
];

const NOT_TOTAL: &[&str] = &[
    "mwst", "ust", "netto", "steuer", "tax", "vat", "rückgeld", "ruckgeld", "gegeben", "change", "brutto netto",
    "rabatt", "pfand", "zwischensumme", "subtotal",
];

const NOT_MERCHANT: &[&str] = &[
    "str.", "straße", "strasse", "tel", "fax", "www", "http", "ust-id", "steuer", "uid", "kasse", "beleg",
    "rechnung", "quittung", "bon", "datum", "uhrzeit", "filiale", "@", "willkommen", "welcome",
];

fn parse_amount(line: &str) -> Vec<i64> {
    let cleaned = line.replace(['O', 'o'], "0");
    AMOUNT
        .captures_iter(&cleaned)
        .filter_map(|c| {
            let int: String = c[1].chars().filter(|ch| ch.is_ascii_digit() || *ch == '-').collect();
            let int: i64 = int.parse().ok()?;
            let frac: i64 = c[2].parse().ok()?;
            let v = int.abs() * 100 + frac;
            (v > 0 && v < 10_000_000).then_some(v)
        })
        .collect()
}

fn find_total(lines: &[&str]) -> Option<i64> {
    for key in TOTAL_KEYS {
        for (i, line) in lines.iter().enumerate() {
            let lower = line.to_lowercase();
            if !lower.contains(key) || NOT_TOTAL.iter().any(|n| lower.contains(n)) {
                continue;
            }
            if let Some(v) = parse_amount(line).last() {
                return Some(*v);
            }

            if let Some(v) = lines.get(i + 1).and_then(|l| parse_amount(l).last().copied()) {
                return Some(v);
            }
        }
    }

    lines
        .iter()
        .filter(|l| {
            let lower = l.to_lowercase();
            !NOT_TOTAL.iter().any(|n| lower.contains(n))
        })
        .flat_map(|l| parse_amount(l))
        .max()
}

fn find_date(text: &str, today: NaiveDate) -> Option<NaiveDate> {
    let plausible = |d: NaiveDate| d <= today + chrono::Duration::days(1) && d.year_ce().1 >= 2000;
    for c in DATE_ISO.captures_iter(text) {
        if let Some(d) = NaiveDate::from_ymd_opt(c[1].parse().ok()?, c[2].parse().ok()?, c[3].parse().ok()?) {
            if plausible(d) {
                return Some(d);
            }
        }
    }
    for c in DATE_DMY.captures_iter(text).chain(DATE_DMY_LOOSE.captures_iter(text)) {
        let day: u32 = c[1].parse().ok()?;
        let month: u32 = c[2].parse().ok()?;
        let mut year: i32 = c[3].parse().ok()?;
        if year < 100 {
            year += 2000;
        }
        if let Some(d) = NaiveDate::from_ymd_opt(year, month, day) {
            if plausible(d) {
                return Some(d);
            }
        }
    }
    None
}

use chrono::Datelike;

fn find_merchant(lines: &[&str]) -> Option<String> {
    lines.iter().take(6).find_map(|l| {
        let lower = l.to_lowercase();
        let letters = l.chars().filter(|c| c.is_alphabetic()).count();
        let digits = l.chars().filter(|c| c.is_ascii_digit()).count();
        if letters < 3 || digits > letters || NOT_MERCHANT.iter().any(|n| lower.contains(n)) {
            return None;
        }
        let name: String = l.trim_matches(|c: char| !c.is_alphanumeric()).split_whitespace().collect::<Vec<_>>().join(" ");
        (name.len() >= 3).then(|| tidy_case(&name))
    })
}

fn tidy_case(s: &str) -> String {
    if s.chars().any(|c| c.is_lowercase()) {
        return s.to_owned();
    }
    s.split(' ')
        .map(|w| match w.to_lowercase().as_str() {
            "gmbh" => "GmbH".into(),
            "ag" | "kg" | "ohg" | "ug" | "e.k." => w.to_owned(),
            lw => {
                let mut c = lw.chars();
                c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn find_currency(text: &str) -> Option<String> {
    let t = text.to_uppercase();
    if t.contains('€') || t.contains("EUR") {
        Some("EUR".into())
    } else if t.contains("CHF") {
        Some("CHF".into())
    } else if t.contains('£') || t.contains("GBP") {
        Some("GBP".into())
    } else if t.contains('$') || t.contains("USD") {
        Some("USD".into())
    } else {
        None
    }
}

pub fn extract(text: &str, today: NaiveDate) -> Extracted {
    let lines: Vec<&str> = text.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    Extracted {
        merchant: find_merchant(&lines),
        date: find_date(text, today).map(|d| d.to_string()),
        total_minor: find_total(&lines),
        currency: find_currency(text),
        category_hint: None,
        source: "rules".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, 8).unwrap()
    }

    const REWE: &str = "REWE MARKT GMBH
Hauptstr. 12
10115 Berlin
UID Nr.: DE812706034
                EUR
BIO BANANEN       1,99 B
VOLLMILCH 3,5%    1,19 B
PFAND             0,25 A
SPAGHETTI         0,89 B
--------------------------
SUMME           EUR 4,32
Geg. EC-Cash   EUR 4,32
Steuer %    Netto  Steuer  Brutto
B=  7,0%     3,85   0,27    4,07
06.10.2026 18:42  Bon-Nr.:4711";

    const KEBAB: &str = "Kebab Haus Istanbul
Tel. 030 1234567
1x Döner          7,50
1x Ayran          2,00
Total:            9,50 €
Gegeben          10,00
Rückgeld          0,50
Datum: 07.10.26";

    const ENGLISH: &str = "Blue Bottle Coffee
2026-10-05 08:12
Latte            5.50
Croissant        4.25
Subtotal         9.75
Tax              0.85
Amount due      10.60
VISA ****1234";

    #[test]
    fn german_supermarket() {
        let e = extract(REWE, today());
        assert_eq!(e.merchant.as_deref(), Some("Rewe Markt GmbH"));
        assert_eq!(e.total_minor, Some(432));
        assert_eq!(e.date.as_deref(), Some("2026-10-06"));
        assert_eq!(e.currency.as_deref(), Some("EUR"));
    }

    #[test]
    fn small_shop_with_change_and_short_year() {
        let e = extract(KEBAB, today());
        assert_eq!(e.merchant.as_deref(), Some("Kebab Haus Istanbul"));
        assert_eq!(e.total_minor, Some(950));
        assert_eq!(e.date.as_deref(), Some("2026-10-07"));
    }

    #[test]
    fn english_receipt_skips_subtotal_and_tax() {
        let e = extract(ENGLISH, today());
        assert_eq!(e.merchant.as_deref(), Some("Blue Bottle Coffee"));
        assert_eq!(e.total_minor, Some(1060));
        assert_eq!(e.date.as_deref(), Some("2026-10-05"));
    }

    #[test]
    fn ocr_noise() {
        assert_eq!(parse_amount("SUMME 1O,5O"), vec![1050]);
        assert_eq!(parse_amount("Total 1.234,56"), vec![123_456]);
        assert_eq!(parse_amount("Total 12 , 99"), vec![1299]);
        assert!(find_date("31.02.2026 99.99.9999", today()).is_none());
        assert!(find_date("01.01.2099", today()).is_none(), "future dates are implausible");

        assert_eq!(find_date("06 10.2026 18:42", today()).map(|d| d.to_string()).as_deref(), Some("2026-10-06"));
    }

    #[test]
    fn fallback_takes_largest_non_tax_amount() {
        let e = extract("Cafe Lindner\nCappuccino 3,80\nKuchen 4,20\n8,00\nMwSt 19% 1,28", today());
        assert_eq!(e.total_minor, Some(800));
    }
}
