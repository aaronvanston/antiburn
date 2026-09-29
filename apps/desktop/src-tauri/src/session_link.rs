//! Open the main window on one session from an `antiburn://session/<id>` link.
//!
//! Any web page or local program can open a custom-scheme link, so this
//! module treats each link as untrusted input. A link can only select a
//! session that the local index already holds. The lookup reads only that
//! index. The main window then shows the session as a click in the Sessions
//! list does. A link does not open files, run commands, change settings, or
//! start a scan. The raw link and the session ID never go to the log or to
//! analytics.
//!
//! The accepted form is `antiburn://session/<id>` with an optional
//! `?agent=<slug>` query. See `docs/session-links.md`.

use antiburn_local::model::AgentKind;
use tauri::{AppHandle, Manager as _, Url};
use tauri_plugin_deep_link::DeepLinkExt as _;

use crate::analytics::event::SessionLinkOutcome;
use crate::main_window::{self, SessionTarget};
use crate::store::Store;

/// The only route that a link can name.
const ROUTE: &str = "session";

/// The longest session ID that a link can carry. Agent session IDs that
/// antiburn reads are UUIDs or shorter tokens, so this limit is generous.
const MAX_SESSION_ID_BYTES: usize = 128;

/// The query key for the optional agent hint.
const AGENT_KEY: &str = "agent";

/// One validated link.
#[derive(Clone, Debug, PartialEq, Eq)]
struct SessionLink {
    /// The agent-owned session ID, exactly as the agent wrote it.
    session_id: String,
    /// The agent that owns the session, if the link names one.
    agent: Option<AgentKind>,
}

/// Read the link schemes from the deep-link plugin configuration.
///
/// The bundle registers the same list with the operating system, so the
/// parser accepts only the scheme that this build owns. The installed app
/// owns `antiburn`. `tauri.debug.conf.json` gives debug builds
/// `antiburn-debug`, so that a debug bundle cannot take the installed app's
/// links. A configuration without schemes accepts no links.
fn schemes_from_config(deep_link: Option<&serde_json::Value>) -> Vec<String> {
    deep_link
        .and_then(|config| config.get("desktop"))
        .and_then(|desktop| desktop.get("schemes"))
        .and_then(serde_json::Value::as_array)
        .map(|schemes| {
            schemes
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn registered_schemes(app: &AppHandle) -> Vec<String> {
    schemes_from_config(app.config().plugins.0.get("deep-link"))
}

/// Validate one link. Return `None` for all other input.
///
/// The URL parser makes the scheme lowercase. All other parts must match
/// exactly: the host is `session`, the path is one ID segment, and the only
/// query is one known `agent` slug. A link with a user, a password, a port,
/// a fragment, other query keys, or percent-encoded text is not accepted.
fn parse(url: &Url, schemes: &[String]) -> Option<SessionLink> {
    if !schemes.iter().any(|scheme| scheme == url.scheme())
        || url.cannot_be_a_base()
        || url.host_str() != Some(ROUTE)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.fragment().is_some()
    {
        return None;
    }
    let session_id = url.path().strip_prefix('/')?;
    if !valid_session_id(session_id) {
        return None;
    }
    let agent = match url.query() {
        None => None,
        Some(query) => {
            let slug = query.strip_prefix(AGENT_KEY)?.strip_prefix('=')?;
            Some(AgentKind::from_slug(slug)?)
        }
    };
    Some(SessionLink {
        session_id: session_id.to_owned(),
        agent,
    })
}

/// Accept 1 to [`MAX_SESSION_ID_BYTES`] ASCII letters, digits, `-`, `_`, or
/// `.`. This excludes `/`, `%`, spaces, and control characters.
fn valid_session_id(session_id: &str) -> bool {
    !session_id.is_empty()
        && session_id.len() <= MAX_SESSION_ID_BYTES
        && session_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

/// Find the one cached session that a link names.
///
/// A native session comes before a WSL or remote copy of the same session.
/// Other copies come in environment key order. If the ID belongs to sessions
/// of more than one agent and the link has no agent hint, the link is
/// ambiguous, and the result is `None`.
fn resolve(store: &Store, link: &SessionLink) -> Result<Option<SessionTarget>, String> {
    let keys = store
        .session_keys_for_id(&link.session_id, link.agent.map(AgentKind::slug))
        .map_err(|error| error.to_string())?;
    let Some(first) = keys.first() else {
        return Ok(None);
    };
    if keys.iter().any(|key| key.agent != first.agent) {
        return Ok(None);
    }
    let record = store.session(first).map_err(|error| error.to_string())?;
    Ok(record.as_ref().map(SessionTarget::for_record))
}

/// Start to receive session links. Call once, at the end of setup.
///
/// The listener comes first, so that no link is lost between the two steps.
/// A link that started the app is read after that. On macOS the system sends
/// that link after setup, so the listener receives it.
pub(crate) fn install(app: &AppHandle) {
    let listener_app = app.clone();
    app.deep_link().on_open_url(move |event| {
        open_urls(&listener_app, &event.urls());
    });
    match app.deep_link().get_current() {
        Ok(Some(urls)) => open_urls(app, &urls),
        Ok(None) => {}
        Err(error) => {
            ::tracing::warn!(event = "session_link_current_failed", error = %error);
        }
    }
}

/// Open the last valid session link in `urls`. Ignore all other links.
fn open_urls(app: &AppHandle, urls: &[Url]) {
    let schemes = registered_schemes(app);
    let Some(link) = urls.iter().rev().find_map(|url| parse(url, &schemes)) else {
        ::tracing::info!(event = "session_link_ignored", count = urls.len());
        return;
    };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let lookup_app = app.clone();
        let lookup = tauri::async_runtime::spawn_blocking(move || {
            resolve(&lookup_app.state::<crate::UiReadStore>().0, &link)
        })
        .await
        .map_err(|error| error.to_string())
        .and_then(|result| result);
        let target = match lookup {
            Ok(target) => Some(target),
            Err(error) => {
                ::tracing::warn!(event = "session_link_lookup_failed", error = %error);
                None
            }
        };
        main_window::on_main(&app, move |app| open_resolved(app, target));
    });
}

/// Show the result of one lookup. `None` means the lookup failed: the main
/// window opens on Sessions and no analytics event is recorded.
fn open_resolved(app: &AppHandle, lookup: Option<Option<SessionTarget>>) {
    if crate::onboarding::is_pending(app) {
        // Setup is not complete, so the main window is not available yet.
        ::tracing::info!(event = "session_link_deferred");
        if let Err(error) = crate::open_launch_surface(app, main_window::OpenTrigger::Interaction) {
            ::tracing::warn!(
                event = "launch_surface_open_failed",
                trigger = "session_link",
                error = %error
            );
        }
        return;
    }
    let (target, outcome) = match lookup {
        Some(Some(target)) => (Some(target), Some(SessionLinkOutcome::Found)),
        Some(None) => (None, Some(SessionLinkOutcome::NotFound)),
        None => (None, None),
    };
    match main_window::route_session_link(app, target) {
        Ok(()) => {
            let result = match outcome {
                Some(SessionLinkOutcome::Found) => "found",
                Some(SessionLinkOutcome::NotFound) => "not_found",
                None => "lookup_failed",
            };
            ::tracing::info!(event = "session_link_opened", result);
            if let Some(outcome) = outcome {
                crate::analytics::record_session_link_opened(app, outcome);
            }
        }
        Err(error) => {
            ::tracing::warn!(event = "session_link_open_failed", error = %error);
        }
    }
}

/// Tell if a second process's arguments are only a session link.
///
/// On Windows and Linux the system starts a new process with the link as its
/// only argument. The single-instance plugin gives the link to the deep-link
/// plugin first, so the first process does not also open its launch surface.
pub(crate) fn forwards_link(app: &AppHandle, args: &[String]) -> bool {
    cfg!(any(windows, target_os = "linux")) && is_link_argument(args, &registered_schemes(app))
}

fn is_link_argument(args: &[String], schemes: &[String]) -> bool {
    match args {
        [_executable, argument] => argument
            .parse::<Url>()
            .is_ok_and(|url| schemes.iter().any(|scheme| scheme == url.scheme())),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{SessionKey, SessionRecord};

    const ID: &str = "0199b7a2-6f3e-7c41-9d2a-5b8e4f1c2a90";
    const SCHEME: &str = "antiburn";

    fn schemes() -> Vec<String> {
        vec![SCHEME.to_owned()]
    }

    fn link(text: &str) -> Option<SessionLink> {
        parse(
            &text.replace("{scheme}", SCHEME).parse::<Url>().ok()?,
            &schemes(),
        )
    }

    fn expected(session_id: &str, agent: Option<AgentKind>) -> Option<SessionLink> {
        Some(SessionLink {
            session_id: session_id.to_owned(),
            agent,
        })
    }

    #[test]
    fn a_session_link_names_one_session_id() {
        assert_eq!(
            link(&format!("{{scheme}}://session/{ID}")),
            expected(ID, None)
        );
        assert_eq!(
            link("{scheme}://session/ses_2Qx.v1"),
            expected("ses_2Qx.v1", None)
        );
        assert_eq!(
            link(&format!("{{scheme}}://session/{ID}?agent=codex")),
            expected(ID, Some(AgentKind::Codex))
        );
        assert_eq!(
            link(&format!("{{scheme}}://session/{ID}?agent=claude-code")),
            expected(ID, Some(AgentKind::Claude))
        );
    }

    #[test]
    fn the_parser_makes_only_the_scheme_lowercase() {
        let upper = format!("{}://session/{ID}", SCHEME.to_ascii_uppercase());
        assert_eq!(link(&upper), expected(ID, None));
        assert_eq!(link(&format!("{{scheme}}://SESSION/{ID}")), None);
        assert_eq!(
            link("{scheme}://session/AbC-123"),
            expected("AbC-123", None)
        );
    }

    #[test]
    fn a_link_with_any_other_part_is_ignored() {
        let longest = "a".repeat(MAX_SESSION_ID_BYTES);
        assert_eq!(
            link(&format!("{{scheme}}://session/{longest}")),
            expected(&longest, None)
        );
        for rejected in [
            "{scheme}://session".to_owned(),
            "{scheme}://session/".to_owned(),
            format!("{{scheme}}://session/{ID}/"),
            format!("{{scheme}}://session/{ID}/extra"),
            format!(
                "{{scheme}}://session/{}",
                "a".repeat(MAX_SESSION_ID_BYTES + 1)
            ),
            "{scheme}://session/a%2Fb".to_owned(),
            "{scheme}://session/a%20b".to_owned(),
            "{scheme}://session/a:b".to_owned(),
            "{scheme}://session/a~b".to_owned(),
            "{scheme}://session/%C3%A9".to_owned(),
            format!("{{scheme}}://session/{ID}#details"),
            format!("{{scheme}}://user@session/{ID}"),
            format!("{{scheme}}://user:secret@session/{ID}"),
            format!("{{scheme}}://session:8080/{ID}"),
            format!("{{scheme}}://session/{ID}?"),
            format!("{{scheme}}://session/{ID}?agent="),
            format!("{{scheme}}://session/{ID}?agent=unknown"),
            format!("{{scheme}}://session/{ID}?agent=Codex"),
            format!("{{scheme}}://session/{ID}?agent=codex&agent=codex"),
            format!("{{scheme}}://session/{ID}?agent=codex&path=/tmp"),
            format!("{{scheme}}://session/{ID}?file=/etc/passwd"),
            format!("{{scheme}}://session/{ID}?agentx=codex"),
            format!("{{scheme}}://settings/{ID}"),
            format!("{{scheme}}://scan/{ID}"),
            format!("{{scheme}}:session/{ID}"),
            format!("{{scheme}}:///session/{ID}"),
            format!("{{scheme}}://session.example/{ID}"),
            format!("https://session/{ID}"),
            format!("file:///session/{ID}"),
        ] {
            assert_eq!(link(&rejected), None, "{rejected}");
        }
        assert_eq!(link(&format!("antiburn-debug://session/{ID}")), None);
        let url = format!("{SCHEME}://session/{ID}").parse::<Url>().unwrap();
        assert_eq!(
            parse(&url, &[]),
            None,
            "no configured scheme accepts no link"
        );
    }

    #[test]
    fn a_session_id_uses_a_small_character_set() {
        assert!(valid_session_id("T-0199b7a2.6f3e_7c41"));
        assert!(!valid_session_id(""));
        for rejected in ["a b", "a/b", "a\\b", "a%b", "a\nb", "a\0b", "é", "a?b"] {
            assert!(!valid_session_id(rejected), "{rejected:?}");
        }
    }

    fn store() -> Store {
        Store::open_in_memory(std::path::Path::new("/tmp/session-link-tests")).expect("open store")
    }

    fn record(key: SessionKey, wsl_distro: Option<&str>) -> SessionRecord {
        SessionRecord {
            source_label: format!("/sessions/{}.jsonl", key.session_id),
            key,
            source_kind: "file".to_owned(),
            wsl_distro: wsl_distro.map(str::to_owned),
            title: None,
            title_source: None,
            cwd: None,
            surface: "cli".to_owned(),
            updated_at_epoch: Some(1),
            activity_cursor: String::new(),
            activity_source: "mtime".to_owned(),
            subagent_count: 0,
            fork_parent_session_id: None,
            source_fingerprint: None,
        }
    }

    fn native(agent: &str, session_id: &str) -> SessionRecord {
        record(SessionKey::for_session(agent, session_id, None), None)
    }

    fn seed(store: &Store, records: &[SessionRecord]) {
        store
            .upsert_sessions(records, &crate::agents::evidence_cohort())
            .expect("seed sessions");
    }

    fn target_of(record: &SessionRecord) -> Option<SessionTarget> {
        Some(SessionTarget::for_record(record))
    }

    fn session_link(session_id: &str, agent: Option<AgentKind>) -> SessionLink {
        SessionLink {
            session_id: session_id.to_owned(),
            agent,
        }
    }

    #[test]
    fn a_link_to_a_cached_session_finds_it() {
        let store = store();
        let found = native("codex", "found-session");
        seed(&store, &[found.clone(), native("codex", "other-session")]);

        assert_eq!(
            resolve(&store, &session_link("found-session", None)).unwrap(),
            target_of(&found)
        );
        assert_eq!(
            resolve(
                &store,
                &session_link("found-session", Some(AgentKind::Codex))
            )
            .unwrap(),
            target_of(&found)
        );
    }

    #[test]
    fn a_link_to_a_missing_session_finds_nothing() {
        let store = store();
        seed(&store, &[native("codex", "cached-session")]);

        assert_eq!(
            resolve(&store, &session_link("missing-session", None)).unwrap(),
            None
        );
        assert_eq!(
            resolve(
                &store,
                &session_link("cached-session", Some(AgentKind::Claude))
            )
            .unwrap(),
            None
        );
        assert_eq!(
            resolve(&store, &session_link("CACHED-SESSION", None)).unwrap(),
            None
        );
    }

    #[test]
    fn a_native_session_comes_before_its_other_copies() {
        let store = store();
        let native_copy = native("codex", "shared");
        let wsl_copy = record(
            SessionKey::for_session("codex", "shared", Some("Ubuntu")),
            Some("Ubuntu"),
        );
        let remote_copy = record(
            SessionKey::for_origin("codex", "shared", None, Some("host-1")).unwrap(),
            None,
        );
        seed(
            &store,
            &[remote_copy.clone(), wsl_copy.clone(), native_copy.clone()],
        );

        assert_eq!(
            resolve(&store, &session_link("shared", None)).unwrap(),
            target_of(&native_copy)
        );

        let store = self::store();
        seed(&store, &[wsl_copy.clone(), remote_copy.clone()]);
        assert_eq!(
            resolve(&store, &session_link("shared", None)).unwrap(),
            target_of(&remote_copy),
            "`ssh:` keys come before `wsl:` keys"
        );

        let store = self::store();
        seed(&store, std::slice::from_ref(&wsl_copy));
        assert_eq!(
            resolve(&store, &session_link("shared", None)).unwrap(),
            target_of(&wsl_copy),
            "the WSL target keeps the distribution name that the scan wrote"
        );
    }

    #[test]
    fn an_id_that_two_agents_use_needs_the_agent_hint() {
        let store = store();
        let codex = native("codex", "shared");
        let claude = native("claude-code", "shared");
        seed(&store, &[codex.clone(), claude.clone()]);

        assert_eq!(
            resolve(&store, &session_link("shared", None)).unwrap(),
            None
        );
        assert_eq!(
            resolve(&store, &session_link("shared", Some(AgentKind::Codex))).unwrap(),
            target_of(&codex)
        );
        assert_eq!(
            resolve(&store, &session_link("shared", Some(AgentKind::Claude))).unwrap(),
            target_of(&claude)
        );
    }

    #[test]
    fn only_a_single_link_argument_is_forwarded() {
        let args = |values: &[&str]| {
            values
                .iter()
                .map(|value| (*value).to_owned())
                .collect::<Vec<_>>()
        };
        let url = format!("{SCHEME}://session/{ID}");
        let forwarded = |values: &[&str]| is_link_argument(&args(values), &schemes());

        assert!(forwarded(&["antiburn", &url]));
        assert!(forwarded(&["antiburn", "antiburn://settings"]));
        assert!(!forwarded(&["antiburn"]));
        assert!(!forwarded(&["antiburn", "--background"]));
        assert!(!forwarded(&["antiburn", &url, "--background"]));
        assert!(!forwarded(&["antiburn", "https://example.com/"]));
        assert!(!forwarded(&["antiburn", "antiburn-debug://session/x"]));
        assert!(!is_link_argument(&args(&["antiburn", &url]), &[]));
    }

    #[test]
    fn each_bundle_registers_one_scheme_of_its_own() {
        fn schemes(config: &str) -> Vec<String> {
            let config: serde_json::Value = serde_json::from_str(config).expect("parse config");
            schemes_from_config(config["plugins"].get("deep-link"))
        }
        let release = schemes(include_str!("../tauri.conf.json"));
        let debug = schemes(include_str!("../tauri.debug.conf.json"));
        let probe = schemes(include_str!("../tauri.memory-probe.conf.json"));

        assert_eq!(release, [SCHEME]);
        assert_eq!(debug, ["antiburn-debug"]);
        assert!(probe.is_empty(), "the memory probe accepts no links");
        assert!(schemes_from_config(None).is_empty());
        assert!(
            schemes_from_config(Some(&serde_json::json!({"desktop": {"schemes": "x"}}))).is_empty()
        );
    }
}
