use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

use tauri::{Emitter, Manager};

static ALLOWED: AtomicBool = AtomicBool::new(false);
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

pub fn allowed() -> bool {
    ALLOWED.load(Ordering::SeqCst)
}

pub fn init(app: &tauri::AppHandle) {
    let _ = APP.set(app.clone());
}

#[no_mangle]
pub extern "system" fn Java_dev_zcashflow_app_MainActivity_setLocalNetworkPermission(
    _env: *mut std::ffi::c_void,
    _activity: *mut std::ffi::c_void,
    granted: u8,
) {
    let granted = granted != 0;
    let was = ALLOWED.swap(granted, Ordering::SeqCst);
    let Some(app) = APP.get() else { return };
    if was == granted {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        if let Some(core) = app.try_state::<std::sync::Arc<crate::sync::SyncCore>>() {
            if granted {
                if let Err(e) = core.start(false) {
                    eprintln!("sync: could not start after local network permission: {e}");
                }
            } else {
                core.disconnect_all();
            }
        }
        let _ = app.emit("sync-changed", ());
    });
}
