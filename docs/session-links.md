# Session links

Another app can open one session in antiburn's main window with a link:

```text
antiburn://session/<session-id>
antiburn://session/<session-id>?agent=<agent-slug>
```

For example:

```text
antiburn://session/0199b7a2-6f3e-7c41-9d2a-5b8e4f1c2a90?agent=codex
```

## Link format

- `<session-id>` is the agent's own session ID. It is the ID that the agent
  writes in its transcript or session store, for example the UUID of a Claude
  Code or Codex session, an OpenCode `ses_…` ID, or an Amp `T-…` ID. The ID
  has 1 to 128 ASCII letters, digits, `-`, `_`, or `.`. The match is exact and
  case-sensitive.
- `agent` is optional. Its value is one agent slug: `claude-code`, `codex`,
  `cursor`, `copilot`, `cline`, `opencode`, `kiro`, `amp-code`,
  `antigravity`, `windsurf`, `omp`, or `pi`. Add it when you know the agent.
  It limits the lookup to that agent's sessions.
- The host is exactly `session`, and the path is exactly one ID. antiburn
  ignores a link with a different host, a second path segment, a trailing
  slash, a query key other than one `agent`, an unknown slug, a fragment, a
  user, a password, a port, or percent-encoded text.

An ignored link does nothing in a running app. If an ignored link starts
antiburn, antiburn opens as it does for any other explicit launch.

## What a link does

antiburn looks up the ID in its local session index. The index holds the
sessions that antiburn's scans have already discovered.

- **One session found.** The main window opens, or comes to the front, on
  Sessions with that session selected. This is the same as a click on the
  session in the list, and Back returns to the previous view.
- **Copies in more than one environment.** When the same session is in the
  index for this device and also for WSL or a remote host, the link opens this
  device's copy. Other copies are in environment key order.
- **More than one agent uses the ID.** Without `agent`, the link is ambiguous
  and antiburn shows the not-found state. Add `agent` to open the session.
- **Not found.** The main window opens on Sessions with the current filters
  and no selected session. The detail pane (or, in a narrow window, the top of
  the list) says that antiburn has not discovered the linked session on this
  device. antiburn does not start a scan for the link. If the session appears
  later, open the link again.
- **Setup not complete.** antiburn shows its setup window. It does not keep
  the link.

Sub-agent transcripts are not top-level sessions in the index, so a link to a
sub-agent ID shows the not-found state. Link to the parent session instead.

When a delivery contains more than one link, antiburn opens only the last
valid one.

## Security and privacy

Any web page or local program can open a custom-scheme link. antiburn treats
every link as untrusted input and accepts only the form above.

- The link can only navigate. The lookup reads only the local session index.
  The main window then loads the same stored analysis that a click loads. A
  link does not open files, run commands, change settings, start a scan, or
  call a provider.
- The raw link and the session ID are not written to the log. The log records
  only whether a link was ignored, found, or not found.
- Analytics record one `antiburn.session_link_opened` event with `found` or
  `not_found` and nothing else. See the [analytics contract](analytics.md).
- Browsers ask before they open a custom-scheme link from a web page.

## Detect support

The bundle registers the scheme with the operating system. A build without
session links does not register `antiburn`.

- **macOS.** The app's `Contents/Info.plist` lists `antiburn` under
  `CFBundleURLTypes` → `CFBundleURLSchemes`. Ask Launch Services for the
  handler of an `antiburn://` URL, for example with
  `NSWorkspace.shared.urlForApplication(toOpen:)`, or read that key from the
  installed bundle.
- **Windows.** The installer registers the `antiburn` URL protocol under
  `Software\Classes\antiburn`.
- **Linux.** The `.deb` and `.rpm` desktop entries declare the
  `x-scheme-handler/antiburn` MIME type, so
  `xdg-mime query default x-scheme-handler/antiburn` names the handler. An
  AppImage registers the scheme only when an AppImage launcher integrates it;
  antiburn does not change desktop files at runtime.

Debug builds made with `tauri.debug.conf.json` register `antiburn-debug`
instead, so that a debug bundle cannot take links for the installed app. An
unbundled `pnpm --filter @antiburn/desktop dev` build is not registered on
macOS.
