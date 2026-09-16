//! Locally observed session lineage.
//!
//! Some vendors let a user branch an existing session into a new one. When
//! discovery can see that relationship in the vendor's own store — a rollout
//! header, a duplicated conversation prefix, a parent id column — it records a
//! [`ForkObservation`] alongside the child session so downstream consumers can
//! attribute inherited work to the parent instead of counting it twice.
//!
//! The observation is *evidence*, not a verdict: `confidence` and
//! `detection_source` describe how the link was found, and consumers decide
//! what to do with it.

use serde::{Deserialize, Serialize};

/// The key under which discovery embeds a [`ForkObservation`] in the synthetic
/// metadata header of a session it renders from a vendor database.
///
/// Adapters that materialize a transcript (Cursor's `store.db` and desktop
/// composer sources, OpenCode's SQLite store) write the observation here so a
/// consumer reading the rendered content can recover it without re-opening the
/// vendor store.
pub const FORK_OBSERVATION_KEY: &str = "local_fork_observation";

/// A locally detected link from a session to the session it was branched from.
///
/// Field names are the serialized contract: adapters embed this verbatim under
/// [`FORK_OBSERVATION_KEY`], and readers deserialize it back.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ForkObservation {
    /// Slug of the agent that owns the parent session (e.g. `"cursor"`).
    pub parent_agent: String,
    /// The parent session's vendor-assigned id.
    pub parent_agent_session_id: String,
    /// Shape of the relationship as the vendor models it (e.g. `"fork"`).
    pub fork_kind: String,
    /// Vendor id of the exact point the child branched from, when the store
    /// records one.
    pub provider_fork_point_id: Option<String>,
    /// How the link was detected (e.g. `"stable_id_prefix"`). Distinguishes a
    /// declared parent from an inferred one.
    pub detection_source: String,
    /// Confidence in the link, 0–100. 100 means the vendor stated it.
    pub confidence: u8,
    /// How many items the child inherited from the parent, when countable.
    pub inherited_item_count: Option<u32>,
    /// Version of the extractor that produced this observation, so a consumer
    /// can tell observations from different detection generations apart.
    pub extractor_version: String,
}

/// Detects that one session was duplicated from another by comparing the two
/// vendor-store payloads.
///
/// Vendors that duplicate a conversation without recording a parent id (Cursor's
/// desktop composers) leave only the copied content as evidence, and how much
/// overlap counts as a fork is a policy decision. Discovery therefore takes the
/// detector from the embedding application instead of hard-coding a threshold;
/// adapters that have no detector configured simply emit no observation for
/// that source.
pub type DuplicateForkDetector =
    fn(parent_store: &str, child_store: &str) -> Option<ForkObservation>;

/// How many leading transcript lines are searched for fork evidence.
/// The evidence is in a metadata header near the start of the transcript.
const FORK_OBSERVATION_LINES: usize = 5;

/// How deep the search descends into a header record. The observation sits at
/// the top level or one nesting down (`metadata`, `raw`); four is slack.
const FORK_OBSERVATION_DEPTH: usize = 4;

/// Read a declared fork parent from a bounded transcript preview.
pub fn fork_parent_from_content(content: &str) -> Option<String> {
    content
        .lines()
        .take(FORK_OBSERVATION_LINES)
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
        .find_map(|value| find_fork_parent(&value, FORK_OBSERVATION_DEPTH))
}

/// Read a fork parent from vendor metadata or a normalized observation.
fn find_fork_parent(value: &serde_json::Value, depth: usize) -> Option<String> {
    if depth == 0 {
        return None;
    }
    let object = value.as_object()?;
    if object.get("type").and_then(serde_json::Value::as_str) == Some("session_meta")
        && let Some(parent_id) = object
            .get("payload")
            .and_then(|payload| payload.get("forked_from_id"))
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|parent_id| !parent_id.is_empty())
    {
        return Some(parent_id.to_string());
    }
    if let Some(observation) = object.get(FORK_OBSERVATION_KEY)
        && let Ok(observation) = serde_json::from_value::<ForkObservation>(observation.clone())
        && !observation.parent_agent_session_id.is_empty()
    {
        return Some(observation.parent_agent_session_id);
    }
    object
        .values()
        .find_map(|nested| find_fork_parent(nested, depth - 1))
}

#[cfg(test)]
mod observation_tests {
    use super::*;
    #[test]
    fn a_fork_observation_is_recovered_from_a_synthetic_header() {
        let header = serde_json::json!({
            "type": "session_meta",
            "metadata": {
                FORK_OBSERVATION_KEY: {
                    "parent_agent": "cursor",
                    "parent_agent_session_id": "parent-42",
                    "fork_kind": "fork",
                    "provider_fork_point_id": serde_json::Value::Null,
                    "detection_source": "stable_id_prefix",
                    "confidence": 100,
                    "inherited_item_count": 12,
                    "extractor_version": "1",
                }
            }
        });
        assert_eq!(
            find_fork_parent(&header, FORK_OBSERVATION_DEPTH).as_deref(),
            Some("parent-42")
        );
    }

    #[test]
    fn a_codex_session_header_declares_its_fork_parent() {
        let header = serde_json::json!({
            "timestamp": "2026-08-22T04:05:01.756Z",
            "type": "session_meta",
            "payload": {
                "id": "child-42",
                "forked_from_id": "parent-42",
                "source": "cli",
                "thread_source": "user",
            }
        });
        assert_eq!(
            find_fork_parent(&header, FORK_OBSERVATION_DEPTH).as_deref(),
            Some("parent-42")
        );
    }

    #[test]
    fn a_codex_fork_parent_requires_a_session_header_and_a_nonempty_id() {
        let message = serde_json::json!({
            "type": "response_item",
            "payload": { "forked_from_id": "not-a-parent" }
        });
        let empty = serde_json::json!({
            "type": "session_meta",
            "payload": { "forked_from_id": "  " }
        });
        assert_eq!(find_fork_parent(&message, FORK_OBSERVATION_DEPTH), None);
        assert_eq!(find_fork_parent(&empty, FORK_OBSERVATION_DEPTH), None);
    }

    #[test]
    fn a_header_without_an_observation_yields_no_parent() {
        let header = serde_json::json!({ "type": "session_meta", "metadata": { "cwd": "/x" } });
        assert_eq!(find_fork_parent(&header, FORK_OBSERVATION_DEPTH), None);
        // A malformed observation is ignored rather than half-read.
        let broken = serde_json::json!({ FORK_OBSERVATION_KEY: { "parent_agent": "cursor" } });
        assert_eq!(find_fork_parent(&broken, FORK_OBSERVATION_DEPTH), None);
    }

    #[test]
    fn the_observation_search_stops_at_its_depth_budget() {
        let deep = serde_json::json!({ "a": { "b": { "c": { "d": {
            FORK_OBSERVATION_KEY: { "parent_agent_session_id": "too-deep" }
        }}}}});
        assert_eq!(find_fork_parent(&deep, FORK_OBSERVATION_DEPTH), None);
    }
}
