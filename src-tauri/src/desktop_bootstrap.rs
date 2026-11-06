use crate::workspace_selection::{
    load_workspace_root, save_workspace_root, validate_workspace_root,
};
use serde::{Deserialize, Serialize};
use std::io::{self, BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{mpsc, Mutex};
use std::thread;
use std::time::Duration;

const PROTOCOL_VERSION: u16 = 1;
const MESSAGE_TYPE: &str = "agent-control-ready";

const MAX_READY_LINE_BYTES: usize = 4096;
const STARTUP_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopBootstrap {
    pub(crate) protocol_version: u16,
    pub(crate) api_base_url: String,
    pub(crate) token: String,
}

struct RunningHost {
    bootstrap: DesktopBootstrap,
    _child: HostChild,
    workspace_root: PathBuf,
}

/// Owns the selected workspace and the host process bound to it.
pub(crate) struct DesktopHost {
    host_resource: PathBuf,
    config_dir: PathBuf,
    running: Mutex<Option<RunningHost>>,
}

impl DesktopHost {
    pub(crate) fn new(host_resource: PathBuf, config_dir: PathBuf) -> Self {
        Self {
            host_resource,
            config_dir,
            running: Mutex::new(None),
        }
    }

    pub(crate) fn start_saved_workspace(&self) -> Result<(), String> {
        let Some(workspace_root) = load_workspace_root(&self.config_dir) else {
            return Ok(());
        };
        self.start_workspace(&workspace_root, false)
    }

    pub(crate) fn bootstrap(&self) -> Result<DesktopBootstrap, String> {
        self.running
            .lock()
            .map_err(|_| "The desktop host state is unavailable.".to_string())?
            .as_ref()
            .map(|running| running.bootstrap.clone())
            .ok_or_else(|| "Choose a workspace to start Agent Control.".to_string())
    }

    pub(crate) fn workspace_root(&self) -> Option<String> {
        self.running
            .lock()
            .ok()?
            .as_ref()
            .map(|running| running.workspace_root.to_string_lossy().into_owned())
    }

    pub(crate) fn select_workspace(&self, candidate: &Path) -> Result<(), String> {
        self.start_workspace(candidate, true)
    }

    fn start_workspace(&self, candidate: &Path, persist: bool) -> Result<(), String> {
        let workspace_root = validate_workspace_root(candidate)?;
        let mut running = self
            .running
            .lock()
            .map_err(|_| "The desktop host state is unavailable.".to_string())?;
        if running
            .as_ref()
            .is_some_and(|current| current.workspace_root == workspace_root)
        {
            return Ok(());
        }

        // Start and authenticate the replacement before persisting or dropping the live host.
        let (bootstrap, child) = start_host(&self.host_resource, &workspace_root)?;
        if persist {
            save_workspace_root(&self.config_dir, &workspace_root)?;
        }
        *running = Some(RunningHost {
            bootstrap,
            _child: child,
            workspace_root,
        });
        Ok(())
    }
}

pub(crate) struct HostChild(Mutex<Child>);

impl HostChild {
    pub(crate) fn new(child: Child) -> Self {
        Self(Mutex::new(child))
    }
}

impl Drop for HostChild {
    fn drop(&mut self) {
        if let Ok(child) = self.0.get_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

pub(crate) fn is_trusted_webview_origin(scheme: &str, host: &str, port: Option<u16>) -> bool {
    (scheme == "tauri" && host == "localhost" && port.is_none())
        || (scheme == "http" && host == "127.0.0.1" && port == Some(5173))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReadyMessage {
    #[serde(rename = "type")]
    message_type: String,
    protocol_version: u16,
    host: String,
    port: u16,
    token: String,
}

pub(crate) fn parse_ready_line(line: &str) -> Result<DesktopBootstrap, &'static str> {
    let message: ReadyMessage =
        serde_json::from_str(line.trim()).map_err(|_| "Malformed desktop readiness message.")?;
    if message.message_type != MESSAGE_TYPE || message.protocol_version != PROTOCOL_VERSION {
        return Err("Unsupported desktop readiness protocol.");
    }
    if message.host != "127.0.0.1" {
        return Err("Desktop host did not bind to loopback.");
    }
    if message.port == 0 {
        return Err("Desktop host reported an invalid port.");
    }
    if message.token.len() != 64
        || !message
            .token
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err("Desktop host reported an invalid token.");
    }

    Ok(DesktopBootstrap {
        protocol_version: PROTOCOL_VERSION,
        api_base_url: format!("http://127.0.0.1:{}", message.port),
        token: message.token,
    })
}

/// Start the bundled host in release builds; in development, use the repository's Node runtime.
/// The token is delivered only over stdout and never appears in command arguments or logs.
pub(crate) fn start_host(
    host_resource: &Path,
    workspace_root: &Path,
) -> Result<(DesktopBootstrap, HostChild), String> {
    let mut command = host_command(host_resource)?;

    let mut child = command
        .env("AC_DESKTOP_MODE", "1")
        .env("HOST", "127.0.0.1")
        .env("PORT", "0")
        .env("WS_WORKSPACE_ROOT", workspace_root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "Could not start the local Agent-Control host.".to_string())?;

    let Some(stdout) = child.stdout.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err("Could not read local host readiness.".to_string());
    };
    let (sender, receiver) = mpsc::sync_channel(1);
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let result = read_bounded_line(&mut reader);
        let _ = sender.send(result);
        let _ = io::copy(&mut reader, &mut io::sink());
    });

    let line = match receiver.recv_timeout(STARTUP_TIMEOUT) {
        Ok(Ok(line)) => line,
        Ok(Err(error)) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err("The local Agent-Control host did not become ready in time.".to_string());
        }
    };

    match parse_ready_line(&line) {
        Ok(bootstrap) => Ok((bootstrap, HostChild::new(child))),
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            Err(error.to_string())
        }
    }
}

#[cfg(debug_assertions)]
fn host_command(_host_resource: &Path) -> Result<Command, String> {
    let project_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or_else(|| "Could not locate the Agent-Control project root.".to_string())?
        .to_path_buf();
    let mut command = Command::new("node");
    command
        .args(["--import", "tsx", "server/index.ts"])
        .current_dir(project_root);
    Ok(command)
}

#[cfg(not(debug_assertions))]
fn host_command(host_resource: &Path) -> Result<Command, String> {
    if !host_resource.is_file() {
        return Err("The bundled Agent-Control host is missing.".to_string());
    }
    Ok(Command::new(host_resource))
}

fn read_bounded_line(reader: &mut impl BufRead) -> Result<String, String> {
    let mut bytes = Vec::with_capacity(256);
    loop {
        let available = reader
            .fill_buf()
            .map_err(|_| "Could not read local host readiness.".to_string())?;
        if available.is_empty() {
            return Err("The local Agent-Control host exited before readiness.".to_string());
        }
        let end = available.iter().position(|byte| *byte == b'\n');
        let count = end.map_or(available.len(), |index| index + 1);
        if bytes.len() + count > MAX_READY_LINE_BYTES {
            return Err(
                "The local Agent-Control host sent an oversized readiness message.".to_string(),
            );
        }
        bytes.extend_from_slice(&available[..count]);
        reader.consume(count);
        if end.is_some() {
            return String::from_utf8(bytes).map_err(|_| {
                "The local Agent-Control host sent invalid readiness text.".to_string()
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{is_trusted_webview_origin, parse_ready_line};
    use std::io::Cursor;

    const TOKEN: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    fn ready_line() -> String {
        format!(
            r#"{{"type":"agent-control-ready","protocolVersion":1,"host":"127.0.0.1","port":43210,"token":"{TOKEN}"}}"#
        )
    }

    #[test]
    fn parses_versioned_loopback_readiness() {
        let config = parse_ready_line(&ready_line()).expect("valid readiness");
        assert_eq!(config.protocol_version, 1);
        assert_eq!(config.api_base_url, "http://127.0.0.1:43210");
        assert_eq!(config.token, TOKEN);
    }

    #[test]
    fn rejects_wrong_protocol_or_non_loopback_address() {
        for line in [
            ready_line().replace("protocolVersion\":1", "protocolVersion\":2"),
            ready_line().replace("127.0.0.1", "0.0.0.0"),
        ] {
            assert!(parse_ready_line(&line).is_err());
        }
    }

    #[test]
    fn rejects_malformed_ports_and_tokens() {
        for line in [
            ready_line().replace("43210", "0"),
            ready_line().replace("43210", "65536"),
            ready_line().replace(TOKEN, "short"),
            "not json".to_string(),
        ] {
            assert!(parse_ready_line(&line).is_err());
        }
    }

    #[test]
    fn permits_only_production_and_dev_app_origins() {
        assert!(is_trusted_webview_origin("tauri", "localhost", None));
        assert!(is_trusted_webview_origin("http", "127.0.0.1", Some(5173)));
        assert!(!is_trusted_webview_origin("https", "localhost", None));
        assert!(!is_trusted_webview_origin("tauri", "localhost", Some(1234)));
        assert!(!is_trusted_webview_origin("http", "localhost", Some(5173)));
        assert!(!is_trusted_webview_origin("http", "127.0.0.1", Some(5174)));
    }

    #[test]
    fn rejects_unknown_readiness_fields_and_oversized_lines() {
        let with_extra = ready_line().replace("}", ",\"extra\":true}");
        assert!(parse_ready_line(&with_extra).is_err());

        let mut bytes = vec![b'x'; super::MAX_READY_LINE_BYTES + 1];
        bytes.push(b'\n');
        let mut input = Cursor::new(bytes);
        assert!(super::read_bounded_line(&mut input).is_err());
    }
}
