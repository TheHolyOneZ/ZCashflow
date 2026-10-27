use chrono::{Datelike, Duration, Months, NaiveDate};
use rusqlite::params;

use super::{accounts, budgets, debts, goals, recurring, transactions};
use crate::db::{det_id, get_meta, set_meta, Db};
use crate::error::{AppError, AppResult};

struct Lcg(u64);
impl Lcg {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        self.0 >> 33
    }
    fn range(&mut self, lo: i64, hi: i64) -> i64 {
        lo + (self.next() % (hi - lo + 1) as u64) as i64
    }
    fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
        &items[(self.next() % items.len() as u64) as usize]
    }
}

fn cat(db: &Db, key: &str) -> String {
    let id = det_id("seed", &format!("category.{key}"));

    db.conn()
        .query_row("SELECT id FROM categories WHERE id = ?1 OR system_key = ?2 LIMIT 1", params![id, format!("category.{key}")], |r| r.get(0))
        .unwrap_or(id)
}

fn record(db: &Db, table: &str, id: &str) -> AppResult<()> {
    let conn = db.conn();
    let mut list: Vec<(String, String)> = get_meta(&conn, "demo_rows")?
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    if !list.iter().any(|(t, i)| t == table && i == id) {
        list.push((table.into(), id.into()));
    }
    set_meta(&conn, "demo_rows", &serde_json::to_string(&list).unwrap())
}

pub fn is_loaded(db: &Db) -> AppResult<bool> {
    Ok(get_meta(&db.conn(), "demo_rows")?.is_some_and(|s| s != "[]"))
}

fn account(db: &Db, name: &str, kind: &str, opening: i64, color: &str) -> AppResult<String> {
    let id = det_id("demo", name);
    let exists: i64 = db.conn().query_row("SELECT count(*) FROM accounts WHERE id = ?1", [&id], |r| r.get(0))?;
    if exists == 0 {
        db.conn().execute(
            "INSERT INTO accounts (id, name, kind, currency, opening_minor, color, created_at, device_id, updated_hlc)
             VALUES (?1, ?2, ?3, 'EUR', ?4, ?5, datetime('now'), ?6, ?7)",
            params![id, name, kind, opening, color, db.device_id(), db.hlc.tick()],
        )?;
    } else {
        db.conn().execute("UPDATE accounts SET deleted = 0, archived = 0, updated_hlc = ?2 WHERE id = ?1", params![id, db.hlc.tick()])?;
    }
    record(db, "accounts", &id)?;
    Ok(id)
}

#[allow(clippy::too_many_arguments)]
fn rule(
    db: &Db,
    today: NaiveDate,
    title: &str,
    kind: &str,
    amount: i64,
    account_id: &str,
    to_account: Option<&str>,
    category: Option<String>,
    counterparty: Option<&str>,
    freq: &str,
    interval: u32,
    start: NaiveDate,
    auto: bool,
    backfill: bool,
) -> AppResult<String> {
    let r = recurring::upsert(
        db,
        recurring::RecurringInput {
            id: None,
            title: title.into(),
            kind: kind.into(),
            amount_minor: amount,
            account_id: account_id.into(),
            to_account_id: to_account.map(Into::into),
            category_id: category,
            counterparty: counterparty.map(Into::into),
            freq: freq.into(),
            interval_n: interval,
            start_on: start.to_string(),
            end_on: None,
            max_count: None,
            auto_post: auto,
            backfill,
            occurred_time: None,
            note: None,
        },
        today,
    )?;
    record(db, "recurring_rules", &r.id)?;
    Ok(r.id)
}

fn day_in_month(base: NaiveDate, months_back: u32, day: u32) -> NaiveDate {
    let m = base.with_day(1).unwrap() - Months::new(months_back);
    let last = (m + Months::new(1) - Duration::days(1)).day();
    m.with_day(day.min(last)).unwrap()
}

#[cfg(test)]
pub fn load(db: &Db, today: NaiveDate) -> AppResult<()> {
    load_in(db, today, "de")
}

pub fn load_in(db: &Db, today: NaiveDate, lang: &str) -> AppResult<()> {
    if is_loaded(db)? {
        return Err(AppError::Invalid("demo data already loaded".into()));
    }
    let de = lang.starts_with("de");
    let t = |german: &'static str, english: &'static str| if de { german } else { english };
    let cash = accounts::list(&db.conn())?.into_iter().find(|a| !a.archived).map(|a| a.id).ok_or_else(|| AppError::Invalid("no account".into()))?;
    let giro = account(db, t("Sparkasse Girokonto", "Main Checking"), "checking", 124_000, "#dc2626")?;
    let savings = account(db, t("Tagesgeld", "Savings"), "savings", 850_000, "#0f766e")?;
    let card = account(db, t("Kreditkarte", "Credit Card"), "credit", 0, "#4f46e5")?;

    let delivery = det_id("demo", "category.delivery");
    let food_parent = cat(db, "food");
    db.conn().execute(
        "INSERT INTO categories (id, parent_id, name, kind, icon, color, created_at, device_id, updated_hlc)
         VALUES (?1, ?2, ?5, 'expense', 'utensils', '#f97316', datetime('now'), ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET deleted = 0, name = excluded.name",
        params![delivery, food_parent, db.device_id(), db.hlc.tick(), t("Lieferdienste", "Delivery")],
    )?;
    record(db, "categories", &delivery)?;

    let six_back = day_in_month(today, 6, 1);

    rule(db, today, t("Gehalt", "Salary"), "income", 285_000, &giro, None, Some(cat(db, "salary")), Some(t("Muster Software GmbH", "Acme Software Ltd")), "monthly", 1, day_in_month(today, 6, 27), true, true)?;
    rule(db, today, t("Miete", "Rent"), "expense", 89_000, &giro, None, Some(cat(db, "housing")), Some(t("Hausverwaltung Schmidt & Partner", "Parkside Property Management")), "monthly", 1, six_back, true, true)?;
    rule(db, today, "Netflix", "expense", 1_399, &card, None, Some(cat(db, "subscriptions")), Some("Netflix"), "monthly", 1, day_in_month(today, 6, 14), true, true)?;
    rule(db, today, "Spotify Family", "expense", 1_799, &card, None, Some(cat(db, "subscriptions")), Some("Spotify"), "monthly", 1, day_in_month(today, 6, 3), true, true)?;
    rule(db, today, t("Fitnessstudio", "Gym"), "expense", 2_990, &giro, None, Some(cat(db, "health")), Some("McFit"), "monthly", 1, day_in_month(today, 6, 5), true, true)?;
    rule(db, today, t("Handyvertrag", "Phone plan"), "expense", 2_499, &giro, None, Some(cat(db, "utilities")), Some("Telekom"), "monthly", 1, day_in_month(today, 6, 20), true, true)?;
    rule(db, today, t("Rundfunkbeitrag", "Water bill"), "expense", 5_508, &giro, None, Some(cat(db, "utilities")), Some(t("ARD ZDF Deutschlandradio", "City Water")), "monthly", 3, day_in_month(today, 5, 15), true, true)?;
    rule(db, today, t("Geldautomat", "ATM withdrawal"), "transfer", 15_000, &giro, Some(&cash), None, None, "weekly", 2, day_in_month(today, 6, 4), true, true)?;
    rule(db, today, t("Sparplan Tagesgeld", "Savings plan"), "transfer", 20_000, &giro, Some(&savings), None, None, "monthly", 1, day_in_month(today, 6, 2), true, true)?;

    rule(db, today, t("Stromabschlag", "Electricity"), "expense", 7_800, &giro, None, Some(cat(db, "utilities")), Some(t("Stadtwerke", "City Power")), "monthly", 1, today - Duration::days(1), false, true)?;

    rule(db, today, t("Kfz-Versicherung", "Car insurance"), "expense", 48_600, &giro, None, Some(cat(db, "transport")), Some("HUK-Coburg"), "yearly", 1, today + Duration::days(53), true, false)?;

    let car = debts::upsert(
        db,
        debts::DebtInput {
            id: None,
            title: t("Autokredit Golf", "Car loan").into(),
            direction: "i_owe".into(),
            counterparty: Some("Volkswagen Bank".into()),
            principal_minor: 980_000,
            currency: Some("EUR".into()),
            start_on: (today - Duration::days(400)).to_string(),
            due_on: None,
            interest_bp: Some(390),
            note: None,
            archived: false,
            installment: Some(debts::InstallmentInput {
                amount_minor: 24_500,
                freq: "monthly".into(),
                interval_n: 1,
                start_on: day_in_month(today, 0, 15).max(today + Duration::days(1)).to_string(),
                account_id: giro.clone(),
                auto_post: true,
            }),
        },
        today,
    )?;
    record(db, "debts", &car.id)?;
    if let Some(r) = &car.installment {
        record(db, "recurring_rules", &r.id)?;
    }
    for (title, dir, cp, amount, due) in [
        (t("Konzertkarten", "Concert tickets"), "i_owe", "Lisa", 8_900, today + Duration::days(3)),
        (t("Umzugshilfe vorgestreckt", "Moving costs I covered"), "owed_to_me", "Tom", 15_000, today - Duration::days(10)),
    ] {
        let d = debts::upsert(
            db,
            debts::DebtInput {
                id: None,
                title: title.into(),
                direction: dir.into(),
                counterparty: Some(cp.into()),
                principal_minor: amount,
                currency: Some("EUR".into()),
                start_on: (today - Duration::days(30)).to_string(),
                due_on: Some(due.to_string()),
                interest_bp: None,
                note: None,
                archived: false,
                installment: None,
            },
            today,
        )?;
        record(db, "debts", &d.id)?;
    }

    for (title, target, months, saved, color, icon) in [
        (t("Japan-Reise 🇯🇵", "Trip to Japan 🇯🇵"), 350_000, 10u32, 142_000, "#db2777", "plane"),
        (t("Notgroschen (3 Monatsgehälter)", "Emergency fund (3 months)"), 855_000, 6, 180_000, "#0f766e", "shield"),
        (t("Neues Fahrrad", "New bike"), 120_000, 0, 120_000, "#7c3aed", "bike"),
    ] {
        let g = goals::upsert(
            db,
            goals::GoalInput {
                id: None,
                title: title.into(),
                target_minor: target,
                currency: Some("EUR".into()),
                target_on: (months > 0).then(|| (today + Months::new(months)).to_string()),
                account_id: Some(savings.clone()),
                color: Some(color.into()),
                icon: Some(icon.into()),
                note: None,
                archived: false,
                initial_minor: None,
            },
            today,
        )?;
        record(db, "goals", &g.id)?;

        let parts = 4;
        for i in 0..parts {
            goals::allocate(db, &g.id, saved / parts, &(today - Duration::days(25 * i + 3)).to_string(), None, today)?;
        }
    }

    for (key, period, limit) in [("food", "month", 15_000), ("groceries", "month", 45_000), ("shopping", "month", 15_000), ("leisure", "week", 6_000)] {
        let b = budgets::upsert(db, budgets::BudgetInput { id: None, category_id: cat(db, key), period: period.into(), limit_minor: limit }, today)?;
        record(db, "budgets", &b.id)?;
    }

    let mut rng = Lcg(0x5eed_cafe);
    let groceries = ["REWE", "Lidl", "EDEKA", "ALDI SÜD", "dm-drogerie markt", "Bio Company"];
    let food = [
        (t("Döner", "Kebab"), "Kebab Haus Istanbul"),
        ("Pizza", "Pizzeria Da Mario"),
        (t("Kaffee", "Coffee"), "Starbucks"),
        (t("Mittagessen", "Lunch"), t("Kantine", "Canteen")),
        ("Bubble Tea", "Tea One"),
    ];
    let shopping = [(t("Bestellung", "Order"), "Amazon"), ("Sneaker", "Zalando"), (t("Regal KALLAX", "KALLAX shelf"), "IKEA"), (t("Kopfhörer", "Headphones"), "MediaMarkt")];
    let leisure = [(t("Kino", "Cinema"), "CineStar"), (t("Spiel", "Game"), "Steam"), ("Bowling", "Strike Bowling"), (t("Konzert", "Concert"), "Eventim")];

    let (g_cat, f_cat, s_cat, l_cat, t_cat, h_cat) =
        (cat(db, "groceries"), cat(db, "food"), cat(db, "shopping"), cat(db, "leisure"), cat(db, "transport"), cat(db, "health"));
    let mut n = 0usize;
    let mut conn = db.conn();
    let tx = conn.transaction()?;
    let mut add = |date: NaiveDate, title: &str, cp: &str, amount: i64, category: String, account: &str, tags: Vec<String>, note: Option<String>| -> AppResult<()> {
        n += 1;
        let id = det_id("demo-tx", &n.to_string());
        transactions::insert(
            db,
            &tx,
            &transactions::TransactionInput {
                kind: "expense".into(),
                amount_minor: amount,
                currency: Some("EUR".into()),
                occurred_on: date.to_string(),
                occurred_time: Some(format!("{:02}:{:02}", 8 + (n * 7) % 13, (n * 17) % 60)),
                account_id: account.into(),
                to_account_id: None,
                category_id: Some(category),
                counterparty: Some(cp.into()),
                title: title.into(),
                note,
                tags,
                debt_id: None,
                goal_id: None,
            },
            transactions::SystemLinks { id: Some(id.clone()), ..Default::default() },
        )?;
        tx.execute(
            "UPDATE meta SET value = json_insert(value, '$[#]', json_array('transactions', ?1)) WHERE key = 'demo_rows'",
            [&id],
        )?;
        Ok(())
    };
    for back in (0..183).rev() {
        let d = today - Duration::days(back);
        let wd = d.weekday().num_days_from_monday();
        if wd == 1 || wd == 4 || (wd == 5 && rng.range(0, 1) == 1) {
            add(d, t("Einkauf", "Groceries"), rng.pick(&groceries), rng.range(1_500, 9_500), g_cat.clone(), if rng.range(0, 4) == 0 { &cash } else { &giro }, vec![], None)?;
        }
        if rng.range(0, 2) == 0 {
            let (title, c) = *rng.pick(&food);
            let (title, c, k) = if rng.range(0, 6) == 0 { (t("Abendessen", "Dinner"), "Lieferando", delivery.clone()) } else { (title, c, f_cat.clone()) };
            add(d, title, c, rng.range(350, 2_400), k, &cash, vec![], None)?;
        }
        if wd == 2 && back % 14 < 7 {
            add(d, t("Tanken", "Fuel"), "Aral", rng.range(5_000, 8_200), t_cat.clone(), &giro, vec![], None)?;
        }
        if rng.range(0, 9) == 0 {
            let (title, c) = *rng.pick(&shopping);
            add(d, title, c, rng.range(1_999, 12_900), s_cat.clone(), &card, vec!["online".into()], None)?;
        }
        if wd >= 4 && rng.range(0, 4) == 0 {
            let (title, c) = *rng.pick(&leisure);
            add(d, title, c, rng.range(800, 4_500), l_cat.clone(), &card, vec![], None)?;
        }
        if rng.range(0, 30) == 0 {
            add(d, t("Apotheke", "Pharmacy"), t("Löwen-Apotheke", "Lion Pharmacy"), rng.range(450, 3_200), h_cat.clone(), &cash, vec![], None)?;
        }
    }

    add(
        today - Duration::days(2),
        t("Jahresinspektion inkl. Bremsen, Reifenwechsel, Klimaservice und Ersatzwagen", "Annual service incl. brakes, tyre change, A/C service and courtesy car"),
        "Autohaus Müller-Lüdenscheidt GmbH & Co. KG Niederlassung Süd",
        123_456,
        t_cat.clone(),
        &giro,
        vec![t("auto", "car").into(), t("einmalig", "one-off").into()],
        Some(t("Rechnung Nr. 2026-10-00815 – Garantie bis 2028 🔧", "Invoice no. 2026-10-00815 – warranty until 2028 🔧").into()),
    )?;
    add(today, "Snack", t("Späti", "Corner shop"), 150, f_cat.clone(), &cash, vec![], None)?;

    add(today - Duration::days(1), t("Geburtstagsessen", "Birthday dinner"), "Steakhaus Block House", 16_900, f_cat.clone(), &card, vec![t("anlass", "occasion").into()], None)?;
    add(today - Duration::days(1), t("Wintermantel", "Winter coat"), "Peek & Cloppenburg", 12_900, s_cat.clone(), &card, vec![], None)?;
    tx.commit()?;
    drop(conn);
    recurring::materialize_due(db, today)?;
    Ok(())
}

pub fn clear(db: &Db) -> AppResult<usize> {
    let rows: Vec<(String, String)> = get_meta(&db.conn(), "demo_rows")?
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    let mut conn = db.conn();
    let tx = conn.transaction()?;
    let mut n = 0;
    for (table, id) in &rows {
        if table == "recurring_rules" {
            n += tx.execute(
                "UPDATE transactions SET deleted = 1, updated_hlc = ?2 WHERE recurring_rule_id = ?1 AND deleted = 0",
                params![id, db.hlc.tick()],
            )?;
        }
        if table == "debts" {
            n += tx.execute("UPDATE transactions SET deleted = 1, updated_hlc = ?2 WHERE debt_id = ?1 AND deleted = 0", params![id, db.hlc.tick()])?;
        }
        if table == "goals" {
            tx.execute("UPDATE goal_allocations SET deleted = 1, updated_hlc = ?2 WHERE goal_id = ?1", params![id, db.hlc.tick()])?;
        }
        if matches!(table.as_str(), "accounts" | "categories" | "recurring_rules" | "debts" | "goals" | "budgets" | "transactions") {
            n += tx.execute(&format!("UPDATE {table} SET deleted = 1, updated_hlc = ?2 WHERE id = ?1 AND deleted = 0"), params![id, db.hlc.tick()])?;
        }
    }
    set_meta(&tx, "demo_rows", "[]")?;
    tx.commit()?;
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::insights;

    #[test]
    #[ignore]
    fn export_fixtures() {
        use crate::domain::{attachments, categories, counterparties, forecast, summary};
        let path = std::env::var("ZC_FIXTURES").expect("ZC_FIXTURES");
        let db = Db::open_in_memory().unwrap();
        let today = chrono::Local::now().date_naive();
        load(&db, today).unwrap();
        let conn = db.conn();
        let month = |offset: u32| (today.with_day(1).unwrap() + Months::new(offset)).format("%Y-%m").to_string();
        let mut f = serde_json::Map::new();
        let mut put = |k: &str, v: serde_json::Value| {
            f.insert(k.into(), v);
        };
        let j = |v: &dyn erased::Ser| v.json();
        put("list_accounts", j(&accounts::list(&conn).unwrap()));
        put("list_categories", j(&categories::list(&conn).unwrap()));
        put("list_counterparties", j(&counterparties::list(&conn).unwrap()));
        put("list_transactions", j(&transactions::list(&conn, &transactions::TransactionFilter { limit: Some(5000), ..Default::default() }).unwrap()));
        put("list_recurring", j(&recurring::list(&conn, today).unwrap()));
        put("upcoming_0", j(&recurring::occurrences(&conn, today, today).unwrap()));
        put("upcoming_14", j(&recurring::occurrences(&conn, today, today + Duration::days(14)).unwrap()));
        put("list_debts", j(&debts::list(&conn, today).unwrap()));
        put("list_goals", j(&goals::list(&conn, today).unwrap()));
        put("list_budgets", j(&budgets::list(&conn, today).unwrap()));
        for d in [30, 90, 180, 365] {
            put(&format!("forecast_{d}"), j(&forecast::forecast(&conn, "EUR", today, d).unwrap()));
        }
        for o in 0..3 {
            let m = month(o);
            let start = NaiveDate::parse_from_str(&format!("{m}-01"), "%Y-%m-%d").unwrap();
            put(&format!("month_preview_{m}"), j(&forecast::month_preview(&conn, "EUR", today, start).unwrap()));
        }
        put("monthly_series", j(&summary::monthly_series(&conn, "EUR", today, 6).unwrap()));
        let (from, to) = budgets::period_range("month", today).unwrap();
        put("period_summary", j(&summary::period(&conn, &from.to_string(), &to.to_string(), "EUR").unwrap()));
        put("insights", j(&insights::compute(&conn, "EUR", today, 3).unwrap()));
        put("list_attachments", j(&attachments::list(&db, &conn, &Default::default()).unwrap()));
        std::fs::write(path, serde_json::to_string(&f).unwrap()).unwrap();
    }

    mod erased {
        pub trait Ser {
            fn json(&self) -> serde_json::Value;
        }
        impl<T: serde::Serialize> Ser for T {
            fn json(&self) -> serde_json::Value {
                serde_json::to_value(self).unwrap()
            }
        }
    }

    #[test]
    fn loads_rich_data_and_clears_cleanly() {
        let db = Db::open_in_memory().unwrap();
        db.conn().execute("INSERT INTO meta (key, value) VALUES ('demo_rows', '[]')", []).unwrap();
        let today = NaiveDate::from_ymd_opt(2026, 10, 8).unwrap();

        let acc = accounts::list(&db.conn()).unwrap()[0].id.clone();
        let mine = transactions::create(
            &db,
            transactions::TransactionInput {
                kind: "expense".into(),
                amount_minor: 100,
                currency: None,
                occurred_on: "2026-10-01".into(),
                occurred_time: None,
                account_id: acc,
                to_account_id: None,
                category_id: None,
                counterparty: None,
                title: "Meins".into(),
                note: None,
                tags: vec![],
                debt_id: None,
                goal_id: None,
            },
        )
        .unwrap();

        load(&db, today).unwrap();
        assert!(load(&db, today).is_err(), "not twice");
        let txs = transactions::list(&db.conn(), &transactions::TransactionFilter { limit: Some(5000), ..Default::default() }).unwrap();
        assert!(txs.len() > 200, "plenty of history: {}", txs.len());
        let kinds: Vec<String> = insights::compute(&db.conn(), "EUR", today, 3).unwrap().into_iter().map(|i| i.kind).collect();
        for k in ["confirm_pending", "budget_over", "debt_overdue", "debt_due", "goal_reached", "goal_behind"] {
            assert!(kinds.iter().any(|x| x == k), "missing insight {k}: {kinds:?}");
        }

        clear(&db).unwrap();
        let left = transactions::list(&db.conn(), &transactions::TransactionFilter { limit: Some(5000), ..Default::default() }).unwrap();
        assert_eq!(left.iter().map(|t| t.id.clone()).collect::<Vec<_>>(), vec![mine.id]);
        assert_eq!(accounts::list(&db.conn()).unwrap().len(), 1);
        assert!(recurring::list(&db.conn(), today).unwrap().is_empty());
        assert!(!is_loaded(&db).unwrap());
    }
}
