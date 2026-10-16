#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager, RunEvent};
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

fn workspace_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let desktop = app
        .path()
        .desktop_dir()
        .map_err(|e| format!("cannot locate Desktop: {e}"))?;
    let path = desktop.join("workspace");
    std::fs::create_dir_all(&path).map_err(|e| format!("cannot create workspace: {e}"))?;
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("cannot resolve workspace: {e}"))?;
    let desktop = desktop
        .canonicalize()
        .map_err(|e| format!("cannot resolve Desktop: {e}"))?;
    if !canonical.starts_with(&desktop) || canonical.parent() != Some(desktop.as_path()) {
        return Err("workspace must be a direct child of Desktop".into());
    }
    Ok(canonical)
}

#[tauri::command]
fn get_workspace_dir(app: AppHandle) -> Result<String, String> {
    workspace_dir(&app)?
        .to_str()
        .map(str::to_owned)
        .ok_or_else(|| "workspace path is not valid UTF-8".into())
}

fn checked_workspace_relative(relative: &str) -> Result<PathBuf, String> {
    let rel = Path::new(relative);
    if rel.is_absolute()
        || rel
            .components()
            .any(|c| !matches!(c, std::path::Component::Normal(_)))
    {
        return Err("invalid workspace relative path".into());
    }
    Ok(rel.to_path_buf())
}

#[tauri::command]
fn workspace_subdir(app: AppHandle, relative: String) -> Result<String, String> {
    let root = workspace_dir(&app)?;
    let rel = checked_workspace_relative(&relative)?;
    let mut target = root.clone();
    for component in rel.components() {
        let std::path::Component::Normal(name) = component else {
            return Err("invalid workspace relative path".into());
        };
        target.push(name);
        match std::fs::symlink_metadata(&target) {
            Ok(meta) if meta.file_type().is_symlink() || !meta.is_dir() => {
                return Err("workspace path contains a symlink or non-folder".into());
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                std::fs::create_dir(&target)
                    .map_err(|e| format!("cannot create workspace folder: {e}"))?;
            }
            Err(error) => return Err(format!("cannot inspect workspace path: {error}")),
        }
    }
    let canonical = target
        .canonicalize()
        .map_err(|e| format!("cannot resolve workspace folder: {e}"))?;
    if !canonical.starts_with(&root) {
        return Err("workspace path escapes its root".into());
    }
    canonical
        .to_str()
        .map(str::to_owned)
        .ok_or_else(|| "workspace path is not valid UTF-8".into())
}

#[cfg(test)]
mod workspace_tests {
    use super::{checked_workspace_file, checked_workspace_relative};
    use std::{fs, path::PathBuf};

    #[test]
    fn accepts_nested_unicode_relative_paths() {
        assert!(checked_workspace_relative("Документы/проект/file.txt").is_ok());
    }

    #[test]
    fn rejects_parent_and_absolute_paths() {
        assert!(checked_workspace_relative("../outside.txt").is_err());
        assert!(checked_workspace_relative("/tmp/outside.txt").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinks_inside_workspace() {
        use std::os::unix::fs::symlink;
        let root = std::env::temp_dir().join(format!("syne-workspace-test-{}", std::process::id()));
        let outside =
            std::env::temp_dir().join(format!("syne-workspace-outside-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_file(&outside);
        fs::create_dir_all(&root).unwrap();
        fs::write(&outside, b"test").unwrap();
        symlink(&outside, root.join("link.txt")).unwrap();
        assert!(checked_workspace_file(&root, "link.txt").is_err());
        fs::remove_dir_all(PathBuf::from(root)).unwrap();
        fs::remove_file(outside).unwrap();
    }
}

fn checked_workspace_file(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let rel = checked_workspace_relative(relative)?;
    let mut path = root.to_path_buf();
    let components: Vec<_> = rel.components().collect();
    for (index, component) in components.iter().enumerate() {
        let std::path::Component::Normal(name) = component else {
            return Err("invalid workspace relative path".into());
        };
        path.push(name);
        let meta = std::fs::symlink_metadata(&path)
            .map_err(|e| format!("cannot inspect workspace file: {e}"))?;
        if meta.file_type().is_symlink() {
            return Err("workspace file path contains a symlink".into());
        }
        if index + 1 == components.len() {
            if !meta.is_file() {
                return Err("workspace path is not a regular file".into());
            }
        } else if !meta.is_dir() {
            return Err("workspace file parent is not a folder".into());
        }
    }
    Ok(path)
}

#[tauri::command]
fn workspace_file_path(app: AppHandle, relative: String) -> Result<String, String> {
    let root = workspace_dir(&app)?;
    let file = checked_workspace_file(&root, &relative)?;
    file.to_str()
        .map(str::to_owned)
        .ok_or_else(|| "workspace path is not valid UTF-8".into())
}

#[derive(Default, Serialize, Deserialize)]
struct WorkspaceManifest {
    #[serde(default)]
    files: BTreeMap<String, WorkspaceFileState>,
}

#[derive(Serialize, Deserialize)]
struct WorkspaceFileState {
    digest: String,
    target_path: String,
    base_mod_time: i64,
}

#[derive(Serialize)]
struct WorkspaceChange {
    path: String,
    status: String,
    bytes: u64,
    digest: String,
    target_path: String,
    base_mod_time: i64,
}

#[derive(Serialize)]
struct WorkspaceDiff {
    changes: Vec<WorkspaceChange>,
}

fn workspace_manifest_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("cannot locate app data: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create app data: {e}"))?;
    Ok(dir.join("workspace-manifest.json"))
}

fn read_workspace_manifest(app: &AppHandle) -> Result<WorkspaceManifest, String> {
    let path = workspace_manifest_path(app)?;
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|e| format!("workspace manifest is invalid: {e}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(WorkspaceManifest::default())
        }
        Err(error) => Err(format!("cannot read workspace manifest: {error}")),
    }
}

fn write_workspace_manifest(app: &AppHandle, manifest: &WorkspaceManifest) -> Result<(), String> {
    let path = workspace_manifest_path(app)?;
    let temp = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec(manifest).map_err(|e| e.to_string())?;
    std::fs::write(&temp, bytes).map_err(|e| format!("cannot write workspace manifest: {e}"))?;
    #[cfg(not(target_os = "windows"))]
    std::fs::rename(&temp, &path).map_err(|e| format!("cannot save workspace manifest: {e}"))?;
    #[cfg(target_os = "windows")]
    {
        let backup = path.with_extension("json.bak");
        if backup.exists() {
            std::fs::remove_file(&backup)
                .map_err(|e| format!("cannot replace workspace manifest: {e}"))?;
        }
        let had_old = path.exists();
        if had_old {
            std::fs::rename(&path, &backup)
                .map_err(|e| format!("cannot stage workspace manifest: {e}"))?;
        }
        if let Err(error) = std::fs::rename(&temp, &path) {
            if had_old {
                let _ = std::fs::rename(&backup, &path);
            }
            return Err(format!("cannot save workspace manifest: {error}"));
        }
        if had_old {
            let _ = std::fs::remove_file(backup);
        }
    }
    Ok(())
}

fn workspace_file_digest(path: &Path) -> Result<String, String> {
    let mut file =
        std::fs::File::open(path).map_err(|e| format!("cannot open workspace file: {e}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|e| format!("cannot read workspace file: {e}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn scan_workspace(
    root: &Path,
    dir: &Path,
    current: &mut BTreeMap<String, (u64, String)>,
) -> Result<(), String> {
    for item in std::fs::read_dir(dir).map_err(|e| format!("cannot scan workspace: {e}"))? {
        let item = item.map_err(|e| e.to_string())?;
        let name = item.file_name().to_string_lossy().to_lowercase();
        if matches!(
            name.as_str(),
            ".ds_store"
                | ".appledouble"
                | "__macosx"
                | "thumbs.db"
                | "desktop.ini"
                | ".spotlight-v100"
                | ".trashes"
                | ".fseventsd"
                | ".temporaryitems"
                | ".documentrevisions-v100"
        ) || name.starts_with("._")
        {
            continue;
        }
        let path = item.path();
        let kind = item.file_type().map_err(|e| e.to_string())?;
        if kind.is_symlink() {
            continue;
        }
        if kind.is_dir() {
            scan_workspace(root, &path, current)?;
        } else if kind.is_file() {
            let relative = path
                .strip_prefix(root)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            let size = item.metadata().map_err(|e| e.to_string())?.len();
            current.insert(relative, (size, workspace_file_digest(&path)?));
        }
    }
    Ok(())
}

#[tauri::command]
fn record_workspace_file(
    app: AppHandle,
    path: String,
    target_path: String,
    base_mod_time: i64,
) -> Result<(), String> {
    let root = workspace_dir(&app)?;
    let file = PathBuf::from(path)
        .canonicalize()
        .map_err(|e| format!("cannot resolve downloaded file: {e}"))?;
    if !file.starts_with(&root) || !file.is_file() {
        return Err("downloaded file is outside workspace".into());
    }
    let relative = file
        .strip_prefix(&root)
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    let mut manifest = read_workspace_manifest(&app)?;
    manifest.files.insert(
        relative,
        WorkspaceFileState {
            digest: workspace_file_digest(&file)?,
            target_path,
            base_mod_time,
        },
    );
    write_workspace_manifest(&app, &manifest)
}

#[tauri::command]
fn workspace_diff(app: AppHandle) -> Result<WorkspaceDiff, String> {
    let root = workspace_dir(&app)?;
    let mut current = BTreeMap::new();
    scan_workspace(&root, &root, &mut current)?;
    let manifest = read_workspace_manifest(&app)?;
    let mut changes = Vec::new();
    for (path, (bytes, digest)) in current {
        let state = manifest.files.get(&path);
        let status = match state {
            None => "Новый",
            Some(previous) if previous.digest != digest => "Изменён",
            Some(_) => continue,
        };
        let (target_path, base_mod_time) = state
            .map(|s| (s.target_path.clone(), s.base_mod_time))
            .unwrap_or_else(|| (path.clone(), 0));
        changes.push(WorkspaceChange {
            path,
            status: status.into(),
            bytes,
            digest,
            target_path,
            base_mod_time,
        });
    }
    for path in manifest.files.keys() {
        let rel = match checked_workspace_relative(path) {
            Ok(rel) => rel,
            Err(_) => continue,
        };
        if !root.join(rel).exists() {
            changes.push(WorkspaceChange {
                path: path.clone(),
                status: "Удалён локально (сервер не затронут)".into(),
                bytes: 0,
                digest: String::new(),
                target_path: String::new(),
                base_mod_time: 0,
            });
        }
    }
    Ok(WorkspaceDiff { changes })
}

#[tauri::command]
fn mark_workspace_uploaded(
    app: AppHandle,
    relative: String,
    digest: String,
    target_path: String,
    base_mod_time: i64,
) -> Result<(), String> {
    let root = workspace_dir(&app)?;
    let file = checked_workspace_file(&root, &relative)?;
    let current = workspace_file_digest(&file)?;
    if current != digest {
        return Err("workspace file changed while uploading".into());
    }
    let mut manifest = read_workspace_manifest(&app)?;
    manifest.files.insert(
        relative,
        WorkspaceFileState {
            digest,
            target_path,
            base_mod_time,
        },
    );
    write_workspace_manifest(&app, &manifest)
}

#[tauri::command]
fn open_workspace(app: AppHandle, vscode: bool) -> Result<(), String> {
    let path = workspace_dir(&app)?;
    #[cfg(target_os = "windows")]
    let (program, args): (&str, Vec<String>) = if vscode {
        ("code", vec![path.to_string_lossy().into_owned()])
    } else {
        ("explorer.exe", vec![path.to_string_lossy().into_owned()])
    };
    #[cfg(target_os = "macos")]
    let (program, args): (&str, Vec<String>) = if vscode {
        ("code", vec![path.to_string_lossy().into_owned()])
    } else {
        ("open", vec![path.to_string_lossy().into_owned()])
    };
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let (program, args): (&str, Vec<String>) = if vscode {
        ("code", vec![path.to_string_lossy().into_owned()])
    } else {
        ("xdg-open", vec![path.to_string_lossy().into_owned()])
    };
    std::process::Command::new(program)
        .args(args)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("cannot open workspace: {e}"))
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
                log_line(
                    app,
                    &format!("server override: {} -> {addr}", candidate.display()),
                );
                return Some(addr);
            }
            None => log_line(
                app,
                &format!("server override: not found/empty: {}", candidate.display()),
            ),
        }
    }

    log_line(
        app,
        "no client-config.txt found, backend will auto-discover the study server",
    );
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
        "--exit-on-stdin-close".to_string(),
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
                CommandEvent::Stdout(line) => {
                    println!("[sidecar] {}", String::from_utf8_lossy(&line).trim_end())
                }
                CommandEvent::Stderr(line) => {
                    eprintln!("[sidecar] {}", String::from_utf8_lossy(&line).trim_end())
                }
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
    let app = tauri::Builder::default()
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
            open_with_dialog,
            get_workspace_dir,
            workspace_subdir,
            workspace_file_path,
            record_workspace_file,
            workspace_diff,
            mark_workspace_uploaded,
            open_workspace
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
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            // sidecar не должен пережить приложение: его токен действует один запуск
            if let Some(child) = app_handle
                .state::<BackendState>()
                .child
                .lock()
                .unwrap()
                .take()
            {
                let _ = child.kill();
            }
        }
    });
}
