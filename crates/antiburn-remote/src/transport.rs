use crate::{MAX_RESPONSE_BYTES, Request};
use anyhow::{Context, Result, ensure};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub fn validate_host(host: &str) -> Result<()> {
    ensure!(
        !host.is_empty() && host.len() <= 128,
        "Use an SSH config host alias of at most 128 characters"
    );
    ensure!(
        host.as_bytes()[0].is_ascii_alphanumeric()
            && host
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_')),
        "Use an SSH config alias containing only letters, numbers, dots, hyphens or underscores"
    );
    Ok(())
}

pub async fn request(host: &str, request: &Request) -> Result<Vec<u8>> {
    validate_host(host)?;
    request.validate()?;
    let bytes = serde_json::to_vec(request)?;
    let mut child = tokio::process::Command::new("ssh")
        .args([
            "-T",
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=10",
            "-o",
            "StrictHostKeyChecking=yes",
            "-o",
            "ServerAliveInterval=10",
            "-o",
            "ServerAliveCountMax=2",
            "--",
            host,
            "~/.local/bin/antiburn-remote stdio",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .context("Could not start SSH")?;
    let mut stdin = child.stdin.take().context("Missing SSH input")?;
    let stdout = child.stdout.take().context("Missing SSH output")?;
    let stderr = child.stderr.take().context("Missing SSH error stream")?;
    let operation = async {
        stdin.write_all(&bytes).await?;
        stdin.shutdown().await?;
        drop(stdin);
        let read_out = async {
            let mut output = Vec::new();
            stdout
                .take(MAX_RESPONSE_BYTES + 1)
                .read_to_end(&mut output)
                .await?;
            ensure!(
                output.len() as u64 <= MAX_RESPONSE_BYTES,
                "Remote response exceeds 8 MiB"
            );
            Ok::<_, anyhow::Error>(output)
        };
        let read_err = async {
            let mut error = Vec::new();
            stderr.take(8193).read_to_end(&mut error).await?;
            ensure!(error.len() <= 8192, "SSH error output exceeds limit");
            Ok::<_, anyhow::Error>(error)
        };
        let (output, error) = tokio::try_join!(read_out, read_err)?;
        let status = child.wait().await?;
        ensure!(
            status.success(),
            "SSH/helper failed: {}",
            String::from_utf8_lossy(&error).trim()
        );
        Ok(output)
    };
    tokio::time::timeout(Duration::from_secs(60), operation)
        .await
        .context("Remote request timed out after 60 seconds")?
}

/// Stream one bounded bundle into a private staging file.
pub async fn export_to(host: &str, request: &Request, destination: &std::path::Path) -> Result<()> {
    validate_host(host)?;
    request.validate()?;
    ensure!(
        matches!(request, Request::Export { .. }),
        "Expected export request"
    );
    let bytes = serde_json::to_vec(request)?;
    ensure!(bytes.len() <= 8192, "Request exceeds 8 KiB");
    let mut child = tokio::process::Command::new("ssh")
        .args([
            "-T",
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=10",
            "-o",
            "StrictHostKeyChecking=yes",
            "-o",
            "ServerAliveInterval=10",
            "-o",
            "ServerAliveCountMax=2",
            "--",
            host,
            "~/.local/bin/antiburn-remote stdio",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()?;
    let mut stdin = child.stdin.take().context("Missing SSH input")?;
    let stdout = child.stdout.take().context("Missing SSH output")?;
    let stderr = child.stderr.take().context("Missing SSH errors")?;
    let operation = async {
        stdin.write_all(&bytes).await?;
        stdin.shutdown().await?;
        drop(stdin);
        let mut file = tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(destination)
            .await?;
        let limit = crate::export::MAX_BUNDLE_BYTES + crate::export::MAX_MANIFEST_BYTES as u64 + 12;
        let copy = async {
            let copied = tokio::io::copy(&mut stdout.take(limit + 1), &mut file).await?;
            ensure!(copied <= limit, "Bundle exceeds transfer limit");
            file.sync_all().await?;
            Ok::<_, anyhow::Error>(())
        };
        let errors = async {
            let mut bytes = Vec::new();
            stderr.take(8193).read_to_end(&mut bytes).await?;
            ensure!(bytes.len() <= 8192, "SSH error output exceeds limit");
            Ok::<_, anyhow::Error>(bytes)
        };
        let (_, errors) = tokio::try_join!(copy, errors)?;
        ensure!(
            child.wait().await?.success(),
            "SSH/helper failed: {}",
            String::from_utf8_lossy(&errors).trim()
        );
        Ok(())
    };
    tokio::time::timeout(Duration::from_secs(180), operation)
        .await
        .context("Transcript transfer timed out")?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_shell_and_option_injection() {
        for host in [
            "-oProxyCommand=bad",
            "host;id",
            "user@host",
            "host\ncommand",
            "$(id)",
            "../host",
            "",
        ] {
            assert!(validate_host(host).is_err(), "{host}");
        }
        assert!(validate_host("build-box.example").is_ok());
    }
    #[test]
    fn rejects_wrong_protocol_and_unsupported_agents() {
        assert!(Request::List { version: 99 }.validate().is_err());
        assert!(
            Request::Analyze {
                version: 1,
                agent: "other".into(),
                session_id: "synthetic".into()
            }
            .validate()
            .is_err()
        );
    }
}
