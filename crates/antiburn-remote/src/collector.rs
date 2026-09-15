use std::collections::HashSet;
use std::time::{Duration, Instant};

use antiburn_local::analysis::{
    AppendOnlyGuarantee, RawSource, SessionInput, SessionMetricsAccumulator, SourceClaim,
    SourceFormat, VisitOutcome, reader_for,
};
use antiburn_local::discovery::source_version::FingerprintInputs;
use antiburn_local::discovery::{Explorers, SessionLog, SessionSource, home_dir, session_log_read};
use antiburn_local::model::AgentKind;
use anyhow::{Context, Result, ensure};

use crate::{
    Analysis, LOOKBACK_SECS, MAX_SESSIONS, PROTOCOL_VERSION, RemoteSession, Snapshot, now,
};

struct Entry {
    session: RemoteSession,
    log: SessionLog,
}

async fn discover() -> (Vec<Entry>, bool, usize) {
    let mut logs = Vec::new();
    for agent in [AgentKind::Claude, AgentKind::Codex] {
        logs.extend(
            Explorers::DISK
                .get(&agent)
                .discover_recent(now(), LOOKBACK_SECS)
                .await,
        );
    }
    logs.sort_by_key(|log| std::cmp::Reverse(log.updated_at));
    let truncated = logs.len() > MAX_SESSIONS;
    logs.truncate(MAX_SESSIONS);
    let home = home_dir().unwrap_or_default();
    let mut seen = HashSet::new();
    let mut entries = Vec::new();
    let mut skipped = 0;
    for log in logs {
        if !matches!(log.source, SessionSource::File(_)) {
            skipped += 1;
            continue;
        }
        let Some(read) = session_log_read(&log).await else {
            skipped += 1;
            continue;
        };
        if read.stat.is_none() || read.content.is_none() {
            skipped += 1;
            continue;
        }
        let metadata = read.metadata;
        let Some(id) = metadata.session_id else {
            skipped += 1;
            continue;
        };
        if !seen.insert((log.agent_type, id.clone())) {
            continue;
        }
        let surface = log
            .surface_label_with_content(read.content.as_deref().unwrap_or_default(), &home)
            .to_owned();
        let session = RemoteSession {
            agent: log.agent_type.to_string(),
            session_id: id.clone(),
            title: metadata
                .title
                .unwrap_or_else(|| id.clone())
                .chars()
                .take(200)
                .collect(),
            cwd: metadata.cwd.map(|cwd| cwd.chars().take(1024).collect()),
            surface,
            updated_at: log.updated_at,
        };
        entries.push(Entry { session, log });
    }
    for agent in [AgentKind::Claude, AgentKind::Codex] {
        let ids: Vec<String> = entries
            .iter()
            .filter(|entry| entry.log.agent_type == agent)
            .map(|entry| entry.session.session_id.clone())
            .collect();
        let titles = Explorers::DISK
            .get(&agent)
            .indexed_session_titles(&ids)
            .await;
        for entry in entries
            .iter_mut()
            .filter(|entry| entry.log.agent_type == agent)
        {
            if let Some(title) = titles.get(&entry.session.session_id) {
                entry.session.title = title.text.chars().take(200).collect();
            }
        }
    }
    (entries, truncated, skipped)
}

pub async fn list() -> Snapshot {
    let (entries, truncated, skipped) = discover().await;
    Snapshot {
        version: PROTOCOL_VERSION,
        collected_at: now(),
        sessions: entries.into_iter().map(|entry| entry.session).collect(),
        truncated,
        skipped,
        lookback_secs: LOOKBACK_SECS,
    }
}

pub async fn analyze(agent: &str, session_id: &str) -> Result<Analysis> {
    let (entries, _, _) = discover().await;
    let entry = entries
        .into_iter()
        .find(|entry| entry.session.agent == agent && entry.session.session_id == session_id)
        .context("Session is no longer in the recent discovery window; refresh the host")?;
    let read = session_log_read(&entry.log)
        .await
        .context("Session is unreadable")?;
    let stat = read.stat.context("Session has no file metadata")?;
    ensure!(
        stat.size <= 512 * 1024 * 1024,
        "Session exceeds the 512 MiB analysis limit"
    );
    let claim = SourceClaim::from_fingerprint_inputs(&FingerprintInputs {
        stat,
        head_hash: read.head_hash,
    });
    let SessionSource::File(path) = entry.log.source else {
        anyhow::bail!("Unsupported source")
    };
    let input = SessionInput {
        agent: agent.to_owned(),
        session_id: session_id.to_owned(),
        source: RawSource::File(path),
        source_format: if agent == "codex" {
            SourceFormat::CodexRolloutJsonl
        } else {
            SourceFormat::ClaudeJsonl
        },
        fork_parent_session_id: None,
    };
    let mut sink = SessionMetricsAccumulator::new(agent, session_id);
    let deadline = Instant::now() + Duration::from_secs(40);
    let outcome = reader_for(agent).visit_claimed(
        &input,
        &claim,
        AppendOnlyGuarantee::Absent,
        &|| Instant::now() >= deadline,
        &mut sink,
    )?;
    ensure!(
        Instant::now() < deadline,
        "Analysis exceeded its time limit"
    );
    ensure!(
        matches!(
            outcome,
            VisitOutcome::AcceptedFull | VisitOutcome::AcceptedPrefix { .. }
        ),
        "Session changed during analysis; retry"
    );
    let metrics = sink.metrics();
    ensure!(
        metrics.event_count > 0,
        "No supported metrics were found in this session"
    );
    Ok(Analysis {
        version: PROTOCOL_VERSION,
        collected_at: now(),
        session: entry.session,
        metrics,
        coverage: "Parent transcript only; delegated sessions are not combined. Provider allowances and Burn Checks are not collected.".to_owned(),
    })
}
