use crate::restart_policy::RestartBackoff;
use crate::rotating_log::RotatingLog;
use crate::workspace_selection::{
    load_workspace_root, save_workspace_root, validate_workspace_root,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

const PROTOCOL_VERSION: u16 = 1;
const MESSAGE_TYPE: &str = "agent-control-ready";

const MAX_READY_LINE_BYTES: usize = 4096;
const STARTUP_TIMEOUT: Duration = Duration::from_secs(10);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(3);
const SHUTDOWN_COMMAND: &[u8] = b"AC_DESKTOP_SHUTDOWN_V1\n";
const HOST_LOG_MAX_BYTES: u64 = 1_048_576;
const HOST_LOG_BACKUPS: usize = 3;
const RESTART_INITIAL_DELAY: Duration = Duration::from_millis(250);
const RESTART_MAX_DELAY: Duration = Duration::from_secs(30);
const CHILD_POLL_INTERVAL: Duration = Duration::from_millis(100);
static HOST_LOG: OnceLock<Mutex<Option<RotatingLog>>> = OnceLock::new();

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopBootstrap {
    pub(crate) protocol_version: u16,
    pub(crate) api_base_url: String,
    pub(crate) token: String,
}

struct RunningHost {
    supervisor: HostSupervisor,
    workspace_root: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopHostStatus {
    pub(crate) lifecycle: HostLifecycle,
    pub(crate) restart_count: u32,
    pub(crate) last_exit_code: Option<i32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum HostLifecycle {
    Running,
    Restarting,
    Stopped,
}

struct SupervisorSnapshot {
    bootstrap: DesktopBootstrap,
    status: DesktopHostStatus,
}

struct HostSupervisor {
    snapshot: Arc<Mutex<SupervisorSnapshot>>,
    stop: mpsc::Sender<()>,
    worker: Option<thread::JoinHandle<()>>,
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
        let running = self
            .running
            .lock()
            .map_err(|_| "The desktop host state is unavailable.".to_string())?;
        let running = running
            .as_ref()
            .ok_or_else(|| "Choose a workspace to start Agent Control.".to_string())?;
        running.supervisor.bootstrap()
    }

    pub(crate) fn status(&self) -> DesktopHostStatus {
        self.running
            .lock()
            .ok()
            .and_then(|running| running.as_ref().map(|running| running.supervisor.status()))
            .unwrap_or(DesktopHostStatus {
                lifecycle: HostLifecycle::Stopped,
                restart_count: 0,
                last_exit_code: None,
            })
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
        let (bootstrap, child) = start_host(&self.host_resource, &workspace_root, None)?;
        let supervisor = HostSupervisor::start(
            bootstrap,
            child,
            self.host_resource.clone(),
            workspace_root.clone(),
        );
        if persist {
            if let Err(error) = save_workspace_root(&self.config_dir, &workspace_root) {
                drop(supervisor);
                return Err(error);
            }
        }
        *running = Some(RunningHost {
            supervisor,
            workspace_root,
        });
        Ok(())
    }
}

impl HostSupervisor {
    fn start(
        bootstrap: DesktopBootstrap,
        child: HostChild,
        host_resource: PathBuf,
        workspace_root: PathBuf,
    ) -> Self {
        let restart_bootstrap = bootstrap.clone();
        Self::with_restart(bootstrap, child, move || {
            start_host(&host_resource, &workspace_root, Some(&restart_bootstrap))
        })
    }

    fn with_restart<F>(bootstrap: DesktopBootstrap, child: HostChild, restart: F) -> Self
    where
        F: FnMut() -> Result<(DesktopBootstrap, HostChild), String> + Send + 'static,
    {
        let snapshot = Arc::new(Mutex::new(SupervisorSnapshot {
            bootstrap,
            status: DesktopHostStatus {
                lifecycle: HostLifecycle::Running,
                restart_count: 0,
                last_exit_code: None,
            },
        }));
        let (stop, receiver) = mpsc::channel();
        let worker_snapshot = Arc::clone(&snapshot);
        let worker =
            thread::spawn(move || supervise_host(child, worker_snapshot, receiver, restart));
        Self {
            snapshot,
            stop,
            worker: Some(worker),
        }
    }

    fn bootstrap(&self) -> Result<DesktopBootstrap, String> {
        self.snapshot
            .lock()
            .map_err(|_| "The desktop host state is unavailable.".to_string())
            .and_then(|snapshot| {
                if matches!(snapshot.status.lifecycle, HostLifecycle::Running) {
                    Ok(snapshot.bootstrap.clone())
                } else {
                    Err("The local Agent-Control host is restarting.".to_string())
                }
            })
    }

    fn status(&self) -> DesktopHostStatus {
        self.snapshot
            .lock()
            .map(|snapshot| snapshot.status.clone())
            .unwrap_or(DesktopHostStatus {
                lifecycle: HostLifecycle::Stopped,
                restart_count: 0,
                last_exit_code: None,
            })
    }
}

impl Drop for HostSupervisor {
    fn drop(&mut self) {
        let _ = self.stop.send(());
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

pub(crate) struct HostChild {
    child: Mutex<Child>,
    stderr_log: Option<thread::JoinHandle<()>>,
}

impl HostChild {
    #[cfg(test)]
    pub(crate) fn new(child: Child) -> Self {
        Self {
            child: Mutex::new(child),
            stderr_log: None,
        }
    }

    fn with_stderr_log(child: Child, stderr_log: thread::JoinHandle<()>) -> Self {
        Self {
            child: Mutex::new(child),
            stderr_log: Some(stderr_log),
        }
    }

    fn try_wait(&self) -> io::Result<Option<ExitStatus>> {
        self.child
            .lock()
            .map_err(|_| io::Error::other("desktop child state unavailable"))?
            .try_wait()
    }

    fn stop(self) {
        drop(self);
    }
}

impl Drop for HostChild {
    fn drop(&mut self) {
        if let Ok(child) = self.child.get_mut() {
            stop_child(child, SHUTDOWN_TIMEOUT);
        }
        if let Some(stderr_log) = self.stderr_log.take() {
            let _ = stderr_log.join();
        }
    }
}

fn supervise_host<F>(
    child: HostChild,
    snapshot: Arc<Mutex<SupervisorSnapshot>>,
    stop: mpsc::Receiver<()>,
    mut restart: F,
) where
    F: FnMut() -> Result<(DesktopBootstrap, HostChild), String>,
{
    let mut child = Some(child);
    let mut backoff = RestartBackoff::new(RESTART_INITIAL_DELAY, RESTART_MAX_DELAY);
    let mut restart_count = 0_u32;
    let mut last_exit_code = None;

    loop {
        match stop.recv_timeout(CHILD_POLL_INTERVAL) {
            Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => {
                if let Some(child) = child.take() {
                    child.stop();
                }
                update_supervisor_status(
                    &snapshot,
                    DesktopHostStatus {
                        lifecycle: HostLifecycle::Stopped,
                        restart_count,
                        last_exit_code,
                    },
                );
                return;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }

        if let Some(current) = child.as_ref() {
            match current.try_wait() {
                Ok(None) => continue,
                Ok(Some(status)) => last_exit_code = status.code(),
                Err(_) => last_exit_code = None,
            }
            drop(child.take());
        }

        let delay = backoff.next_delay();
        update_supervisor_status(
            &snapshot,
            DesktopHostStatus {
                lifecycle: HostLifecycle::Restarting,
                restart_count,
                last_exit_code,
            },
        );
        match stop.recv_timeout(delay) {
            Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => {
                update_supervisor_status(
                    &snapshot,
                    DesktopHostStatus {
                        lifecycle: HostLifecycle::Stopped,
                        restart_count,
                        last_exit_code,
                    },
                );
                return;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }

        match restart() {
            Ok((bootstrap, replacement)) => {
                restart_count = restart_count.saturating_add(1);
                backoff.reset();
                if let Ok(mut current) = snapshot.lock() {
                    current.bootstrap = bootstrap;
                    current.status = DesktopHostStatus {
                        lifecycle: HostLifecycle::Running,
                        restart_count,
                        last_exit_code,
                    };
                }
                child = Some(replacement);
            }
            Err(_) => {
                // The next loop advances the capped delay and retries without exposing error text.
            }
        }
    }
}

fn update_supervisor_status(snapshot: &Mutex<SupervisorSnapshot>, status: DesktopHostStatus) {
    if let Ok(mut snapshot) = snapshot.lock() {
        snapshot.status = status;
    }
}

/// Ask the desktop-only host to close its listener, then force-stop it if it exceeds the grace period.
/// Returns true only when the forced-stop fallback was required.
fn stop_child(child: &mut Child, grace_period: Duration) -> bool {
    if let Some(stdin) = child.stdin.as_mut() {
        let _ = stdin.write_all(SHUTDOWN_COMMAND);
        let _ = stdin.flush();
    }

    let deadline = Instant::now() + grace_period;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return false,
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(20)),
            _ => {
                force_stop_process_group(child);
                let _ = child.wait();
                return true;
            }
        }
    }
}

#[cfg(unix)]
fn configure_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

#[cfg(windows)]
fn configure_process_group(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    // CREATE_NEW_PROCESS_GROUP; taskkill /T below terminates this host's process tree.
    command.creation_flags(0x0000_0200);
}

#[cfg(unix)]
fn force_stop_process_group(child: &mut Child) {
    if let Ok(process_group) = i32::try_from(child.id()) {
        // The child was spawned in a new process group, so descendants of the host are included.
        let result = unsafe { libc::kill(-process_group, libc::SIGKILL) };
        if result == 0 {
            return;
        }
    }
    let _ = child.kill();
}

#[cfg(windows)]
fn force_stop_process_group(child: &mut Child) {
    let pid = child.id().to_string();
    let killed_tree = Command::new("taskkill")
        .args(["/PID", &pid, "/T", "/F"])
        .status()
        .is_ok_and(|status| status.success());
    if !killed_tree {
        let _ = child.kill();
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
    restart_from: Option<&DesktopBootstrap>,
) -> Result<(DesktopBootstrap, HostChild), String> {
    prepare_host_log()?;
    let mut command = host_command(host_resource)?;
    configure_process_group(&mut command);

    let mut child = command
        .env("AC_DESKTOP_MODE", "1")
        .env("HOST", "127.0.0.1")
        .env(
            "PORT",
            restart_from
                .and_then(bootstrap_port)
                .map_or_else(|| "0".to_string(), |port| port.to_string()),
        )
        .env("WS_WORKSPACE_ROOT", workspace_root)
        .envs(
            restart_from
                .map(|bootstrap| [("AC_DESKTOP_TOKEN", bootstrap.token.as_str())])
                .into_iter()
                .flatten(),
        )
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| "Could not start the local Agent-Control host.".to_string())?;

    let Some(stderr) = child.stderr.take() else {
        stop_child(&mut child, SHUTDOWN_TIMEOUT);
        return Err("Could not capture local host diagnostics.".to_string());
    };
    let stderr_log = capture_host_stderr(stderr);

    let Some(stdout) = child.stdout.take() else {
        stop_child(&mut child, SHUTDOWN_TIMEOUT);
        let _ = stderr_log.join();
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
            stop_child(&mut child, SHUTDOWN_TIMEOUT);
            let _ = stderr_log.join();
            return Err(error);
        }
        Err(_) => {
            stop_child(&mut child, SHUTDOWN_TIMEOUT);
            let _ = stderr_log.join();
            return Err("The local Agent-Control host did not become ready in time.".to_string());
        }
    };

    match parse_ready_line(&line) {
        Ok(bootstrap) => Ok((bootstrap, HostChild::with_stderr_log(child, stderr_log))),
        Err(error) => {
            stop_child(&mut child, SHUTDOWN_TIMEOUT);
            let _ = stderr_log.join();
            Err(error.to_string())
        }
    }
}

fn prepare_host_log() -> Result<(), String> {
    let path = host_log_path()?;
    let logger = HOST_LOG.get_or_init(|| Mutex::new(None));
    let mut logger = logger
        .lock()
        .map_err(|_| "The private local host log is unavailable.".to_string())?;
    if logger.is_none() {
        *logger = Some(
            RotatingLog::open(path, HOST_LOG_MAX_BYTES, HOST_LOG_BACKUPS)
                .map_err(|_| "Could not open the private local host log.".to_string())?,
        );
    }
    Ok(())
}

fn capture_host_stderr(mut stderr: impl Read + Send + 'static) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let Some(logger) = HOST_LOG.get() else {
            return;
        };
        let mut buffer = [0_u8; 8192];
        loop {
            let count = match stderr.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(count) => count,
            };
            let Ok(mut logger) = logger.lock() else {
                break;
            };
            let Some(logger) = logger.as_mut() else {
                break;
            };
            if logger.write_all(&buffer[..count]).is_err() {
                break;
            }
        }
        if let Some(logger) = HOST_LOG.get() {
            if let Ok(mut logger) = logger.lock() {
                if let Some(logger) = logger.as_mut() {
                    let _ = logger.flush();
                }
            }
        }
    })
}

fn bootstrap_port(bootstrap: &DesktopBootstrap) -> Option<u16> {
    bootstrap.api_base_url.rsplit_once(':')?.1.parse().ok()
}

fn host_log_path() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(|| "Could not locate the private local host log directory.".to_string())?;
    let root = home.join(".agent-control");
    let log_dir = root.join("logs");
    ensure_private_directory(&root)?;
    ensure_private_directory(&log_dir)?;
    Ok(log_dir.join("desktop-host.stderr.log"))
}

fn ensure_private_directory(path: &Path) -> Result<(), String> {
    if !path.exists() {
        fs::create_dir(path)
            .map_err(|_| "Could not create the private local host log directory.".to_string())?;
    }
    let metadata = fs::symlink_metadata(path)
        .map_err(|_| "Could not verify the private local host log directory.".to_string())?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("The private local host log path is not a safe directory.".to_string());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|_| "Could not secure the private local host log directory.".to_string())?;
    }
    Ok(())
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
    use super::{
        is_trusted_webview_origin, parse_ready_line, stop_child, DesktopBootstrap, HostChild,
        HostLifecycle, HostSupervisor,
    };
    use std::io::Cursor;
    use std::process::{Child, Command, Stdio};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::thread;
    use std::time::{Duration, Instant};

    const TOKEN: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    fn ready_line() -> String {
        format!(
            r#"{{"type":"agent-control-ready","protocolVersion":1,"host":"127.0.0.1","port":43210,"token":"{TOKEN}"}}"#
        )
    }

    fn node_child(script: &str) -> Child {
        let mut command = Command::new("node");
        command
            .args(["-e", script])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        super::configure_process_group(&mut command);
        command
            .spawn()
            .expect("Node is installed for desktop host tests")
    }

    fn bootstrap(token: char) -> DesktopBootstrap {
        DesktopBootstrap {
            protocol_version: 1,
            api_base_url: "http://127.0.0.1:43123".to_string(),
            token: std::iter::repeat_n(token, 64).collect(),
        }
    }

    #[test]
    fn requests_graceful_child_shutdown_before_timeout() {
        let mut child = node_child(
            "process.stdin.setEncoding('utf8'); process.stdin.once('data', () => process.exit(0)); setInterval(() => {}, 1000);",
        );

        let forced = stop_child(&mut child, Duration::from_secs(1));

        assert!(!forced, "the host should honor the private shutdown pipe");
        assert!(child.try_wait().expect("wait result").is_some());
    }

    #[test]
    fn force_stops_child_that_does_not_honor_shutdown_before_timeout() {
        let mut child = node_child("process.stdin.resume(); setInterval(() => {}, 1000);");

        let forced = stop_child(&mut child, Duration::from_millis(50));

        assert!(forced, "the child must not outlive the shutdown deadline");
        assert!(child.try_wait().expect("wait result").is_some());
    }

    #[cfg(unix)]
    #[test]
    fn force_stop_terminates_descendants_in_the_host_process_group() {
        use std::fs;

        let pid_file = std::env::temp_dir().join(format!(
            "agent-control-child-pid-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time")
                .as_nanos()
        ));
        let pid_path = serde_json::to_string(&pid_file.to_string_lossy().to_string())
            .expect("JSON-escaped test path");
        let script = format!(
            "const fs=require('node:fs'); const {{spawn}}=require('node:child_process'); const c=spawn(process.execPath,['-e','setInterval(()=>{{}},1000)'],{{stdio:'ignore'}}); fs.writeFileSync({pid_path},String(c.pid)); process.stdin.resume(); setInterval(()=>{{}},1000);"
        );
        let mut parent = node_child(&script);
        let deadline = Instant::now() + Duration::from_secs(2);
        let descendant_pid = loop {
            if let Ok(value) = fs::read_to_string(&pid_file) {
                break value.parse::<i32>().expect("descendant PID");
            }
            assert!(Instant::now() < deadline, "Node child did not start");
            thread::sleep(Duration::from_millis(10));
        };

        assert!(stop_child(&mut parent, Duration::from_millis(50)));
        fs::remove_file(&pid_file).expect("remove temporary child PID file");

        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            let result = unsafe { libc::kill(descendant_pid, 0) };
            if result != 0 {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "host descendant survived process-group stop"
            );
            thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn restarts_crashed_host_and_replaces_bootstrap_without_exposing_status_secrets() {
        let initial = HostChild::new(node_child("setTimeout(() => process.exit(7), 100);"));
        let launches = Arc::new(AtomicUsize::new(0));
        let restart_launches = Arc::clone(&launches);
        let supervisor = HostSupervisor::with_restart(bootstrap('a'), initial, move || {
            restart_launches.fetch_add(1, Ordering::SeqCst);
            let child = node_child(
                "process.stdin.setEncoding('utf8'); process.stdin.once('data', () => process.exit(0)); setInterval(() => {}, 1000);",
            );
            Ok((bootstrap('b'), HostChild::new(child)))
        });

        let mut status = supervisor.status();
        for _ in 0..300 {
            if status.lifecycle == HostLifecycle::Running && status.restart_count == 1 {
                break;
            }
            thread::sleep(Duration::from_millis(10));
            status = supervisor.status();
        }

        assert_eq!(status.lifecycle, HostLifecycle::Running);
        assert_eq!(status.restart_count, 1);
        assert_eq!(status.last_exit_code, Some(7));
        assert_eq!(launches.load(Ordering::SeqCst), 1);
        assert_eq!(
            supervisor.bootstrap().expect("refreshed bootstrap").token,
            bootstrap('b').token
        );
        let serialized = serde_json::to_string(&status).expect("status serializes");
        assert!(!serialized.contains(&bootstrap('b').token));
        assert!(!serialized.contains("127.0.0.1"));
    }

    #[test]
    fn intentional_supervisor_shutdown_does_not_restart_the_host() {
        let initial = HostChild::new(node_child(
            "process.stdin.setEncoding('utf8'); process.stdin.once('data', () => process.exit(0)); setInterval(() => {}, 1000);",
        ));
        let launches = Arc::new(AtomicUsize::new(0));
        let restart_launches = Arc::clone(&launches);
        let supervisor = HostSupervisor::with_restart(bootstrap('a'), initial, move || {
            restart_launches.fetch_add(1, Ordering::SeqCst);
            let child = node_child("process.stdin.resume(); setInterval(() => {}, 1000);");
            Ok((bootstrap('b'), HostChild::new(child)))
        });

        drop(supervisor);

        assert_eq!(launches.load(Ordering::SeqCst), 0);
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
