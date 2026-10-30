use serde::Serialize;
use tauri::State;

use crate::db::{get_meta, set_meta, Db, SharedDb};
use crate::domain::{
    accounts::{self, Account, AccountInput},
    categories::{self, Category, CategoryInput},
    counterparties::{self, Counterparty},
    quick::{self, QuickEntry},
    summary::{self, PeriodSummary},
    transactions::{self, Transaction, TransactionFilter, TransactionInput},
};
use crate::error::AppResult;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub device_id: String,
    pub default_currency: String,
    pub main_currency: String,
}

#[tauri::command]
pub fn app_info(db: State<SharedDb>) -> AppResult<AppInfo> {
    let conn = db.conn();
    Ok(AppInfo {
        version: env!("CARGO_PKG_VERSION").into(),
        device_id: db.device_id().into(),
        default_currency: get_meta(&conn, "default_currency")?.unwrap_or_else(|| "EUR".into()),
        main_currency: crate::domain::currency::main_currency(&conn)?,
    })
}

#[tauri::command]
pub fn set_default_currency(db: State<SharedDb>, currency: String) -> AppResult<()> {
    set_meta(&db.conn(), "default_currency", &currency.trim().to_uppercase())
}

#[tauri::command]
pub fn relabel_currency(db: State<SharedDb>, from: String, to: String) -> AppResult<crate::domain::currency::Relabeled> {
    crate::domain::currency::relabel(&db, &from, &to)
}

#[tauri::command]
pub fn list_accounts(db: State<SharedDb>) -> AppResult<Vec<Account>> {
    accounts::list(&db.conn())
}

#[tauri::command]
pub fn upsert_account(db: State<SharedDb>, input: AccountInput) -> AppResult<Account> {
    accounts::upsert(&db, input)
}

#[tauri::command]
pub fn set_account_balance(db: State<SharedDb>, id: String, balance_minor: i64, today: String) -> AppResult<Account> {
    accounts::set_balance(&db, &id, balance_minor, &today)
}

#[tauri::command]
pub fn list_categories(db: State<SharedDb>) -> AppResult<Vec<Category>> {
    categories::list(&db.conn())
}

#[tauri::command]
pub fn upsert_category(db: State<SharedDb>, input: CategoryInput) -> AppResult<Category> {
    categories::upsert(&db, input)
}

#[tauri::command]
pub fn move_category(db: State<SharedDb>, id: String, parent_id: Option<String>) -> AppResult<Category> {
    categories::move_to(&db, &id, parent_id.as_deref().filter(|p| !p.is_empty()))
}

#[tauri::command]
pub fn place_category(db: State<SharedDb>, id: String, parent_id: Option<String>, order: Vec<String>) -> AppResult<Category> {
    categories::place(&db, &id, parent_id.as_deref().filter(|p| !p.is_empty()), &order)
}

#[tauri::command]
pub fn list_counterparties(db: State<SharedDb>) -> AppResult<Vec<Counterparty>> {
    counterparties::list(&db.conn())
}

#[tauri::command]
pub fn list_transactions(db: State<SharedDb>, filter: Option<TransactionFilter>) -> AppResult<Vec<Transaction>> {
    transactions::list(&db.conn(), &filter.unwrap_or_default())
}

#[tauri::command]
pub fn recent_titles(db: State<SharedDb>, kind: Option<String>, limit: Option<u32>) -> AppResult<Vec<String>> {
    transactions::recent_titles(&db.conn(), kind.as_deref(), limit.unwrap_or(300))
}

#[tauri::command]
pub fn transaction_totals(db: State<SharedDb>, filter: Option<TransactionFilter>) -> AppResult<transactions::Totals> {
    transactions::totals(&db.conn(), &filter.unwrap_or_default(), today())
}

#[tauri::command]
pub fn category_totals(db: State<SharedDb>, filter: Option<TransactionFilter>) -> AppResult<Vec<transactions::CategorySum>> {
    transactions::category_totals(&db.conn(), &filter.unwrap_or_default())
}

#[tauri::command]
pub fn create_transaction(db: State<SharedDb>, input: TransactionInput) -> AppResult<Transaction> {
    transactions::create(&db, input)
}

#[tauri::command]
pub fn update_transaction(db: State<SharedDb>, id: String, input: TransactionInput) -> AppResult<Transaction> {
    transactions::update(&db, &id, input)
}

#[tauri::command]
pub fn delete_transaction(db: State<SharedDb>, id: String) -> AppResult<()> {
    transactions::delete(&db, &id)
}

#[tauri::command]
pub fn parse_quick_entry(text: String) -> QuickEntry {
    quick::parse(&text, chrono::Local::now().date_naive())
}

#[tauri::command]
pub fn period_summary(db: State<SharedDb>, from: String, to: String, currency: String) -> AppResult<PeriodSummary> {
    summary::period(&db.conn(), &from, &to, &currency)
}

use crate::domain::{
    budgets::{self as budgets_dom, Budget, BudgetInput},
    debts::{self as debts_dom, Debt, DebtInput},
    export,
    forecast::{self as forecast_dom, Forecast, MonthPreview},
    goals::{self as goals_dom, Allocation, Goal, GoalInput},
    insights::{self as insights_dom, Insight},
    recurring::{self as recurring_dom, Occurrence, RecurringInput, RecurringRule},
    summary::MonthTotals,
};
use crate::domain::import::{ImportOptions, ImportPreview, ImportResult};
use crate::error::AppError;

fn today() -> chrono::NaiveDate {
    chrono::Local::now().date_naive()
}

fn default_currency(db: &Db) -> AppResult<String> {
    crate::domain::currency::main_currency(&db.conn())
}

#[tauri::command]
pub fn get_settings(db: State<SharedDb>) -> AppResult<std::collections::HashMap<String, String>> {
    let conn = db.conn();
    let mut out = std::collections::HashMap::new();
    for key in SETTINGS {
        if let Some(v) = get_meta(&conn, key)? {
            out.insert((*key).to_owned(), v);
        }
    }
    Ok(out)
}

const SETTINGS: &[&str] = &[
    "remind_days",
    "notifications",
    "onboarded",
    "ocr_engine",
    "llm_enabled",
    "llm_url",
    "llm_model",
    "llm_vision",
    "device_name",
    "discoverable",
    "daily_done",
    "daily_reminder",
    crate::domain::budgets::PLAN_SETTING,
];

#[tauri::command]
pub fn set_setting(app: tauri::AppHandle, db: State<SharedDb>, key: String, value: String) -> AppResult<()> {
    if !SETTINGS.contains(&key.as_str()) {
        return Err(AppError::Invalid(format!("unknown setting {key:?}")));
    }
    set_meta(&db.conn(), &key, &value)?;
    if matches!(key.as_str(), "device_name" | "discoverable") {
        if let Some(core) = app.try_state::<SyncHandle>() {
            core.refresh_advertisement();
        }
    }
    Ok(())
}

#[tauri::command]
pub fn delete_account(db: State<SharedDb>, id: String) -> AppResult<()> {
    accounts::delete(&db, &id)
}

#[tauri::command]
pub fn delete_category(db: State<SharedDb>, id: String) -> AppResult<()> {
    categories::delete(&db, &id)
}

#[tauri::command]
pub fn list_recurring(db: State<SharedDb>) -> AppResult<Vec<RecurringRule>> {
    recurring_dom::list(&db.conn(), today())
}

#[tauri::command]
pub fn upsert_recurring(db: State<SharedDb>, input: RecurringInput) -> AppResult<RecurringRule> {
    recurring_dom::upsert(&db, input, today())
}

#[tauri::command]
pub fn delete_recurring(db: State<SharedDb>, id: String) -> AppResult<()> {
    recurring_dom::delete(&db, &id)
}

#[tauri::command]
pub fn confirm_occurrence(db: State<SharedDb>, rule_id: String, date: String, amount_minor: Option<i64>) -> AppResult<String> {
    recurring_dom::confirm(&db, &rule_id, &date, amount_minor, today())
}

#[tauri::command]
pub fn skip_occurrence(db: State<SharedDb>, rule_id: String, date: String) -> AppResult<()> {
    recurring_dom::skip(&db, &rule_id, &date)
}

#[tauri::command]
pub fn upcoming(db: State<SharedDb>, days: i64) -> AppResult<Vec<Occurrence>> {
    let t = today();
    recurring_dom::occurrences(&db.conn(), t, t + chrono::Duration::days(days.clamp(0, 3 * 366)))
}

#[tauri::command]
pub fn run_scheduler(db: State<SharedDb>) -> AppResult<usize> {
    recurring_dom::materialize_due(&db, today())
}

#[tauri::command]
pub fn list_debts(db: State<SharedDb>) -> AppResult<Vec<Debt>> {
    debts_dom::list(&db.conn(), today())
}

#[tauri::command]
pub fn upsert_debt(db: State<SharedDb>, input: DebtInput) -> AppResult<Debt> {
    debts_dom::upsert(&db, input, today())
}

#[tauri::command]
pub fn delete_debt(db: State<SharedDb>, id: String) -> AppResult<()> {
    debts_dom::delete(&db, &id)
}

#[tauri::command]
pub fn record_debt_payment(
    db: State<SharedDb>,
    debt_id: String,
    amount_minor: i64,
    date: String,
    account_id: String,
) -> AppResult<Debt> {
    debts_dom::record_payment(&db, &debt_id, amount_minor, &date, &account_id, today())
}

#[tauri::command]
pub fn list_goals(db: State<SharedDb>) -> AppResult<Vec<Goal>> {
    goals_dom::list(&db.conn(), today())
}

#[tauri::command]
pub fn upsert_goal(db: State<SharedDb>, input: GoalInput) -> AppResult<Goal> {
    goals_dom::upsert(&db, input, today())
}

#[tauri::command]
pub fn delete_goal(db: State<SharedDb>, id: String) -> AppResult<()> {
    goals_dom::delete(&db, &id)
}

#[tauri::command]
pub fn allocate_goal(db: State<SharedDb>, goal_id: String, amount_minor: i64, date: String, note: Option<String>) -> AppResult<Goal> {
    goals_dom::allocate(&db, &goal_id, amount_minor, &date, note, today())
}

#[tauri::command]
pub fn goal_allocations(db: State<SharedDb>, goal_id: String) -> AppResult<Vec<Allocation>> {
    goals_dom::allocations(&db.conn(), &goal_id)
}

#[tauri::command]
pub fn list_budgets(db: State<SharedDb>) -> AppResult<Vec<Budget>> {
    budgets_dom::list(&db.conn(), today())
}

#[tauri::command]
pub fn upsert_budget(db: State<SharedDb>, input: BudgetInput) -> AppResult<Budget> {
    budgets_dom::upsert(&db, input, today())
}

#[tauri::command]
pub fn delete_budget(db: State<SharedDb>, id: String) -> AppResult<()> {
    budgets_dom::delete(&db, &id)
}

#[tauri::command]
pub fn forecast(db: State<SharedDb>, days: i64) -> AppResult<Forecast> {
    let currency = default_currency(&db)?;
    forecast_dom::forecast(&db.conn(), &currency, today(), days)
}

#[tauri::command]
pub fn month_preview(db: State<SharedDb>, month: String) -> AppResult<MonthPreview> {
    let start = chrono::NaiveDate::parse_from_str(&format!("{month}-01"), "%Y-%m-%d")
        .map_err(|_| AppError::Invalid(format!("invalid month {month:?}")))?;
    let currency = default_currency(&db)?;
    forecast_dom::month_preview(&db.conn(), &currency, today(), start)
}

#[tauri::command]
pub fn monthly_series(db: State<SharedDb>, months: u32) -> AppResult<Vec<MonthTotals>> {
    let currency = default_currency(&db)?;
    summary::monthly_series(&db.conn(), &currency, today(), months.clamp(1, 60))
}

#[tauri::command]
pub fn insights(db: State<SharedDb>) -> AppResult<Vec<Insight>> {
    let currency = default_currency(&db)?;
    let conn = db.conn();
    let remind_days = get_meta(&conn, "remind_days")?.and_then(|v| v.parse().ok()).unwrap_or(3);
    insights_dom::compute(&conn, &currency, today(), remind_days)
}

fn create_target(app: &tauri::AppHandle, path: &str) -> AppResult<std::fs::File> {
    use tauri_plugin_fs::FsExt;
    let target: tauri_plugin_fs::FilePath = path.parse().map_err(|_| AppError::Invalid(format!("invalid path {path:?}")))?;
    let mut opts = tauri_plugin_fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    Ok(app.fs().open(target, opts)?)
}

fn write_target(app: &tauri::AppHandle, path: &str, bytes: &[u8]) -> AppResult<()> {
    use std::io::Write;
    let mut file = create_target(app, path)?;
    file.write_all(bytes)?;
    file.flush()?;
    Ok(())
}

#[tauri::command]
pub fn export_csv(app: tauri::AppHandle, db: State<SharedDb>, path: String) -> AppResult<usize> {
    let opts = export::ExportOptions {
        datasets: vec!["transactions".into()],
        delimiter: ",".into(),
        decimal_comma: false,
        labels: Default::default(),
        filter: None,
        expense_minus: true,
        split_categories: false,
    };
    let out = export::export(&db.conn(), &opts, today())?;
    write_target(&app, &path, &out.bytes)?;
    Ok(out.files)
}

#[tauri::command]
pub async fn export_data(app: tauri::AppHandle, path: String, options: export::ExportOptions) -> AppResult<usize> {
    blocking(move || {
        let db = app.state::<SharedDb>();
        let out = export::export(&db.conn(), &options, today())?;
        write_target(&app, &path, &out.bytes)?;
        Ok(out.files)
    })
    .await
}

#[tauri::command]
pub fn import_template(app: tauri::AppHandle, path: String, delimiter: String) -> AppResult<()> {
    write_target(&app, &path, &export::template(&delimiter))
}

#[tauri::command]
pub async fn import_preview(app: tauri::AppHandle, text: String, options: ImportOptions) -> AppResult<ImportPreview> {
    blocking(move || {
        let db = app.state::<SharedDb>();
        let conn = db.conn();
        crate::domain::import::preview(&conn, &text, &options)
    })
    .await
}

#[tauri::command]
pub async fn import_commit(app: tauri::AppHandle, text: String, options: ImportOptions) -> AppResult<ImportResult> {
    blocking(move || {
        let db = app.state::<SharedDb>();
        crate::domain::import::commit(&db, &text, &options, today())
    })
    .await
}

#[tauri::command]
pub fn backup_database(app: tauri::AppHandle, db: State<SharedDb>, path: String) -> AppResult<()> {
    let plain = !path.contains("://");
    if plain {
        return export::backup(&db.conn(), std::path::Path::new(&path));
    }
    let tmp = std::env::temp_dir().join(format!("zc-backup-{}.db", uuid::Uuid::now_v7().simple()));
    export::backup(&db.conn(), &tmp)?;
    let bytes = std::fs::read(&tmp);
    let _ = std::fs::remove_file(&tmp);
    write_target(&app, &path, &bytes?)
}

use crate::domain::attachments::{self as attachments_dom, Attachment, AttachmentFilter};
use tauri::Manager;

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn body_bytes(body: &tauri::ipc::InvokeBody) -> AppResult<Vec<u8>> {
    use base64::Engine;
    use serde_json::Value;
    let bytes = match body {
        tauri::ipc::InvokeBody::Raw(bytes) => Some(bytes.clone()),
        tauri::ipc::InvokeBody::Json(Value::Object(m)) => m
            .get("b64")
            .and_then(Value::as_str)
            .and_then(|s| base64::engine::general_purpose::STANDARD.decode(s).ok()),
        tauri::ipc::InvokeBody::Json(Value::Array(a)) => a
            .iter()
            .map(|v| v.as_u64().and_then(|n| u8::try_from(n).ok()))
            .collect::<Option<Vec<u8>>>(),
        _ => None,
    };
    bytes.filter(|b| !b.is_empty()).ok_or_else(|| AppError::Invalid("expected image bytes".into()))
}

#[tauri::command]
pub async fn import_receipt(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> AppResult<Attachment> {
    let bytes = body_bytes(request.body())?;
    let header = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).map(percent_decode);
    let name = header("x-file-name");
    let tx = header("x-transaction-id").filter(|s| !s.is_empty());
    let res = tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<SharedDb>();
        attachments_dom::import(&db, &bytes, name, tx, today())
    })
    .await
    .map_err(|e| AppError::Invalid(e.to_string()))?;
    res
}

#[tauri::command]
pub fn list_attachments(db: State<SharedDb>, filter: Option<AttachmentFilter>) -> AppResult<Vec<Attachment>> {
    attachments_dom::list(&db, &db.conn(), &filter.unwrap_or_default())
}

#[tauri::command]
pub fn link_attachment(db: State<SharedDb>, id: String, transaction_id: Option<String>) -> AppResult<Attachment> {
    attachments_dom::link(&db, &id, transaction_id.as_deref())
}

#[tauri::command]
pub fn book_receipt(db: State<SharedDb>, id: String, input: attachments_dom::BookReceipt) -> AppResult<Vec<String>> {
    attachments_dom::book(&db, &id, input)
}

#[tauri::command]
pub fn delete_attachment(db: State<SharedDb>, id: String) -> AppResult<()> {
    attachments_dom::delete(&db, &id)
}

#[tauri::command]
pub async fn reprocess_attachment(app: tauri::AppHandle, id: String) -> AppResult<Attachment> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<SharedDb>();
        attachments_dom::reprocess(&db, &id, today())
    })
    .await
    .map_err(|e| AppError::Invalid(e.to_string()))?
}

#[tauri::command]
pub fn attachment_image(db: State<SharedDb>, id: String, thumb: bool) -> AppResult<tauri::ipc::Response> {
    let (bytes, _mime) = attachments_dom::image_bytes(&db, &id, thumb)?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub fn ocr_status() -> crate::ocr::OcrStatus {
    crate::ocr::status()
}

#[tauri::command]
pub async fn llm_models(url: String) -> AppResult<Vec<String>> {
    tauri::async_runtime::spawn_blocking(move || crate::ocr::llm::list_models(&url))
        .await
        .map_err(|e| AppError::Invalid(e.to_string()))?
}

#[tauri::command]
pub fn suggest_category(db: State<SharedDb>, name: String) -> AppResult<Option<String>> {
    transactions::suggest_category(&db.conn(), &name)
}

use crate::sync::{SyncCore, SyncStatus};
type SyncHandle = std::sync::Arc<SyncCore>;

fn core(app: &tauri::AppHandle) -> AppResult<SyncHandle> {
    app.try_state::<SyncHandle>()
        .map(|s| s.inner().clone())
        .ok_or_else(|| AppError::Invalid("sync unavailable".into()))
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> AppResult<T> + Send + 'static) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| AppError::Invalid(e.to_string()))?
}

#[tauri::command]
pub fn sync_status(app: tauri::AppHandle) -> AppResult<SyncStatus> {
    core(&app)?.status()
}

#[tauri::command]
pub fn sync_start_pairing(app: tauri::AppHandle) -> AppResult<String> {
    Ok(core(&app)?.start_pairing())
}

#[tauri::command]
pub fn sync_set_pairing_role(app: tauri::AppHandle, role: String) -> AppResult<()> {
    core(&app)?.set_pairing_role(&role)
}

#[tauri::command]
pub fn sync_stop_pairing(app: tauri::AppHandle) -> AppResult<()> {
    core(&app)?.stop_pairing();
    Ok(())
}

#[tauri::command]
pub async fn sync_pair(app: tauri::AppHandle, addr: String, code: String) -> AppResult<String> {
    let c = core(&app)?;
    blocking(move || c.pair_with(&addr, &code)).await
}

#[tauri::command]
pub async fn sync_request_pairing(app: tauri::AppHandle, addr: String) -> AppResult<String> {
    let c = core(&app)?;
    blocking(move || c.request_pairing(&addr)).await
}

#[tauri::command]
pub fn sync_now(app: tauri::AppHandle) -> AppResult<()> {
    core(&app)?.sync_now();
    Ok(())
}

#[tauri::command]
pub async fn sync_scan(app: tauri::AppHandle) -> AppResult<usize> {
    let c = core(&app)?;
    blocking(move || Ok(c.scan_network())).await
}

#[tauri::command]
pub async fn sync_connect(app: tauri::AppHandle, addr: String) -> AppResult<()> {
    let c = core(&app)?;
    blocking(move || c.connect(crate::sync::resolve(&addr)?)).await
}

#[tauri::command]
pub fn sync_unpair(app: tauri::AppHandle, public_key: String) -> AppResult<()> {
    core(&app)?.unpair(&public_key)
}

#[tauri::command]
pub fn sync_set_role(app: tauri::AppHandle, public_key: String, role: String) -> AppResult<()> {
    core(&app)?.set_role(&public_key, &role)
}

#[tauri::command]
pub fn sync_set_enabled(app: tauri::AppHandle, db: State<SharedDb>, enabled: bool) -> AppResult<()> {
    set_meta(&db.conn(), "sync_enabled", if enabled { "1" } else { "0" })?;
    let c = core(&app)?;
    if !enabled {
        c.disconnect_all();
    }
    c.refresh_advertisement();
    Ok(())
}

#[tauri::command]
pub fn demo_loaded(db: State<SharedDb>) -> AppResult<bool> {
    crate::domain::demo::is_loaded(&db)
}

#[tauri::command]
pub async fn load_demo_data(app: tauri::AppHandle, lang: Option<String>) -> AppResult<()> {
    blocking(move || {
        let db = app.state::<SharedDb>();
        crate::domain::demo::load_in(&db, today(), lang.as_deref().unwrap_or("de"))
    })
    .await
}

#[tauri::command]
pub fn clear_demo_data(db: State<SharedDb>) -> AppResult<usize> {
    crate::domain::demo::clear(&db)
}

#[tauri::command]
pub fn reset_all_data(app: tauri::AppHandle, db: State<SharedDb>) -> AppResult<()> {
    if let Some(core) = app.try_state::<SyncHandle>() {
        core.disconnect_all();
    }
    db.wipe_everything()?;
    app.restart();
}
