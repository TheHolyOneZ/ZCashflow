mod clock;
mod commands;
mod db;
mod domain;
mod error;
mod ocr;
mod sync;

use std::path::PathBuf;

use tauri::{Emitter, Manager};

fn data_dir(app: &tauri::App) -> PathBuf {
    std::env::var_os("ZC_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| app.path().app_data_dir().expect("no app data dir"))
}

struct TauriHost(tauri::AppHandle);

impl sync::Host for TauriHost {
    fn emit(&self, event: &str) {
        let _ = self.0.emit(event, ());
    }
}

fn spawn_scheduler(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        let db = app.state::<db::SharedDb>();
        match domain::recurring::materialize_due(&db, chrono::Local::now().date_naive()) {
            Ok(0) => {}
            Ok(n) => {
                let _ = app.emit("ledger-changed", n);
            }
            Err(e) => eprintln!("scheduler: {e}"),
        }
        std::thread::sleep(std::time::Duration::from_secs(60));
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = if std::env::var_os("ZC_DATA_DIR").is_none() {
        builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
    } else {
        builder
    };
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());
    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let db = db::Db::open(&data_dir(app).join("zcashflow.db"))?;

            let models = app
                .path()
                .resolve("ocr", tauri::path::BaseDirectory::Resource)
                .ok()
                .filter(|p| p.join("text-detection.rten").exists())
                .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/ocr"));
            ocr::set_model_dir(models);
            let db = std::sync::Arc::new(db);
            app.manage(db.clone());
            match sync::SyncCore::new(db, std::sync::Arc::new(TauriHost(app.handle().clone()))) {
                Ok(core) => {
                    if let Err(e) = core.start(false) {
                        eprintln!("sync: could not start: {e}");
                    }
                    app.manage(core);
                }
                Err(e) => eprintln!("sync: {e}"),
            }
            spawn_scheduler(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::set_default_currency,
            commands::relabel_currency,
            commands::list_accounts,
            commands::upsert_account,
            commands::set_account_balance,
            commands::list_categories,
            commands::upsert_category,
            commands::move_category,
            commands::list_counterparties,
            commands::list_transactions,
            commands::transaction_totals,
            commands::recent_titles,
            commands::create_transaction,
            commands::update_transaction,
            commands::delete_transaction,
            commands::parse_quick_entry,
            commands::period_summary,
            commands::get_settings,
            commands::set_setting,
            commands::delete_account,
            commands::delete_category,
            commands::list_recurring,
            commands::upsert_recurring,
            commands::delete_recurring,
            commands::confirm_occurrence,
            commands::skip_occurrence,
            commands::upcoming,
            commands::run_scheduler,
            commands::list_debts,
            commands::upsert_debt,
            commands::delete_debt,
            commands::record_debt_payment,
            commands::list_goals,
            commands::upsert_goal,
            commands::delete_goal,
            commands::allocate_goal,
            commands::goal_allocations,
            commands::list_budgets,
            commands::upsert_budget,
            commands::delete_budget,
            commands::forecast,
            commands::month_preview,
            commands::monthly_series,
            commands::insights,
            commands::export_csv,
            commands::export_data,
            commands::import_template,
            commands::import_preview,
            commands::import_commit,
            commands::backup_database,
            commands::import_receipt,
            commands::list_attachments,
            commands::link_attachment,
            commands::book_receipt,
            commands::delete_attachment,
            commands::reprocess_attachment,
            commands::attachment_image,
            commands::ocr_status,
            commands::llm_models,
            commands::suggest_category,
            commands::sync_status,
            commands::sync_start_pairing,
            commands::sync_stop_pairing,
            commands::sync_pair,
            commands::sync_request_pairing,
            commands::sync_now,
            commands::sync_scan,
            commands::sync_connect,
            commands::sync_unpair,
            commands::sync_set_role,
            commands::sync_set_enabled,
            commands::demo_loaded,
            commands::load_demo_data,
            commands::clear_demo_data,
            commands::reset_all_data,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
