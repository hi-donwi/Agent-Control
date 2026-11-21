//! Moves launch at login from the LaunchAgent written under the previous product name to the
//! current one.
//!
//! tauri-plugin-autostart names the macOS LaunchAgent after `productName`: the file is
//! `~/Library/LaunchAgents/<productName>.plist` and its `Label` is the same name. Renaming the
//! product from "Agent Control" to "DONWI Desk" would otherwise leave the old agent behind,
//! still pointing at the old bundle, while the settings switch reads the new name as "off".

#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// The product name, and so the LaunchAgent label, used before the DONWI rename.
pub const LEGACY_LAUNCH_AGENT_LABEL: &str = "Agent Control";

/// The bundle executable named in the LaunchAgent's `ProgramArguments` (the Cargo package
/// name, unchanged by the rename).
const BUNDLE_EXECUTABLE_SUFFIX: &str = ".app/Contents/MacOS/agent-control";

#[derive(Debug, PartialEq, Eq)]
pub enum Migration {
    /// There is no LaunchAgent under the previous name, or the name did not change.
    NotNeeded,
    /// A file with the previous name exists but this app did not write it; it is left alone.
    ForeignFileKept,
    /// Launch at login now uses the current name and the previous LaunchAgent is removed.
    Migrated,
}

pub fn legacy_launch_agent_path(launch_agents_dir: &Path) -> PathBuf {
    launch_agents_dir.join(format!("{LEGACY_LAUNCH_AGENT_LABEL}.plist"))
}

/// True only for the LaunchAgent that tauri-plugin-autostart wrote for this app under the
/// previous name: the label matches and the program is this app's bundle executable.
pub fn is_legacy_launch_agent(plist: &str) -> bool {
    let label = string_after_key(plist, "Label");
    let program = first_array_string_after_key(plist, "ProgramArguments");
    label == Some(LEGACY_LAUNCH_AGENT_LABEL)
        && program.is_some_and(|path| path.ends_with(BUNDLE_EXECUTABLE_SUFFIX))
}

/// Enables launch at login under the current name first, then removes the previous
/// LaunchAgent, so a failure never leaves the user without either entry.
pub fn migrate(
    launch_agents_dir: &Path,
    current_label: &str,
    enable_current: impl FnOnce() -> Result<(), String>,
) -> Result<Migration, String> {
    if current_label == LEGACY_LAUNCH_AGENT_LABEL {
        return Ok(Migration::NotNeeded);
    }
    let legacy = legacy_launch_agent_path(launch_agents_dir);
    let plist = match fs::read_to_string(&legacy) {
        Ok(text) => text,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Migration::NotNeeded),
        Err(_) => return Err("Could not read the previous launch-at-login entry.".to_string()),
    };
    if !is_legacy_launch_agent(&plist) {
        return Ok(Migration::ForeignFileKept);
    }
    enable_current()?;
    fs::remove_file(&legacy)
        .map_err(|_| "Could not remove the previous launch-at-login entry.".to_string())?;
    Ok(Migration::Migrated)
}

/// The `<string>` value that directly follows `<key>{key}</key>`.
fn string_after_key<'a>(plist: &'a str, key: &str) -> Option<&'a str> {
    let rest = after_key(plist, key)?;
    string_value(rest)
}

/// The first `<string>` inside the `<array>` that directly follows `<key>{key}</key>`.
fn first_array_string_after_key<'a>(plist: &'a str, key: &str) -> Option<&'a str> {
    let rest = after_key(plist, key)?.strip_prefix("<array>")?;
    string_value(rest.trim_start())
}

fn after_key<'a>(plist: &'a str, key: &str) -> Option<&'a str> {
    let marker = format!("<key>{key}</key>");
    let start = plist.find(&marker)? + marker.len();
    Some(plist[start..].trim_start())
}

fn string_value(text: &str) -> Option<&str> {
    let value = text.strip_prefix("<string>")?;
    Some(&value[..value.find("</string>")?])
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NEXT_DIR: AtomicUsize = AtomicUsize::new(0);

    /// The exact text tauri-plugin-autostart 2.7.0 (auto-launch 0.6.0) writes in LaunchAgent mode.
    fn plugin_plist(label: &str, program: &str) -> String {
        format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\">\n  <dict>\n  <key>Label</key>\n  <string>{label}</string>\n  <key>AssociatedBundleIdentifiers</key>\n  <array></array>\n  <key>ProgramArguments</key>\n  <array><string>{program}</string></array>\n  <key>RunAtLoad</key>\n  <true/>\n  </dict>\n</plist>"
        )
    }

    const LEGACY_PROGRAM: &str = "/Applications/Agent Control.app/Contents/MacOS/agent-control";

    fn launch_agents_dir() -> PathBuf {
        let id = NEXT_DIR.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "agent-control-launch-agents-{}-{id}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn recognizes_the_plugin_written_legacy_launch_agent() {
        assert!(is_legacy_launch_agent(&plugin_plist(
            LEGACY_LAUNCH_AGENT_LABEL,
            LEGACY_PROGRAM
        )));
    }

    #[test]
    fn rejects_a_launch_agent_for_another_program_or_label() {
        assert!(!is_legacy_launch_agent(&plugin_plist(
            LEGACY_LAUNCH_AGENT_LABEL,
            "/Applications/Agent Control.app/Contents/MacOS/someone-else"
        )));
        assert!(!is_legacy_launch_agent(&plugin_plist(
            "Agent Control Helper",
            LEGACY_PROGRAM
        )));
        assert!(!is_legacy_launch_agent("not a plist"));
    }

    #[test]
    fn migrates_by_enabling_the_current_name_before_removing_the_legacy_file() {
        let dir = launch_agents_dir();
        let legacy = legacy_launch_agent_path(&dir);
        fs::write(
            &legacy,
            plugin_plist(LEGACY_LAUNCH_AGENT_LABEL, LEGACY_PROGRAM),
        )
        .unwrap();
        let mut legacy_present_when_enabling = None;
        let outcome = migrate(&dir, "DONWI Desk", || {
            legacy_present_when_enabling = Some(legacy.exists());
            Ok(())
        });
        assert_eq!(outcome, Ok(Migration::Migrated));
        assert_eq!(legacy_present_when_enabling, Some(true));
        assert!(!legacy.exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn keeps_the_legacy_file_when_enabling_the_current_name_fails() {
        let dir = launch_agents_dir();
        let legacy = legacy_launch_agent_path(&dir);
        fs::write(
            &legacy,
            plugin_plist(LEGACY_LAUNCH_AGENT_LABEL, LEGACY_PROGRAM),
        )
        .unwrap();
        let outcome = migrate(&dir, "DONWI Desk", || Err("denied".to_string()));
        assert_eq!(outcome, Err("denied".to_string()));
        assert!(legacy.exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn leaves_a_foreign_file_with_the_legacy_name_alone() {
        let dir = launch_agents_dir();
        let legacy = legacy_launch_agent_path(&dir);
        let foreign = plugin_plist(
            LEGACY_LAUNCH_AGENT_LABEL,
            "/usr/local/bin/another-agent-control",
        );
        fs::write(&legacy, &foreign).unwrap();
        let outcome = migrate(&dir, "DONWI Desk", || panic!("must not enable"));
        assert_eq!(outcome, Ok(Migration::ForeignFileKept));
        assert_eq!(fs::read_to_string(&legacy).unwrap(), foreign);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn does_nothing_without_a_legacy_file_or_when_the_name_is_unchanged() {
        let dir = launch_agents_dir();
        let outcome = migrate(&dir, "DONWI Desk", || panic!("must not enable"));
        assert_eq!(outcome, Ok(Migration::NotNeeded));

        let legacy = legacy_launch_agent_path(&dir);
        fs::write(
            &legacy,
            plugin_plist(LEGACY_LAUNCH_AGENT_LABEL, LEGACY_PROGRAM),
        )
        .unwrap();
        let outcome = migrate(&dir, LEGACY_LAUNCH_AGENT_LABEL, || {
            panic!("must not enable")
        });
        assert_eq!(outcome, Ok(Migration::NotNeeded));
        assert!(legacy.exists());
        let _ = fs::remove_dir_all(dir);
    }
}
