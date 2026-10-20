//! Starts and keeps alive the hosted generation runner (`src/runner`, bundled to `runner.mjs`) next to
//! `de-koi-server`.
//!
//! The runner runs chat replies on the server so they finish and save even when the browser tab closes. It is a
//! Node process that talks back to this server's API over loopback. The server image ships the bundle and sets
//! `DE_KOI_RUNNER_SCRIPT`; without it (desktop app, dev servers, bare-metal installs that don't ship it) nothing
//! starts and the web app keeps running replies in the tab.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

const RESTART_DELAY_MIN: Duration = Duration::from_secs(2);
const RESTART_DELAY_MAX: Duration = Duration::from_secs(60);
/// A runner that stayed up this long resets the restart backoff.
const HEALTHY_UPTIME: Duration = Duration::from_secs(120);

/// The runtime URL the runner should call: this server over loopback, on the port it listens on.
pub fn loopback_runtime_url(addr: SocketAddr) -> String {
    format!("http://127.0.0.1:{}", addr.port())
}

/// Spawns the supervisor when `DE_KOI_RUNNER_SCRIPT` points at an existing file. Returns whether it started.
pub fn spawn_if_configured(addr: SocketAddr) -> bool {
    let Some(script) = std::env::var_os("DE_KOI_RUNNER_SCRIPT").map(PathBuf::from) else {
        return false;
    };
    if !script.is_file() {
        eprintln!(
            "[runner] DE_KOI_RUNNER_SCRIPT={} does not exist; replies keep running in the browser tab",
            script.display()
        );
        return false;
    }
    let node = std::env::var("DE_KOI_NODE_BIN").unwrap_or_else(|_| "node".to_string());
    let runtime_url =
        std::env::var("DE_KOI_RUNTIME_URL").unwrap_or_else(|_| loopback_runtime_url(addr));
    tokio::spawn(supervise(node, script, runtime_url));
    true
}

async fn supervise(node: String, script: PathBuf, runtime_url: String) {
    let mut delay = RESTART_DELAY_MIN;
    loop {
        let started = Instant::now();
        let mut command = Command::new(&node);
        command
            .arg("--enable-source-maps")
            .arg(&script)
            .env("DE_KOI_RUNTIME_URL", &runtime_url)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        match command.spawn() {
            Ok(mut child) => {
                if let Some(stdout) = child.stdout.take() {
                    tokio::spawn(forward_lines(stdout));
                }
                if let Some(stderr) = child.stderr.take() {
                    tokio::spawn(forward_lines(stderr));
                }
                match child.wait().await {
                    Ok(status) => eprintln!("[runner] exited with {status}; restarting"),
                    Err(error) => eprintln!("[runner] wait failed: {error}; restarting"),
                }
            }
            Err(error) => eprintln!("[runner] could not start `{node}`: {error}; retrying"),
        }
        delay = if started.elapsed() >= HEALTHY_UPTIME {
            RESTART_DELAY_MIN
        } else {
            (delay * 2).min(RESTART_DELAY_MAX)
        };
        tokio::time::sleep(delay).await;
    }
}

async fn forward_lines<R: tokio::io::AsyncRead + Unpin>(reader: R) {
    let mut lines = BufReader::new(reader).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        eprintln!("{line}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runner_calls_this_server_over_loopback_on_its_port() {
        let addr: SocketAddr = "0.0.0.0:8787".parse().unwrap();
        assert_eq!(loopback_runtime_url(addr), "http://127.0.0.1:8787");
    }
}
