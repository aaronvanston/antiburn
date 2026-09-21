//! Bounded transcript bundles for local indexing on another user-owned machine.

use crate::{RemoteSession, collector};
use antiburn_local::discovery::{Explorers, SessionSource};
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{Read, Write},
    path::PathBuf,
};

pub const MAX_BUNDLE_BYTES: u64 = 1024 * 1024 * 1024;
pub const MAX_MANIFEST_BYTES: usize = 1024 * 1024;
pub const MAX_FILES: usize = 512;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleFile {
    pub size: u64,
    pub version: String,
    pub subagent_id: Option<String>,
    pub label: Option<String>,
    pub sidecar_for: Option<usize>,
    #[serde(default)]
    pub fork_parent: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleManifest {
    pub session: RemoteSession,
    pub files: Vec<BundleFile>,
    pub fork_parent_session_id: Option<String>,
}

impl BundleManifest {
    pub fn signature(&self) -> Result<String> {
        Ok(format!("{:x}", Sha256::digest(serde_json::to_vec(self)?)))
    }
    pub fn validate(&self) -> Result<()> {
        let safe_id = safe_identity;
        ensure!(
            safe_id(&self.session.session_id),
            "Invalid transcript identity"
        );
        ensure!(
            self.fork_parent_session_id.as_deref().is_none_or(safe_id),
            "Invalid fork identity"
        );
        ensure!(
            !self.files.is_empty() && self.files.len() <= MAX_FILES,
            "Invalid bundle file count"
        );
        ensure!(
            matches!(self.session.agent.as_str(), "claude-code" | "codex"),
            "Unsupported bundle agent"
        );
        ensure!(
            self.files[0].subagent_id.is_none()
                && self.files[0].sidecar_for.is_none()
                && !self.files[0].fork_parent,
            "Missing parent transcript"
        );
        let mut total = 0u64;
        let mut ids = std::collections::HashSet::new();
        let mut fork_parents = 0;
        let mut sidecars = std::collections::HashSet::new();
        let mut names = std::collections::HashSet::new();
        for (index, file) in self.files.iter().enumerate() {
            total = total
                .checked_add(file.size)
                .context("Bundle size overflow")?;
            ensure!(total <= MAX_BUNDLE_BYTES, "Bundle exceeds 1 GiB");
            if file.fork_parent {
                fork_parents += 1;
                ensure!(
                    fork_parents == 1
                        && self
                            .fork_parent_session_id
                            .as_ref()
                            .is_some_and(|id| id != &self.session.session_id)
                        && file.sidecar_for.is_none()
                        && file.subagent_id.is_none(),
                    "Invalid fork companion"
                );
            } else if let Some(parent) = file.sidecar_for {
                ensure!(
                    parent < index
                        && self.files[parent].sidecar_for.is_none()
                        && sidecars.insert(parent),
                    "Invalid sidecar reference"
                );
                ensure!(
                    file.size <= 64 * 1024 && file.subagent_id.is_none(),
                    "Invalid sidecar"
                );
            } else if index != 0 {
                let id = file
                    .subagent_id
                    .as_ref()
                    .context("Missing subagent identity")?;
                ensure!(safe_id(id) && ids.insert(id), "Invalid subagent identity");
            }
            ensure!(names.insert(self.file_name(index)), "Duplicate bundle path");
        }
        Ok(())
    }
    pub fn file_name(&self, index: usize) -> String {
        let file = &self.files[index];
        if file.fork_parent {
            return format!(
                "{}.jsonl",
                self.fork_parent_session_id.as_deref().unwrap_or("invalid")
            );
        }
        if let Some(parent) = file.sidecar_for {
            return self.file_name(parent).trim_end_matches(".jsonl").to_owned() + ".meta.json";
        }
        match &file.subagent_id {
            Some(id) => format!(
                "{}/subagents/agent-{}.jsonl",
                self.session.session_id,
                id.strip_prefix("agent-").unwrap_or(id)
            ),
            None => format!("{}.jsonl", self.session.session_id),
        }
    }
}

fn safe_identity(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 200
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
}

fn version(file: &File) -> Result<String> {
    let stat = file.metadata()?;
    ensure!(stat.is_file(), "Transcript is not a regular file");
    Ok(format!(
        "{}:{}",
        stat.len(),
        stat.modified()?
            .duration_since(std::time::UNIX_EPOCH)?
            .as_nanos()
    ))
}

type CompanionPath = (PathBuf, Option<String>, Option<String>, Option<usize>);

pub async fn write_bundle(
    agent: &str,
    session_id: &str,
    known: Option<&str>,
    out: &mut impl Write,
) -> Result<()> {
    let (entries, _, _) = collector::discover_matching(Some((agent, session_id))).await;
    let entry = entries
        .into_iter()
        .find(|entry| entry.session.agent == agent && entry.session.session_id == session_id)
        .context("Session is no longer discoverable; refresh the host")?;
    let SessionSource::File(parent) = &entry.log.source else {
        anyhow::bail!("Unsupported source")
    };
    let mut children = Explorers::DISK
        .list_subagents_for_transcript(&entry.log.agent_type, parent)
        .await;
    children.sort();
    let mut paths: Vec<CompanionPath> = vec![(parent.clone(), None, None, None)];
    for path in children {
        let id = Explorers::DISK
            .subagent_id(&entry.log.agent_type, &path)
            .context("Missing subagent identity")?;
        let label = Explorers::DISK
            .subagent_label(&entry.log.agent_type, &path)
            .await;
        paths.push((path, Some(id), Some(label), None));
    }
    if agent == "claude-code" {
        let sidecars: Vec<_> = paths
            .iter()
            .enumerate()
            .filter_map(|(index, (path, _, _, _))| {
                let sidecar = path.with_extension("meta.json");
                sidecar
                    .exists()
                    .then_some((sidecar, None, None, Some(index)))
            })
            .collect();
        paths.extend(sidecars);
    }
    let preview = antiburn_local::discovery::session_log_read(&entry.log).await;
    let fork_parent_session_id = preview
        .and_then(|read| read.content)
        .and_then(|content| antiburn_local::discovery::fork::fork_parent_from_content(&content));
    if agent == "claude-code"
        && let Some(id) = &fork_parent_session_id
    {
        ensure!(
            safe_identity(id) && id != session_id,
            "Invalid fork identity"
        );
        let path = parent.with_file_name(format!("{id}.jsonl"));
        if path.is_file() {
            paths.push((path, None, None, None));
        }
    }
    ensure!(paths.len() <= MAX_FILES, "Too many companion transcripts");
    let mut files = Vec::new();
    let mut descriptors = Vec::new();
    for (path, subagent_id, label, sidecar_for) in paths {
        let fork_parent = path != *parent && subagent_id.is_none() && sidecar_for.is_none();
        let file = File::open(path)?;
        let version = version(&file)?;
        descriptors.push(BundleFile {
            size: file.metadata()?.len(),
            version,
            subagent_id,
            label,
            sidecar_for,
            fork_parent,
        });
        files.push(file);
    }
    let manifest = BundleManifest {
        session: entry.session,
        files: descriptors,
        fork_parent_session_id,
    };
    manifest.validate()?;
    let header = serde_json::to_vec(&manifest)?;
    ensure!(header.len() <= MAX_MANIFEST_BYTES, "Manifest exceeds limit");
    let unchanged = known == Some(manifest.signature()?.as_str());
    out.write_all(if unchanged { b"ABR2SAME" } else { b"ABR2DATA" })?;
    out.write_all(&(header.len() as u32).to_le_bytes())?;
    out.write_all(&header)?;
    if unchanged {
        return Ok(());
    }
    for (index, file) in files.iter_mut().enumerate() {
        let copied = std::io::copy(&mut file.take(manifest.files[index].size), out)?;
        ensure!(
            copied == manifest.files[index].size && version(file)? == manifest.files[index].version,
            "Session changed during transfer; retry"
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest() -> BundleManifest {
        BundleManifest {
            session: RemoteSession {
                agent: "claude-code".into(),
                session_id: "parent".into(),
                title: "Synthetic".into(),
                cwd: None,
                surface: "cli".into(),
                updated_at: Some(1),
            },
            files: vec![BundleFile {
                size: 10,
                version: "10:1".into(),
                subagent_id: None,
                label: None,
                sidecar_for: None,
                fork_parent: false,
            }],
            fork_parent_session_id: None,
        }
    }

    #[test]
    fn bundle_preserves_companion_paths_without_accepting_arbitrary_paths() {
        let mut bundle = manifest();
        let mut child = bundle.files[0].clone();
        child.subagent_id = Some("child".into());
        bundle.files.push(child);
        let mut sidecar = bundle.files[0].clone();
        sidecar.sidecar_for = Some(1);
        bundle.files.push(sidecar);
        bundle.validate().unwrap();
        assert_eq!(bundle.file_name(1), "parent/subagents/agent-child.jsonl");
        assert_eq!(
            bundle.file_name(2),
            "parent/subagents/agent-child.meta.json"
        );
        bundle.files[1].subagent_id = Some("../../escape".into());
        assert!(bundle.validate().is_err());
    }

    #[test]
    fn bundle_rejects_duplicate_children_recursive_sidecars_and_oversize() {
        let mut bundle = manifest();
        bundle.files[0].size = MAX_BUNDLE_BYTES + 1;
        assert!(bundle.validate().is_err());
        bundle.files[0].size = 10;
        let mut child = bundle.files[0].clone();
        child.subagent_id = Some("child".into());
        bundle.files.extend([child.clone(), child]);
        assert!(bundle.validate().is_err());
        bundle.files.pop();
        bundle.files[1].subagent_id = None;
        bundle.files[1].sidecar_for = Some(1);
        assert!(bundle.validate().is_err());
    }

    #[test]
    fn fork_companion_keeps_sibling_layout_and_changes_the_bundle_signature() {
        let mut bundle = manifest();
        let before = bundle.signature().unwrap();
        bundle.fork_parent_session_id = Some("ancestor".into());
        let mut parent = bundle.files[0].clone();
        parent.fork_parent = true;
        bundle.files.push(parent);
        bundle.validate().unwrap();
        assert_eq!(bundle.file_name(1), "ancestor.jsonl");
        assert_ne!(bundle.signature().unwrap(), before);
        bundle.fork_parent_session_id = Some("parent".into());
        assert!(bundle.validate().is_err());
    }
}
