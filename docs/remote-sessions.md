# Remote sessions in this fork

This fork adds read-only remote machines to the Sessions view in the main desktop window.
A small Linux helper uses the existing `antiburn-local` engine to discover
Claude Code and Codex transcripts and calculate metrics where the files live.
The desktop invokes it over the user's existing SSH connection. No server,
listener, credential forwarding, provider login, or background daemon is needed.

## Current behaviour

- Open **Settings → Sources → Remote hosts** to add or remove SSH aliases. Changes save automatically; up to eight aliases are supported.
- Use **Test connection** beside a host to check SSH and collect its recent sessions. The UI shows connection errors beside that host.
- In **Sessions**, use **Machine** to choose **This machine**, **All remote hosts**, or a specific host. Remote rows and analysis identify the source host.
- **Manage hosts…** opens Sources in Settings. The session view reloads configuration and cached lists when its window regains focus.
- Press **Refresh hosts** to collect remote sessions again. A selected host refreshes only that host.
- Discovery returns at most 200 transcripts per host from the engine's seven-day recency window.
  A truncated list is labelled. Unreadable or unidentified sources are counted as skipped.
- Select a session to calculate its parent-transcript tokens, API-equivalent cost,
  context history and compactions. Refresh analysis explicitly to update it.
- Each host's latest successful list is cached in the app data directory.
  A failed connection preserves that list and displays the failure and collection time.
- A host alias identifies a source in this prototype. Renaming an alias creates a new source;
  aliases for the same machine are not automatically deduplicated.
- Remote results have a separate pane. They do not change local totals, provider
  allowance allocation, Burn Checks, native session identity or local remediation.
- Source transcripts and provider credentials are never modified. No remote
  resume, stop, configuration editing or transcript deletion commands exist.

Session titles can contain the beginning of a user prompt. Titles, working
directories, session IDs, metrics and engine-derived context details travel over
SSH to the user's desktop. Transcript message bodies are not returned. Lists
are stored in an owner-only directory; selected analysis stays in memory.
Removing a host deletes its cached list. Clearing the local session index does
not clear remote lists; remove the host to clear those.

The pane makes no process-liveness claim. File modification times are activity
hints, and provider quota meters are account-level data that this collector does
not read. Analysis covers only the selected parent transcript; child usage is
not combined. Estimated prices use the helper's bundled engine price catalogue.
Parsing gaps inherited from the engine are not a clean Burn Check result.

## Build and install the Linux helper

Use Rust 1.97 or newer and a C compiler on the build machine:

```sh
cargo build --release --manifest-path crates/antiburn-remote/Cargo.toml
install -Dm755 crates/antiburn-remote/target/release/antiburn-remote \
  "$HOME/.local/bin/antiburn-remote"
```

The helper can be copied to another compatible Linux machine with the same
architecture and a compatible libc. A desktop environment is not needed.
Install it for the same Linux user whose agent sessions should be inspected.
Non-interactive SSH may not inherit shell environment overrides: ensure
`CODEX_HOME` / `CLAUDE_CONFIG_DIR` are available to that invocation if customised.
Otherwise the engine uses its standard home-directory locations.

Verify the SSH alias normally first so its key is in `known_hosts`. The app uses
batch authentication and strict host-key checking; it never accepts a new key.
The remote command is fixed as `~/.local/bin/antiburn-remote stdio`.

On macOS, direct LAN connections may need Local Network permission. The fork
bundle declares that purpose. If an SSH child cannot reach a direct interface
from the app, an existing VPN route can use a separate SSH alias while the
terminal's original alias remains unchanged. Verify the server host key against
the already trusted connection before adding an alternate endpoint.

```sh
printf '%s' '{"operation":"list","version":1}' | \
  ssh -T build-box '~/.local/bin/antiburn-remote stdio'
```

Protocol version 1 also accepts `analyze` with `agent` and `session_id`.
Selection must match the recent discovery list; callers cannot supply a file path.
A locally built helper can exercise the same bounded SSH transport as the app:

```sh
printf '%s' '{"operation":"list","version":1}' | \
  crates/antiburn-remote/target/release/antiburn-remote ssh build-box
```

The helper emits one JSON response and exits. Requests are capped at 8 KiB,
responses at 8 MiB, and errors at 8 KiB. SSH requests time out after 60 seconds.
Analysis streams one transcript, capped at 512 MiB with a 40-second parsing
budget. Desktop requests are serialised, including host removal, so a late
response cannot restore a deleted cache. No polling starts automatically.

## Build the separate macOS app

```sh
pnpm install --frozen-lockfile
pnpm --filter @antiburn/desktop tauri build \
  --config src-tauri/tauri.remote.conf.json --bundles app
```

The bundle is **Antiburn Remote.app**, with a separate application identifier and
storage directory. Local bundles receive an ad-hoc app signature; distribution
to other users would need separate signing and notarisation. This configuration
disables upstream updates so an upstream
release cannot replace the fork. Default builds exclude product analytics;
remote host names, titles and metrics have no new analytics events. This is an
intentional measurement gap for the prototype.

## Verification

Run the helper's protocol tests, Clippy and formatter, the desktop frontend
checks and the shell checks from `CONTRIBUTING.md`. Protocol fixtures are synthetic.
Never add collected host output, real transcripts or private machine configuration
to this repository.

## Follow-up work before proposing upstream integration

- Agree on stable source identity independent of SSH aliases.
- Decide how machine scopes appear in the existing session list and reports.
- Add incremental collection and capability negotiation before continuous polling.
- Characterise child-session aggregation, archived-session coverage and parsing gaps.
- Review a user-facing SSH setup flow and Linux binary release packaging.
