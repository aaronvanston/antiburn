//! Versioned, read-only session collection over a user-owned SSH connection.

pub mod collector;
pub mod export;
pub mod transport;

use antiburn_local::analysis::SessionMetrics;
use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u32 = 1;
pub const MAX_SESSIONS: usize = 200;
pub const MAX_RESPONSE_BYTES: u64 = 8 * 1024 * 1024;
pub const LOOKBACK_SECS: i64 = 7 * 24 * 60 * 60;

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "operation", rename_all = "camelCase", deny_unknown_fields)]
pub enum Request {
    List {
        version: u32,
    },
    Export {
        version: u32,
        agent: String,
        session_id: String,
        known: Option<String>,
    },
    Analyze {
        version: u32,
        agent: String,
        session_id: String,
    },
}

impl Request {
    pub fn validate(&self) -> anyhow::Result<()> {
        if let Self::Export {
            known: Some(known), ..
        } = self
        {
            anyhow::ensure!(
                known.len() == 64 && known.bytes().all(|b| b.is_ascii_hexdigit()),
                "Invalid bundle signature"
            );
        }
        let version = match self {
            Self::List { version } => *version,
            Self::Export {
                version,
                agent,
                session_id,
                ..
            }
            | Self::Analyze {
                version,
                agent,
                session_id,
            } => {
                anyhow::ensure!(
                    matches!(agent.as_str(), "claude-code" | "codex"),
                    "Unsupported remote agent"
                );
                anyhow::ensure!(
                    !session_id.is_empty() && session_id.len() <= 200,
                    "Invalid session identity"
                );
                *version
            }
        };
        anyhow::ensure!(
            version == PROTOCOL_VERSION,
            "Remote helper protocol mismatch; update the helper"
        );
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSession {
    pub agent: String,
    pub session_id: String,
    pub title: String,
    pub cwd: Option<String>,
    pub surface: String,
    pub updated_at: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub version: u32,
    pub collected_at: i64,
    pub sessions: Vec<RemoteSession>,
    pub truncated: bool,
    pub skipped: usize,
    pub lookback_secs: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Analysis {
    pub version: u32,
    pub collected_at: i64,
    pub session: RemoteSession,
    pub metrics: SessionMetrics,
    pub coverage: String,
}

pub fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
