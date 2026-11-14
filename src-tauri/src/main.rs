// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod desktop_bootstrap;
mod restart_policy;
mod rotating_log;
mod workspace_selection;

use desktop_bootstrap::{DesktopBootstrap, DesktopHost, DesktopHostStatus};
use std::io;
use tauri::{path::BaseDirectory, AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

/// Native desktop commands are available only to the app's trusted main webview.
fn ensure_trusted_main_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    let url = window
        .url()
        .map_err(|_| "Desktop bootstrap is available only to the app window.".to_string())?;
    let trusted_origin = desktop_bootstrap::is_trusted_webview_origin(
        url.scheme(),
        url.host_str().unwrap_or_default(),
        url.port(),
    );
    if window.label() != "main" || !trusted_origin {
        return Err("Desktop bootstrap is available only to the trusted app window.".to_string());
    }
    Ok(())
}

#[tauri::command]
fn desktop_bootstrap(
    window: tauri::WebviewWindow,
    desktop_host: State<'_, DesktopHost>,
) -> Result<DesktopBootstrap, String> {
    ensure_trusted_main_window(&window)?;
    desktop_host.bootstrap()
}

#[tauri::command]
fn desktop_workspace_root(
    window: tauri::WebviewWindow,
    desktop_host: State<'_, DesktopHost>,
) -> Result<Option<String>, String> {
    ensure_trusted_main_window(&window)?;
    Ok(desktop_host.workspace_root())
}

#[tauri::command]
fn desktop_host_status(
    window: tauri::WebviewWindow,
    desktop_host: State<'_, DesktopHost>,
) -> Result<DesktopHostStatus, String> {
    ensure_trusted_main_window(&window)?;
    Ok(desktop_host.status())
}

#[tauri::command]
async fn desktop_select_workspace(
    window: tauri::WebviewWindow,
    app: AppHandle,
    desktop_host: State<'_, DesktopHost>,
) -> Result<bool, String> {
    ensure_trusted_main_window(&window)?;
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    app.dialog()
        .file()
        .set_parent(&window)
        .set_title("Choose your Agent-Workspace folder")
        .pick_folder(move |selected| {
            let _ = sender.send(selected);
        });
    let selected = tauri::async_runtime::spawn_blocking(move || receiver.recv().unwrap_or(None))
        .await
        .map_err(|_| "The folder picker could not be completed.".to_string())?;
    let Some(selected) = selected else {
        return Ok(false);
    };
    let path = selected
        .into_path()
        .map_err(|_| "The selected folder path could not be read.".to_string())?;
    desktop_host.select_workspace(&path)?;
    Ok(true)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let host_resource = app
                .path()
                .resolve("agent-control-host", BaseDirectory::Resource)
                .map_err(|_| io::Error::other("Could not locate the bundled host resource."))?;
            let config_dir = app
                .path()
                .app_config_dir()
                .map_err(|_| io::Error::other("Could not locate desktop settings."))?;
            let desktop_host = DesktopHost::new(host_resource, config_dir);
            desktop_host
                .start_saved_workspace()
                .map_err(io::Error::other)?;
            app.manage(desktop_host);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            desktop_bootstrap,
            desktop_workspace_root,
            desktop_host_status,
            desktop_select_workspace
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
