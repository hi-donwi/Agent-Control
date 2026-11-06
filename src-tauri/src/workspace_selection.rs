use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

const WORKSPACE_CONFIG_FILE: &str = "workspace.json";
static NEXT_TEMP_FILE: AtomicUsize = AtomicUsize::new(0);

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WorkspaceConfig {
    workspace_root: String,
}

/// Resolve and validate a user-selected Agent-Workspace root.
pub(crate) fn validate_workspace_root(candidate: &Path) -> Result<PathBuf, String> {
    let root = candidate
        .canonicalize()
        .map_err(|_| "The selected folder is not available.".to_string())?;
    if !root.is_dir()
        || !root.join("AGENTS.md").is_file()
        || !root.join(".agents").join("standards").is_dir()
    {
        return Err(
            "Choose the Agent-Workspace folder containing AGENTS.md and .agents/standards."
                .to_string(),
        );
    }
    if root.to_str().is_none() {
        return Err("Choose a workspace folder with a supported path.".to_string());
    }
    Ok(root)
}

/// Load a saved root only when it still resolves to a valid workspace.
pub(crate) fn load_workspace_root(config_dir: &Path) -> Option<PathBuf> {
    let raw = fs::read_to_string(config_dir.join(WORKSPACE_CONFIG_FILE)).ok()?;
    let config = serde_json::from_str::<WorkspaceConfig>(&raw).ok()?;
    validate_workspace_root(Path::new(&config.workspace_root)).ok()
}

/// Persist the selected root separately from provider credentials.
pub(crate) fn save_workspace_root(config_dir: &Path, candidate: &Path) -> Result<(), String> {
    let root = validate_workspace_root(candidate)?;
    fs::create_dir_all(config_dir)
        .map_err(|_| "Could not save the desktop workspace selection.".to_string())?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(config_dir, fs::Permissions::from_mode(0o700))
            .map_err(|_| "Could not secure desktop settings.".to_string())?;
    }

    let config_path = config_dir.join(WORKSPACE_CONFIG_FILE);
    let temp_path = config_dir.join(format!(
        ".workspace-{}-{}.tmp",
        std::process::id(),
        NEXT_TEMP_FILE.fetch_add(1, Ordering::Relaxed)
    ));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let write_result = (|| {
        let mut file = options
            .open(&temp_path)
            .map_err(|_| "Could not save the desktop workspace selection.".to_string())?;
        let config = WorkspaceConfig {
            workspace_root: root.to_string_lossy().into_owned(),
        };
        let bytes = serde_json::to_vec(&config)
            .map_err(|_| "Could not save the desktop workspace selection.".to_string())?;
        file.write_all(&bytes)
            .and_then(|()| file.sync_all())
            .map_err(|_| "Could not save the desktop workspace selection.".to_string())?;
        drop(file);
        fs::rename(&temp_path, &config_path)
            .map_err(|_| "Could not save the desktop workspace selection.".to_string())
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    write_result
}

#[cfg(test)]
mod tests {
    use super::{load_workspace_root, save_workspace_root, validate_workspace_root};
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NEXT_TEMP: AtomicUsize = AtomicUsize::new(0);

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "agent-control-workspace-selection-{}-{}",
                std::process::id(),
                NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&path).expect("create temporary directory");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn workspace(root: &Path) -> PathBuf {
        fs::create_dir_all(root.join(".agents/standards")).expect("create standards directory");
        fs::write(root.join("AGENTS.md"), "# Workspace\n").expect("create workspace marker");
        root.to_path_buf()
    }

    #[test]
    fn accepts_a_workspace_with_required_markers_and_returns_canonical_path() {
        let temp = TempDir::new();
        let candidate = workspace(&temp.path().join("workspace"));

        let selected = validate_workspace_root(&candidate).expect("valid workspace");

        assert_eq!(selected, candidate.canonicalize().expect("canonical path"));
    }

    #[test]
    fn rejects_directories_without_workspace_markers_and_regular_files() {
        let temp = TempDir::new();
        let empty = temp.path().join("empty");
        fs::create_dir_all(&empty).expect("create empty directory");
        let regular_file = temp.path().join("file");
        fs::write(&regular_file, "not a workspace").expect("create regular file");

        assert!(validate_workspace_root(&empty).is_err());
        assert!(validate_workspace_root(&regular_file).is_err());
    }

    #[test]
    fn saves_and_loads_the_workspace_without_touching_other_settings() {
        let temp = TempDir::new();
        let config_dir = temp.path().join("app-config");
        let selected = workspace(&temp.path().join("workspace"))
            .canonicalize()
            .expect("canonical path");

        save_workspace_root(&config_dir, &selected).expect("save workspace selection");

        assert_eq!(load_workspace_root(&config_dir), Some(selected));
        assert!(config_dir.join("workspace.json").is_file());
        assert!(!config_dir.join("config.json").exists());
    }

    #[cfg(unix)]
    #[test]
    fn saves_workspace_selection_with_owner_only_file_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let temp = TempDir::new();
        let config_dir = temp.path().join("app-config");
        let selected = workspace(&temp.path().join("workspace"));

        save_workspace_root(&config_dir, &selected).expect("save workspace selection");

        let mode = fs::metadata(config_dir.join("workspace.json"))
            .expect("workspace config metadata")
            .permissions()
            .mode();
        assert_eq!(mode & 0o077, 0);
    }

    #[test]
    fn ignores_malformed_or_stale_saved_workspace_and_allows_reselection() {
        let temp = TempDir::new();
        let config_dir = temp.path().join("app-config");
        fs::create_dir_all(&config_dir).expect("create app config directory");
        fs::write(config_dir.join("workspace.json"), "not json").expect("write malformed config");
        assert_eq!(load_workspace_root(&config_dir), None);

        let missing = workspace(&temp.path().join("workspace"));
        save_workspace_root(&config_dir, &missing).expect("save selected workspace");
        fs::remove_dir_all(&missing).expect("remove saved workspace");
        assert_eq!(load_workspace_root(&config_dir), None);
    }
}
