use serde_json::{Value, json};
use std::io::Write;
use std::process::{Command, Output, Stdio};

fn call(home: &std::path::Path, request: Value) -> Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_antiburn-remote"))
        .arg("stdio")
        .env("HOME", home)
        .env("CODEX_HOME", home.join(".codex"))
        .env("CLAUDE_CONFIG_DIR", home.join(".claude"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(&serde_json::to_vec(&request).unwrap())
        .unwrap();
    child.wait_with_output().unwrap()
}

#[test]
fn discovers_and_analyzes_synthetic_codex_without_exporting_messages() {
    let home = tempfile::tempdir().unwrap();
    let today = time::OffsetDateTime::now_utc();
    let dir = home.path().join(format!(
        ".codex/sessions/{}/{:02}/{:02}",
        today.year(),
        today.month() as u8,
        today.day()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let fixture = include_str!(
        "../../antiburn-local/tests/fixtures/codex_characterization/task_complete_errors.jsonl"
    );
    std::fs::write(dir.join("rollout-synthetic.jsonl"), fixture).unwrap();
    std::fs::write(
        home.path().join(".codex/session_index.jsonl"),
        r#"{"id":"synthetic-task-complete-errors","thread_name":"Synthetic saved task title"}"#,
    )
    .unwrap();
    let result = call(home.path(), json!({"operation":"list","version":1}));
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let snapshot: Value = serde_json::from_slice(&result.stdout).unwrap();
    assert_eq!(snapshot["sessions"].as_array().unwrap().len(), 1);
    assert_eq!(
        snapshot["sessions"][0]["title"],
        "Synthetic saved task title"
    );
    let id = snapshot["sessions"][0]["sessionId"].as_str().unwrap();
    let result = call(
        home.path(),
        json!({"operation":"analyze","version":1,"agent":"codex","session_id":id}),
    );
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let analysis: Value = serde_json::from_slice(&result.stdout).unwrap();
    assert_eq!(analysis["session"]["sessionId"], id);
    assert!(analysis["metrics"]["tokensOut"].as_u64().unwrap() > 0);
    assert!(!String::from_utf8_lossy(&result.stdout).contains("Synthetic check passed."));
    assert!(
        analysis["coverage"]
            .as_str()
            .unwrap()
            .contains("Parent transcript only")
    );
}

#[test]
fn unknown_session_cannot_select_an_arbitrary_file() {
    let home = tempfile::tempdir().unwrap();
    let result = call(
        home.path(),
        json!({"operation":"analyze","version":1,"agent":"claude-code","session_id":"../../secret"}),
    );
    assert!(!result.status.success());
    assert!(result.stdout.is_empty());
}

#[test]
fn protocol_mismatch_produces_no_snapshot() {
    let home = tempfile::tempdir().unwrap();
    let result = call(home.path(), json!({"operation":"list","version":999}));
    assert!(!result.status.success());
    assert!(result.stdout.is_empty());
}

#[test]
fn exports_claude_companions_and_skips_only_unchanged_bundles() {
    let home = tempfile::tempdir().unwrap();
    let project = home.path().join(".claude/projects/synthetic");
    let children = project.join("parent/subagents");
    std::fs::create_dir_all(&children).unwrap();
    let content = r#"{"type":"user","sessionId":"parent","cwd":"/synthetic/project","message":{"role":"user","content":"Synthetic task"}}
{"type":"assistant","sessionId":"parent","message":{"role":"assistant","model":"claude-sonnet-4-6","content":[{"type":"text","text":"Synthetic answer"}],"usage":{"input_tokens":10,"output_tokens":2}}}
"#;
    std::fs::write(project.join("parent.jsonl"), content).unwrap();
    std::fs::write(
        children.join("agent-child.jsonl"),
        content.replace("parent", "child"),
    )
    .unwrap();
    std::fs::write(
        children.join("agent-child.meta.json"),
        r#"{"toolUseId":"synthetic-tool"}"#,
    )
    .unwrap();
    let request = json!({"operation":"export","version":1,"agent":"claude-code","session_id":"parent","known":null});
    let first = call(home.path(), request.clone());
    assert!(
        first.status.success(),
        "{}",
        String::from_utf8_lossy(&first.stderr)
    );
    assert_eq!(&first.stdout[..8], b"ABR2DATA");
    let length = u32::from_le_bytes(first.stdout[8..12].try_into().unwrap()) as usize;
    let manifest: antiburn_remote::export::BundleManifest =
        serde_json::from_slice(&first.stdout[12..12 + length]).unwrap();
    manifest.validate().unwrap();
    assert_eq!(manifest.files.len(), 3);
    assert_eq!(
        first.stdout.len(),
        12 + length
            + manifest
                .files
                .iter()
                .map(|file| file.size as usize)
                .sum::<usize>()
    );
    assert!(
        manifest
            .files
            .iter()
            .any(|file| file.subagent_id.as_deref() == Some("agent-child"))
    );
    assert_eq!(manifest.file_name(1), "parent/subagents/agent-child.jsonl");
    assert_eq!(
        manifest.file_name(2),
        "parent/subagents/agent-child.meta.json"
    );
    let mut known = request;
    known["known"] = json!(manifest.signature().unwrap());
    let second = call(home.path(), known.clone());
    assert!(second.status.success());
    assert_eq!(&second.stdout[..8], b"ABR2SAME");
    assert_eq!(second.stdout.len(), 12 + length);
    std::fs::write(
        children.join("agent-child.meta.json"),
        r#"{"toolUseId":"changed-tool","agentType":"Explore"}"#,
    )
    .unwrap();
    let changed = call(home.path(), known);
    assert!(changed.status.success());
    assert_eq!(&changed.stdout[..8], b"ABR2DATA");
    assert_eq!(
        std::fs::read_to_string(project.join("parent.jsonl")).unwrap(),
        content
    );
}
