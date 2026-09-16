//! App-owned scheduling and status for SSH session scans.

use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub host: String,
    pub completed: usize,
    pub total: usize,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    interval_secs: u64,
    progress: Option<Progress>,
    errors: HashMap<String, String>,
}

pub struct State {
    status: Status,
    finished: HashMap<String, Instant>,
}

pub struct Scheduler(Mutex<State>);

fn validate_interval(seconds: u64) -> Result<(), String> {
    if [0, 60, 300, 900, 1800, 3600].contains(&seconds) {
        Ok(())
    } else {
        Err("Unsupported remote scan interval".into())
    }
}

fn due(interval: u64, finished: Option<Instant>, now: Instant) -> bool {
    interval != 0
        && finished.is_none_or(|time| now.duration_since(time) >= Duration::from_secs(interval))
}

#[tauri::command]
pub fn get_remote_sync_status(app: AppHandle) -> Status {
    app.state::<Scheduler>()
        .0
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .status
        .clone()
}

#[tauri::command]
pub fn set_remote_sync_interval(app: AppHandle, seconds: u64) -> Result<(), String> {
    validate_interval(seconds)?;
    let scheduler = app.state::<Scheduler>();
    let mut state = scheduler
        .0
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let path = super::remote_sessions::directory(&app)?.join("scan-interval.json");
    super::remote_sessions::write_private(
        &path,
        &serde_json::to_vec(&seconds).map_err(|e| e.to_string())?,
    )?;
    state.status.interval_secs = seconds;
    let _ = app.emit("remote-sync-status", &state.status);
    Ok(())
}

pub fn progress(app: &AppHandle, progress: Progress) {
    let scheduler = app.state::<Scheduler>();
    let mut state = scheduler
        .0
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    state.status.progress = Some(progress);
    let _ = app.emit("remote-sync-status", &state.status);
}

pub fn finished(app: &AppHandle, host: &str, error: Option<&str>) {
    let scheduler = app.state::<Scheduler>();
    let mut state = scheduler
        .0
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    state.finished.insert(host.into(), Instant::now());
    state.status.progress = None;
    state.status.errors.remove(host);
    if let Some(error) = error {
        state.status.errors.insert(host.into(), error.into());
    }
    let _ = app.emit("remote-sync-status", &state.status);
}

pub fn forget(app: &AppHandle, host: &str) {
    let scheduler = app.state::<Scheduler>();
    let mut state = scheduler
        .0
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    state.finished.remove(host);
    state.status.errors.remove(host);
}

pub fn spawn(app: &AppHandle) -> tauri::async_runtime::JoinHandle<()> {
    let interval_secs = super::remote_sessions::directory(app)
        .and_then(|dir| match std::fs::read(dir.join("scan-interval.json")) {
            Ok(bytes) => serde_json::from_slice::<u64>(&bytes).map_err(|e| e.to_string()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(300),
            Err(error) => Err(error.to_string()),
        })
        .ok()
        .filter(|seconds| validate_interval(*seconds).is_ok())
        .unwrap_or(0);
    app.manage(Scheduler(Mutex::new(State {
        status: Status {
            interval_secs,
            progress: None,
            errors: HashMap::new(),
        },
        finished: HashMap::new(),
    })));
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            if let Ok(hosts) = super::remote_sessions::get_remote_hosts(app.clone()).await {
                for host in hosts {
                    let should_scan = {
                        let scheduler = app.state::<Scheduler>();
                        let state = scheduler
                            .0
                            .lock()
                            .unwrap_or_else(std::sync::PoisonError::into_inner);
                        state.status.progress.is_none()
                            && due(
                                state.status.interval_secs,
                                state.finished.get(&host).copied(),
                                Instant::now(),
                            )
                    };
                    if should_scan {
                        let _ =
                            super::remote_sessions::get_remote_sessions(app.clone(), host, true)
                                .await;
                    }
                }
            }
            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schedule_starts_immediately_and_waits_after_completion() {
        let now = Instant::now();
        assert!(due(300, None, now));
        assert!(!due(0, None, now));
        assert!(!due(300, Some(now), now + Duration::from_secs(299)));
        assert!(due(300, Some(now), now + Duration::from_secs(300)));
        assert!(!due(0, Some(now), now + Duration::from_secs(3600)));
    }

    #[test]
    fn only_supported_intervals_can_be_saved() {
        for seconds in [0, 60, 300, 900, 1800, 3600] {
            assert!(validate_interval(seconds).is_ok());
        }
        for seconds in [1, 59, 301, u64::MAX] {
            assert!(validate_interval(seconds).is_err());
        }
    }
}
