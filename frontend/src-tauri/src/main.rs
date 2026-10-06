#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

const API_ADDR: &str = "127.0.0.1:38673";

struct BackendState {
    child: Mutex<Option<CommandChild>>,
    token: String,
}
#[tauri::command]
fn backend_url() -> String {
    format!("http://{API_ADDR}")
}
/// Случайный токен на один запуск: им защищено локальное API (syne-ui-api).
fn generate_token() -> String {
    let mut buf = [0u8; 32];
    getrandom::getrandom(&mut buf).expect("system random source is unavailable");
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

#[tauri::command]
fn backend_token(state: tauri::State<'_, BackendState>) -> String {
    state.token.clone()
}

const OPEN_DIR_NAME: &str = "syne-open";

/// Папка для файлов, скачанных ради «Открыть как». Чистится при каждом запуске.
fn open_dir() -> PathBuf {
    std::env::temp_dir().join(OPEN_DIR_NAME)
}

#[tauri::command]
fn open_temp_dir() -> Result<String, String> {
    let dir = open_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create the temp folder: {e}"))?;
    dir.to_str()
        .map(str::to_string)
        .ok_or_else(|| "temp folder path is not valid UTF-8".to_string())
}

/// Показывает системное окно «Открыть с помощью». Открывает только файлы из
/// нашей временной папки: интерфейс не может использовать команду, чтобы
/// запустить произвольный файл на компьютере.
#[tauri::command]
fn open_with_dialog(path: String) -> Result<(), String> {
    let dir = open_dir()
        .canonicalize()
        .map_err(|e| format!("temp folder is unavailable: {e}"))?;
    let file = PathBuf::from(&path)
        .canonicalize()
        .map_err(|e| format!("file is unavailable: {e}"))?;
    if !file.starts_with(&dir) || !file.is_file() {
        return Err("only files downloaded for opening can be opened".to_string());
    }
    spawn_open_as(Path::new(&path))
}

#[cfg(target_os = "windows")]
fn spawn_open_as(file: &Path) -> Result<(), String> {
    // Окно «Каким образом вы хотите открыть этот файл?»
    std::process::Command::new("rundll32.exe")
        .arg("shell32.dll,OpenAs_RunDLL")
        .arg(file)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("cannot show the Open with dialog: {e}"))
}

#[cfg(target_os = "macos")]
fn spawn_open_as(file: &Path) -> Result<(), String> {
    // В macOS нет такого системного окна: открываем в программе по умолчанию.
    std::process::Command::new("open")
        .arg(file)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("cannot open the file: {e}"))
}

#[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
fn spawn_open_as(file: &Path) -> Result<(), String> {
    std::process::Command::new("xdg-open")
        .arg(file)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("cannot open the file: {e}"))
}
#[tauri::command]
fn set_app_icon(app: AppHandle, icon_bytes: Vec<u8>) -> Result<(), String> {
    set_platform_app_icon(app, icon_bytes)
}
fn log_line(app: &AppHandle, line: &str) {
    eprintln!("{line}");
    if let Ok(dir) = app.path().app_log_dir() {
        let _ = std::fs::create_dir_all(&dir);
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(dir.join("launch.log"))
        {
            let _ = writeln!(f, "{line}");
        }
    }
}
fn read_first_line(path: &Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    let text = if bytes.starts_with(&[0xFF, 0xFE]) {
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        String::from_utf16_lossy(&units)
    } else if bytes.starts_with(&[0xFE, 0xFF]) {
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|c| u16::from_be_bytes([c[0], c[1]]))
            .collect();
        String::from_utf16_lossy(&units)
    } else {
        let raw = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&bytes);
        String::from_utf8_lossy(raw).into_owned()
    };
    text.lines()
        .map(|l| l.trim().trim_start_matches('\u{feff}').trim())
        .find(|l| !l.is_empty() && !l.starts_with('#'))
        .map(str::to_string)
}

fn resolve_server_addr(app: &AppHandle) -> Option<String> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            candidates.push(exe_dir.join("client-config.txt"));
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("client-config.txt"));
    }
    if cfg!(debug_assertions) {
        candidates.push(repo_root().join("client-config.txt"));
        candidates.push(repo_root().join("frontend/src-tauri/client-config.txt"));
    }
    if let Ok(app_config_dir) = app.path().app_config_dir() {
        candidates.push(app_config_dir.join("client-config.txt"));
    }

    for candidate in candidates {
        match read_first_line(&candidate) {
            Some(addr) => {
                log_line(app, &format!("server override: {} -> {addr}", candidate.display()));
                return Some(addr);
            }
            None => log_line(app, &format!("server override: not found/empty: {}", candidate.display())),
        }
    }

    log_line(app, "no client-config.txt found, backend will auto-discover the study server");
    None
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



fn spawn_backend(app: &AppHandle, token: &str) -> Result<CommandChild, String> {
    let workdir = backend_workdir(app)?;
    let workdir_str = workdir
        .to_str()
        .ok_or_else(|| "workdir contains invalid UTF-8".to_string())?
        .to_string();

    let mut args = vec![
        "--addr".to_string(),
        API_ADDR.to_string(),
        "--workdir".to_string(),
        workdir_str,
    ];

    if let Some(server_addr) = resolve_server_addr(app) {
        args.push("--server-addr".to_string());
        args.push(server_addr);
    }

    let command = app
        .shell()
        .sidecar("syne-ui-api")
        .map_err(|err| format!("failed to configure sidecar: {err}"))?
        .args(args)
        .env("SYNE_API_TOKEN", token);
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
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(BackendState {
            child: Mutex::new(None),
            token: generate_token(),
        })
        .invoke_handler(tauri::generate_handler![
            backend_url,
            backend_token,
            set_app_icon,
            open_temp_dir,
            open_with_dialog
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let _ = std::fs::remove_dir_all(open_dir());
            let token = app.state::<BackendState>().token.clone();
            let child = spawn_backend(&handle, &token)?;
            app.state::<BackendState>()
                .child
                .lock()
                .unwrap()
                .replace(child);

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}