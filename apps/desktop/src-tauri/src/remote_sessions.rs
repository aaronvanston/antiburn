//! Explicit SSH collection with a private, bounded last-successful snapshot.

use antiburn_remote::{Analysis, PROTOCOL_VERSION, Request, Snapshot, transport};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};
use tokio::sync::Semaphore;

static REQUESTS: OnceLock<Semaphore> = OnceLock::new();

fn directory(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("remote-sessions");
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| e.to_string())?;
    }
    Ok(path)
}

fn read_hosts(app: &AppHandle) -> Result<Vec<String>, String> {
    let path = directory(app)?.join("hosts.json");
    if !path.exists() {
        return Ok(Vec::new());
    }
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    if bytes.len() > 4096 {
        return Err("Remote host configuration exceeds limit".into());
    }
    let hosts: Vec<String> = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    validate_hosts(&hosts)?;
    Ok(hosts)
}

fn validate_hosts(hosts: &[String]) -> Result<(), String> {
    if hosts.len() > 8 {
        return Err("At most eight remote hosts are supported".into());
    }
    let mut unique = std::collections::HashSet::new();
    for host in hosts {
        transport::validate_host(host).map_err(|e| e.to_string())?;
        if !unique.insert(host) {
            return Err("Duplicate SSH host alias".into());
        }
    }
    Ok(())
}

fn write_private(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let temp = path.with_extension("tmp");
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temp).map_err(|e| e.to_string())?;
    file.write_all(bytes).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    std::fs::rename(temp, path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_remote_hosts(app: AppHandle) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || read_hosts(&app))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_remote_hosts(app: AppHandle, hosts: Vec<String>) -> Result<(), String> {
    let _permit = REQUESTS
        .get_or_init(|| Semaphore::new(1))
        .acquire()
        .await
        .map_err(|e| e.to_string())?;

    validate_hosts(&hosts)?;
    tauri::async_runtime::spawn_blocking(move || {
        let previous = read_hosts(&app)?;
        let dir = directory(&app)?;
        write_private(
            &dir.join("hosts.json"),
            &serde_json::to_vec(&hosts).map_err(|e| e.to_string())?,
        )?;
        for host in previous.into_iter().filter(|host| !hosts.contains(host)) {
            let path = dir.join(format!("{host}.snapshot.json"));
            if path.exists() {
                std::fs::remove_file(path).map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostSnapshot {
    host: String,
    snapshot: Option<Snapshot>,
    error: Option<String>,
    connected: bool,
}

#[tauri::command]
pub async fn get_remote_sessions(
    app: AppHandle,
    host: String,
    refresh: bool,
) -> Result<HostSnapshot, String> {
    let _permit = REQUESTS
        .get_or_init(|| Semaphore::new(1))
        .acquire()
        .await
        .map_err(|e| e.to_string())?;

    transport::validate_host(&host).map_err(|e| e.to_string())?;
    let app_copy = app.clone();
    let host_copy = host.clone();
    let (path, cached) = tauri::async_runtime::spawn_blocking(move || {
        if !read_hosts(&app_copy)?.contains(&host_copy) {
            return Err("Host is not configured".to_owned());
        }
        let path = directory(&app_copy)?.join(format!("{host_copy}.snapshot.json"));
        let cached = std::fs::metadata(&path)
            .ok()
            .filter(|m| m.len() <= antiburn_remote::MAX_RESPONSE_BYTES)
            .and_then(|_| std::fs::read(&path).ok())
            .and_then(|bytes| serde_json::from_slice::<Snapshot>(&bytes).ok())
            .filter(|snapshot| snapshot.version == PROTOCOL_VERSION);
        Ok((path, cached))
    })
    .await
    .map_err(|e| e.to_string())??;
    if !refresh {
        return Ok(HostSnapshot {
            host,
            snapshot: cached,
            error: None,
            connected: false,
        });
    }
    let result = async {
        let bytes = transport::request(
            &host,
            &Request::List {
                version: PROTOCOL_VERSION,
            },
        )
        .await?;
        let snapshot: Snapshot = serde_json::from_slice(&bytes)?;
        anyhow::ensure!(
            snapshot.version == PROTOCOL_VERSION
                && snapshot.sessions.len() <= antiburn_remote::MAX_SESSIONS,
            "Remote helper protocol mismatch"
        );
        tauri::async_runtime::spawn_blocking(move || write_private(&path, &bytes))
            .await?
            .map_err(anyhow::Error::msg)?;
        Ok::<_, anyhow::Error>(snapshot)
    }
    .await;
    Ok(match result {
        Ok(snapshot) => HostSnapshot {
            host,
            snapshot: Some(snapshot),
            error: None,
            connected: true,
        },
        Err(error) => HostSnapshot {
            host,
            snapshot: cached,
            error: Some(error.to_string()),
            connected: false,
        },
    })
}

#[tauri::command]
pub async fn analyze_remote_session(
    app: AppHandle,
    host: String,
    agent: String,
    session_id: String,
) -> Result<Analysis, String> {
    let _permit = REQUESTS
        .get_or_init(|| Semaphore::new(1))
        .acquire()
        .await
        .map_err(|e| e.to_string())?;

    let checked_host = host.clone();
    let configured = tauri::async_runtime::spawn_blocking(move || {
        read_hosts(&app).map(|hosts| hosts.contains(&checked_host))
    })
    .await
    .map_err(|e| e.to_string())??;
    if !configured {
        return Err("Host is not configured".into());
    }
    let bytes = transport::request(
        &host,
        &Request::Analyze {
            version: PROTOCOL_VERSION,
            agent: agent.clone(),
            session_id: session_id.clone(),
        },
    )
    .await
    .map_err(|e| e.to_string())?;
    let analysis: Analysis = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    if analysis.version != PROTOCOL_VERSION
        || analysis.session.agent != agent
        || analysis.session.session_id != session_id
    {
        return Err("Remote analysis identity or protocol mismatch".into());
    }
    Ok(analysis)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_configuration_rejects_duplicates_and_oversize_lists() {
        assert!(validate_hosts(&["test-box".into(), "test-box".into()]).is_err());
        assert!(validate_hosts(&(0..9).map(|i| format!("test-{i}")).collect::<Vec<_>>()).is_err());
        assert!(validate_hosts(&["test-box".into(), "other-box".into()]).is_ok());
    }

    #[test]
    fn private_snapshot_replacement_leaves_no_partial_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("snapshot.json");
        write_private(&path, b"first").unwrap();
        write_private(&path, b"second").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"second");
        assert!(!path.with_extension("tmp").exists());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }
}
