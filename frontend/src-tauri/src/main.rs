#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{path::PathBuf, sync::Mutex};

use tauri::{AppHandle, Manager};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

const API_ADDR: &str = "127.0.0.1:38673";

struct BackendState {
    child: Mutex<Option<CommandChild>>,
}

#[tauri::command]
fn backend_url() -> String {
    format!("http://{API_ADDR}")
}

#[tauri::command]
fn set_app_icon(app: AppHandle, icon_bytes: Vec<u8>) -> Result<(), String> {
    set_platform_app_icon(app, icon_bytes)
}

#[cfg(target_os = "macos")]
fn set_platform_app_icon(app: AppHandle, icon_bytes: Vec<u8>) -> Result<(), String> {
    use objc2::{AllocAnyThread, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSImage, NSWorkspace, NSWorkspaceIconCreationOptions};
    use objc2_foundation::{NSData, NSString};
    use std::{
        sync::mpsc,
        time::{Duration, SystemTime},
    };

    let bundle_path = current_app_bundle_path();
    let (tx, rx) = mpsc::channel();
    app.run_on_main_thread(move || {
        let result = || {
            let marker = unsafe { MainThreadMarker::new_unchecked() };
            let app = NSApplication::sharedApplication(marker);
            let data = NSData::with_bytes(&icon_bytes);

            let Some(image) = NSImage::initWithData(NSImage::alloc(), &data) else {
                return Err("failed to decode selected app icon".to_string());
            };

            unsafe { app.setApplicationIconImage(Some(&image)) };

            if let Some(bundle_path) = bundle_path {
                let workspace = NSWorkspace::sharedWorkspace();
                let path = NSString::from_str(&bundle_path.to_string_lossy());
                let applied = workspace.setIcon_forFile_options(
                    Some(&image),
                    &path,
                    NSWorkspaceIconCreationOptions::empty(),
                );
                if !applied {
                    return Err(format!(
                        "failed to apply selected icon to app bundle {}",
                        bundle_path.display()
                    ));
                }

                let now = SystemTime::now();
                let _ = std::fs::File::options()
                    .append(true)
                    .open(&bundle_path)
                    .and_then(|file| file.set_modified(now));
                workspace.noteFileSystemChanged_(&path);
            }

            Ok(())
        };
        let _ = tx.send(result());
    })
    .map_err(|err| format!("failed to schedule app icon update: {err}"))?;

    rx.recv_timeout(Duration::from_secs(3))
        .map_err(|err| format!("timed out while applying app icon: {err}"))?
}

#[cfg(not(target_os = "macos"))]
fn set_platform_app_icon(_app: AppHandle, _icon_bytes: Vec<u8>) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
fn current_app_bundle_path() -> Option<PathBuf> {
    let exe_path = std::env::current_exe().ok()?;
    let macos_dir = exe_path.parent()?;
    let contents_dir = macos_dir.parent()?;
    let app_dir = contents_dir.parent()?;

    if macos_dir.file_name()? == "MacOS"
        && contents_dir.file_name()? == "Contents"
        && app_dir.extension()? == "app"
    {
        Some(app_dir.to_path_buf())
    } else {
        None
    }
}

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."))
}

fn backend_workdir(app: &AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        return Ok(repo_root());
    }

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("failed to resolve app data dir: {err}"))?;
    std::fs::create_dir_all(&dir)
        .map_err(|err| format!("failed to create app data dir {}: {err}", dir.display()))?;
    Ok(dir)
}

fn spawn_backend(app: &AppHandle) -> Result<CommandChild, String> {
    let workdir = backend_workdir(app)?;
    let command = app
        .shell()
        .sidecar("syne-ui-api")
        .map_err(|err| format!("failed to configure sidecar: {err}"))?
        .args([
            "--addr",
            API_ADDR,
            "--workdir",
            workdir
                .to_str()
                .ok_or_else(|| "workdir contains invalid UTF-8".to_string())?,
        ]);
    let (mut rx, child) = command
        .spawn()
        .map_err(|err| format!("failed to start sidecar: {err}"))?;
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Error(err) => eprintln!("syne-ui-api sidecar error: {err}"),
                CommandEvent::Terminated(payload) => {
                    eprintln!("syne-ui-api sidecar terminated: {:?}", payload.code)
                }
                _ => {}
            }
        }
    });
    Ok(child)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(BackendState {
            child: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![backend_url, set_app_icon])
        .setup(|app| {
            let state = app.state::<BackendState>();
            let child = spawn_backend(app.handle())?;
            *state.child.lock().expect("backend child lock") = Some(child);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let state = window.app_handle().state::<BackendState>();
                let child = {
                    let mut guard = state.child.lock().expect("backend child lock");
                    guard.take()
                };
                if let Some(child) = child {
                    let _ = child.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
