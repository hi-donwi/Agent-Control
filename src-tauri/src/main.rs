// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_lifecycle;
mod desktop_bootstrap;
mod launch_agent_migration;
mod restart_policy;
mod rotating_log;
mod workspace_selection;

use app_lifecycle::AppLifecycle;
use desktop_bootstrap::{DesktopBootstrap, DesktopHost, DesktopHostStatus};
use std::io;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    path::BaseDirectory,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, State, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as AutostartManagerExt};
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
fn desktop_autostart_status(window: tauri::WebviewWindow, app: AppHandle) -> Result<bool, String> {
    ensure_trusted_main_window(&window)?;
    app.autolaunch()
        .is_enabled()
        .map_err(|_| "Could not read launch-at-login status.".to_string())
}

#[tauri::command]
fn desktop_set_autostart(
    window: tauri::WebviewWindow,
    app: AppHandle,
    enabled: bool,
) -> Result<bool, String> {
    ensure_trusted_main_window(&window)?;
    let autostart = app.autolaunch();
    if enabled {
        autostart.enable()
    } else {
        autostart.disable()
    }
    .map_err(|_| "Could not update launch-at-login settings.".to_string())?;
    autostart
        .is_enabled()
        .map_err(|_| "Could not verify launch-at-login settings.".to_string())
}

/// Carries launch at login over from the LaunchAgent named after the previous product name.
/// It never blocks startup: on failure the previous entry stays and the switch reads "off".
#[cfg(target_os = "macos")]
fn migrate_launch_at_login(app: &AppHandle) {
    let Ok(home) = app.path().home_dir() else {
        return;
    };
    let launch_agents = home.join("Library").join("LaunchAgents");
    let current_label = app.package_info().name.clone();
    let outcome = launch_agent_migration::migrate(&launch_agents, &current_label, || {
        app.autolaunch()
            .enable()
            .map_err(|_| "Could not enable launch at login under the current name.".to_string())
    });
    if let Err(message) = outcome {
        eprintln!("{message}");
    }
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn quit_app(app: &AppHandle) {
    if let Some(lifecycle) = app.try_state::<AppLifecycle>() {
        lifecycle.request_quit();
    }
    if let Some(desktop_host) = app.try_state::<DesktopHost>() {
        desktop_host.stop();
    }
    app.exit(0);
}

fn build_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show DONWI Desk", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    let icon = Image::from_bytes(include_bytes!("../icons/icon.png"))?;
    let tray = TrayIconBuilder::new()
        .icon(icon)
        .tooltip("DONWI Desk")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "quit" => quit_app(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    app.manage(tray);
    Ok(())
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
        .set_title("Choose your DONWI Workspace folder")
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
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            app.manage(AppLifecycle::default());
            #[cfg(target_os = "macos")]
            migrate_launch_at_login(app.handle());
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
            build_tray(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    let lifecycle = window.app_handle().state::<AppLifecycle>();
                    if lifecycle.should_hide_on_close() {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            desktop_bootstrap,
            desktop_workspace_root,
            desktop_host_status,
            desktop_select_workspace,
            desktop_autostart_status,
            desktop_set_autostart
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
