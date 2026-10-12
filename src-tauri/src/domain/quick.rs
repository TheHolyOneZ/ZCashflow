use chrono::{Datelike, Duration, NaiveDate};
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickEntry {
    pub title: String,
    pub amount_minor: Option<i64>,
    pub kind: String,
    pub occurred_on: String,
}

pub fn parse(input: &str, today: NaiveDate) -> QuickEntry {
    let mut amount = None;
    let mut kind = "expense";
    let mut date = None;
    let mut words = Vec::new();

    for token in input.split_whitespace() {
        if date.is_none() {
            if let Some(d) = parse_date(token, today) {
                date = Some(d);
                continue;
            }
        }
        if amount.is_none() {
            if let Some((cents, income)) = parse_amount(token) {
                amount = Some(cents);
                if income {
                    kind = "income";
                }
                continue;
            }
        }
        words.push(token);
    }

    QuickEntry {
        title: words.join(" "),
        amount_minor: amount,
        kind: kind.into(),
        occurred_on: date.unwrap_or(today).to_string(),
    }
}

fn parse_amount(token: &str) -> Option<(i64, bool)> {
    let mut s = token.trim();
    let income = s.starts_with('+');
    s = s.trim_start_matches(['+', '-']);
    for sym in ["€", "$", "£", "EUR", "eur", "USD", "usd", "CHF", "chf"] {
        s = s.trim_start_matches(sym).trim_end_matches(sym);
    }
    if s.is_empty() || !s.chars().next()?.is_ascii_digit() {
        return None;
    }
    if !s.chars().all(|c| c.is_ascii_digit() || c == '.' || c == ',') {
        return None;
    }

    let (int_part, frac_part) = match s.rfind(['.', ',']) {
        Some(i) if (1..=2).contains(&(s.len() - i - 1)) => (&s[..i], &s[i + 1..]),
        _ => (s, ""),
    };
    let int_digits: String = int_part.chars().filter(char::is_ascii_digit).collect();
    let int: i64 = int_digits.parse().ok()?;
    let frac: i64 = match frac_part.len() {
        0 => 0,
        1 => frac_part.parse::<i64>().ok()? * 10,
        _ => frac_part.parse().ok()?,
    };
    let cents = int.checked_mul(100)?.checked_add(frac)?;
    (cents > 0).then_some((cents, income))
}

fn parse_date(token: &str, today: NaiveDate) -> Option<NaiveDate> {
    match token.to_lowercase().as_str() {
        "heute" | "today" => return Some(today),
        "gestern" | "yesterday" => return Some(today - Duration::days(1)),
        "vorgestern" => return Some(today - Duration::days(2)),
        _ => {}
    }
    if let Ok(d) = NaiveDate::parse_from_str(token, "%Y-%m-%d") {
        return Some(d);
    }

    if token.matches('.').count() < 2 {
        return None;
    }
    let parts: Vec<&str> = token.trim_end_matches('.').split('.').collect();
    let (d, m): (u32, u32) = match parts.as_slice() {
        [d, m] | [d, m, _] => (d.parse().ok()?, m.parse().ok()?),
        _ => return None,
    };
    if let [_, _, y] = parts.as_slice() {
        let y: i32 = y.parse().ok()?;
        let y = if y < 100 { 2000 + y } else { y };
        return NaiveDate::from_ymd_opt(y, m, d);
    }
    let this_year = NaiveDate::from_ymd_opt(today.year(), m, d)?;
    if this_year <= today {
        Some(this_year)
    } else {
        NaiveDate::from_ymd_opt(today.year() - 1, m, d)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 10, 8).unwrap()
    }

    fn p(s: &str) -> QuickEntry {
        parse(s, today())
    }

    #[test]
    fn german_decimal_comma() {
        let e = p("Döner 8,50");
        assert_eq!(e.title, "Döner");
        assert_eq!(e.amount_minor, Some(850));
        assert_eq!(e.kind, "expense");
        assert_eq!(e.occurred_on, "2026-10-08");
    }

    #[test]
    fn amounts() {
        assert_eq!(parse_amount("8.5"), Some((850, false)));
        assert_eq!(parse_amount("1.234,56"), Some((123_456, false)));
        assert_eq!(parse_amount("1,234.56"), Some((123_456, false)));
        assert_eq!(parse_amount("1.000"), Some((100_000, false)));
        assert_eq!(parse_amount("60€"), Some((6_000, false)));
        assert_eq!(parse_amount("+2500"), Some((250_000, true)));
        assert_eq!(parse_amount("abc"), None);
        assert_eq!(parse_amount("0"), None);
        assert_eq!(parse_amount("99999999999999999999"), None);
    }

    #[test]
    fn income_and_relative_date() {
        let e = p("+2500 Gehalt gestern");
        assert_eq!(e.kind, "income");
        assert_eq!(e.amount_minor, Some(250_000));
        assert_eq!(e.title, "Gehalt");
        assert_eq!(e.occurred_on, "2026-10-07");
    }

    #[test]
    fn day_month_dates() {
        assert_eq!(p("Tanken 60 03.10.").occurred_on, "2026-10-03");
        assert_eq!(p("Geschenk 20 24.12.").occurred_on, "2025-12-24");
        assert_eq!(p("Miete 800 01.09.2026").occurred_on, "2026-09-01");
    }

    #[test]
    fn date_without_amount_is_not_an_amount() {
        let e = p("Döner 03.10.");
        assert_eq!(e.amount_minor, None);
        assert_eq!(e.occurred_on, "2026-10-03");
        assert_eq!(p("Bäcker 1.12").amount_minor, Some(112));
    }

    #[test]
    fn only_first_amount_is_taken() {
        let e = p("2 Pizza 18,90");
        assert_eq!(e.amount_minor, Some(200));
        assert_eq!(e.title, "Pizza 18,90");
    }

    #[test]
    fn no_amount() {
        let e = p("Kino");
        assert_eq!(e.amount_minor, None);
        assert_eq!(e.title, "Kino");
    }
}
