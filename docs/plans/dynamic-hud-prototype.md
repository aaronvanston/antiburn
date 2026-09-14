# Dynamic HUD prototype

Approved for implementation on 2026-09-13 (Australia/Sydney).
Branch: `codex/dynamic-hud-prototype`. Fresh implementation worktree:
`/Users/keithlang/.codex/worktrees/dynamic-hud/antiburn`.
Base: latest fetched main, `85c6f62b`. The initial plan inspected `0f377013`;
source changes below supersede that earlier implementation outline.

## Status

| Step | State |
| --- | --- |
| Inspect sources and write initial plan | Complete |
| Keith reviews scope and timing | Approved; final decisions below |
| Create fresh prototype worktree from latest main | Complete |
| Implement settings, timing, edges, motion, and activity detection | Complete; automated checks pass, native UX pending |
| Write regression tests and documentation | Complete; frontend, shell, and HUD suites pass |
| Format changed Rust and frontend files | Complete |
| Phase handoff rule | Removed from global Codex instructions at Keith's request |
| Formatter checks, lint, type-check, build, and tests | Complete; all executed checks passed |
| Launch prototype for Keith's native UX test | Complete; debug executable verified running |
| Draggable dynamic HUD and saved-position precedence | Complete; checks pass, rebuilt debug app running, native UX awaits Keith |
| Commit and push | Authorized 2026-09-14; checks passed, ready to push |
| PR | Not authorized |

Keep this table current. Keith now authorizes the prototype dev server and native app launch for testing. Keith authorizes a DCO-signed commit and normal branch push on 2026-09-14. No PR is authorized. Keith removed the phase-handoff requirement; continue validation directly. A PR
requires Keith's explicit request after his testing, a DCO-signed commit, and
an image that Keith uploads.

## Confirmed behavior

An enabled HUD reveals at app launch or first enabling, at the configured edge
following pointer dwell, and when meaningful session work resumes after a
one-hour lull. With **Appear dynamically** off, it stays continuously visible.
Startup presentation is separate from activity detection: replaying historical
session data must not generate another automatic reveal.

Dynamic timing is **five seconds for the first reveal per app run or enabling**.
After the first automatic dismissal, later reveals last **three seconds**.
This is the routine interpretation of Keith's confirmed timing. Hover and user
interaction hold it open and restart the full current countdown. The clock
starts when the native HUD is visible, rather than while its renderer loads.
Turning dynamic mode off does not disable the HUD. Closing it disables the
master setting. Temporary conceal never writes the enabled preference.

| Choice | Prototype behavior |
| --- | --- |
| Dynamic behavior | Opt-in, off by default |
| Edge | Top by default; Top, Left, Right, Bottom available |
| Edge dwell | 300ms; must leave before the same edge can trigger again |
| Edge zone | Two logical points; excludes 24-point corners and shared monitor seams |
| Placement | Restore saved display-relative position; chosen edge is the default when no saved display is available |
| Display while held | No dismissal; leaving starts the full five/three-second countdown |
| Conceal | 300ms directional slide using `--duration-slow`; global reduced-motion clamp |
| Manual fallback | Keyboard-operable Show HUD button in Settings → Usage |
| Dragging | Available in both modes; holds dismissal and saves position across reveal and restart |
| Platform | Existing macOS HUD boundary |
| Automatic session signals | Existing semantic Claude/Codex activity, including children and resumed sessions |

The new three-second leave countdown supersedes the initial plan's separate
600ms leave grace. No timing sliders, global hotkey, token threshold, provider
requests, new transcript parser, or new analytics schema are included.

## Grounding in current main

| Source | Current behavior and implementation decision |
| --- | --- |
| [scan/watch.rs](../../apps/desktop/src-tauri/src/scan/watch.rs) | Main now has a bounded native filesystem watcher. Quiet debounce is 1.5s; continuous bursts cap at 5s. Reuse it. |
| [scan/scoped.rs](../../apps/desktop/src-tauri/src/scan/scoped.rs) | Known transcript changes use targeted refreshes, including existing resumed sessions. Per-session floor is 10s; agent rediscovery floor is 20s. Subscribe at both targeted and ordinary semantic-record boundaries. |
| [scan/mod.rs](../../apps/desktop/src-tauri/src/scan/mod.rs) | Continuous background reconciliation and source/repository opt-outs already exist. Records have event-time provenance; child activity joins the parent. No second background discovery loop is needed. |
| [scanner.rs](../../crates/antiburn-local/src/discovery/scanner.rs) | `max_activity_event_epoch` distinguishes meaningful Claude/Codex records from housekeeping and accounting records. Keep this classification unchanged. |
| [native HUD](../../apps/desktop/src-tauri/crates/hud/src/lib.rs) | Main now stores monitor placements and uses a nonactivating panel. Preserve sizing, detail window, focus behavior, and resize cancellation. |
| [Tauri monitor API](../../apps/desktop/src-tauri/crates/hud/src/dynamic.rs) | Use the installed Tauri `Monitor::work_area` for placement and full monitor bounds for edge detection. Physical origins and per-monitor scale support mixed DPI. |
| [overlayWindow.ts](../../apps/desktop/src/lib/overlayWindow.ts) | Existing localStorage visibility preference is migrated once into native persisted HUD preferences. UI now follows enabled/settings events, never conceal events. |
| [OverlaySession.ts](../../apps/desktop/src/views/overlay/OverlaySession.ts) | External-store subscriptions own motion state; no `useEffect` added. Hidden renderer work still suspends. |
| [design contract](../../apps/desktop/design.md) | Existing semantic controls and duration tokens; directional motion is documented in the same change as hud.css. |

The initial proposal for a new file observer, incremental byte cursors, and
extracting scanner classification is superseded by current main's watcher and
semantic scan infrastructure. Preferences use a dedicated checked native store
key and field-level commands rather than expanding the unrelated AppSettings
payload. Existing native values win over the legacy localStorage migration.

## State and event model

[Hud dynamic policy](../../apps/desktop/src-tauri/src/hud_dynamic.rs) serializes
preferences, reveal requests, activity hints, and timer transitions in one
bounded native queue. The process owns and aborts this task with its other
schedulers. Pointer sampling runs only when enabled and dynamic; it reads the
pointer without an input-catching window.

Presentation moves through hidden, waiting for native visibility, visible,
held, and concealing. A new reveal or hover during conceal clears the old hide
deadline. Disable cancels pending timing and native shows. First automatic
conceal completion switches future reveals to three seconds. Renderer delay
cannot prevent the native hide deadline. Display geometry is rechecked by the
existing monitor watcher and on resize/reveal. A long pointer-poll gap clears
old dwell intent; wake alone does not retrieve a hidden HUD.

The activity detector baselines at launch/enabling/mode change and discovery
pause transitions. It consumes only semantic event epochs from validated
Claude/Codex records, including the targeted path for existing sessions.
Only an advancing epoch within 30 seconds of observation and no more than five
seconds in the future counts. Return means at least 3600 seconds since the
previous accepted activity across monitored sessions. Every accepted event
updates that time, so continuous work does not repeatedly reveal the HUD.
Clock reversal rebaselines; sleep itself cannot show it. A fresh post-sleep
record can show once after a long gap.

No token magnitude threshold or confirmation window is imposed. File touches,
metadata-only writes, repeated accounting, old imports, and replayed records
cannot advance semantic activity. Activity is agent work, including unattended
work; it does not assert that a human returned to the keyboard.

## Limits to verify honestly

- The original two-second latency was a target, not a measurement. Reusing the
  current bounded scheduler means 1.5–5 seconds of debounce plus metadata work,
  potentially the existing 10/20-second scheduling floors. An idle existing
  session normally has no recent per-source floor. Measure actual return
  latency before accepting the prototype UX. Do not silently lower shared
  scan floors or add another watcher to improve it.
- Existing scanner tail-size and record-shape limits remain. Unsupported
  sources retain edge/manual access. No new source or check coverage is claimed.
- A copied transcript containing plausible fresh event times is not always
  distinguishable from fresh work. Old imports and startup replay are filtered;
  clock skew and delayed writes beyond freshness limits can miss a return.
- Placement respects Dock/menu-bar safe area, while retrieval targets physical
  screen bounds. Native testing must assess interference, notched displays,
  auto-hide Dock positions, Spaces, and full-screen apps.
- Motion clips inside the content-sized native frame and then hides that frame;
  it does not move a window across an adjacent display. Judge the resulting
  slide visually, including left/right reveals and reduced motion.
- Existing HUD exposure analytics retain user/automatic origins. No extra
  transcript data or new events are sent. This prototype does not distinguish
  edge reveals from the Show HUD button in analytics.

## Verification

Written tests cover visibility-based first timing, later three-second timing,
hover countdown restart, interrupted conceal, edge dwell and re-entry, replay,
stale/future events, clock reversal, continuous activity, preference decoding,
four-edge geometry, and frontend conceal/settings separation. Extend failures
at their actual behavioral boundary; use only synthetic source fixtures.

Run formatter, linter, type checks, and tests from
[CONTRIBUTING.md](../../CONTRIBUTING.md) and the
[desktop README](../../apps/desktop/README.md). Desktop: `pnpm --filter
@antiburn/desktop lint`, `type-check`, `test`, `build`, and formatting checks.
Shell and changed standalone HUD crate: `cargo fmt --check`, `cargo clippy
--all-targets -- -D warnings`, and `cargo test`. Run
`node scripts/check-design-drift.mjs`. No engine parser is changed; existing
semantic scanner regressions provide supporting coverage. If instrumentation
changes beyond preserving existing origins, run analytics feature checks too.
Before any future push, run `pnpm run slop:all` and `pnpm run secrets`.

Keith's native test, on a separately authorized dev run:

1. Enable HUD, relaunch enabled, disable/re-enable, and toggle dynamic mode.
   Check five seconds initially, three seconds after first automatic dismissal,
   full countdown after hover, and uninterrupted persistent display.
2. Retrieve at every edge; test stationary dwell, crossing seams, corner
   gestures, moving into the HUD, tooltip intent, and Show HUD by keyboard.
3. Resume an existing Claude and Codex session after a synthetic one-hour lull;
   check child work and new sessions. Measure disk-event-to-reveal latency.
4. Touch a transcript, append housekeeping, replay old data, and continue work
   after a reveal. None should cause a second return without another long lull.
5. Test light/dark, reduced motion, all Dock positions and auto-hide, menu bar,
   notched screen, mixed DPI, negative origins, monitor removal, and Spaces.
6. Sleep during hidden/held/concealing states. Wake idle, then produce activity.
   Check focus stays in the coding app and hidden HUD captures no clicks.
7. Compare quiet and busy resource use; disabling dynamic mode must stop its
   pointer loop. Discovery pause must stop automatic-return observations while
   leaving manual/edge access available.


## Validation record

Initial implementation checks executed in this prototype worktree before the native launch. All listed commands completed successfully.

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed; lockfile unchanged |
| `pnpm --filter @antiburn/desktop lint` | Passed |
| `pnpm --filter @antiburn/desktop type-check` | Passed |
| `pnpm --filter @antiburn/desktop test` | 119 files, 1,518 tests passed |
| `pnpm --filter @antiburn/desktop build` | Passed |
| Prettier `--check` on changed frontend files | Passed |
| `node scripts/check-design-drift.mjs` | Design contract in sync |
| Shell `cargo fmt --check` | Passed |
| Shell `cargo clippy --all-targets -- -D warnings` | Passed |
| Shell `cargo test --quiet` | 1,235 tests passed |
| Shell clippy with `--features analytics` | Passed |
| Shell tests with `--features analytics` and the documented loopback configuration | 1,329 passed; 2 ignored; 0 failed |
| Standalone HUD crate `cargo fmt --check` | Passed |
| Standalone HUD crate `cargo clippy --all-targets -- -D warnings` | Passed |
| Standalone HUD crate `cargo test` | 27 tests passed |
| `git diff --check` | Passed |

Validation fixed the missing native permission entries and two clippy findings.
Popover tests now assert that reopening the popover does not undo dynamic
conceal. A listener-retry test now targets the work listener by event name.
The wake regression covers a wall-clock jump even if the monotonic clock did
not advance across sleep.

The build reports warnings in the untouched vendored tray-icon code and a
frontend chunk-size warning. No lint suppression was added. No engine parser
or coverage contract changed. No push is authorized, so the before-push slop
and secret scans remain part of the future push workflow.

At Keith's request, the exact phase-boundary handoff paragraph was removed
from the global Codex instructions at `/Users/keithlang/.codex/AGENTS.md`.
Unrelated instructions were preserved. The old planning file in the original
worktree now points to this plan.


## Native test launch

Keith requested the runnable prototype after seeing the installed application.
The setting already exists in `UsagePane.tsx` under Usage → Floating HUD.
Appear dynamically remains visible but disabled while the master HUD is off;
all four edge choices become enabled when dynamic mode is on. No UI edit was
needed. Launch uses the documented `pnpm --filter @antiburn/desktop dev` script
from this worktree, including the debug identity override.

Computer Use could not inspect the GUI because Accessibility/Screen Recording
permissions were unavailable. Verify the process and Vite source path through
the shell, and leave the app running for Keith's visual test.

## Authorized dragging follow-up

Reuse the existing manual drag and versioned `internal:hudPlacements` store.
Restore the newest connected saved display before applying default edge placement.
Keep selected-edge retrieval and slide direction even at a custom position.
Clamp saved and resized frames to the usable display area; disconnected or
changed-DPI display identities fall back without overwriting the saved entry.
Native drag state suspends automatic dismissal and competing placement updates.
On release, flush queued moves before recording the position, then resume the
full current countdown. Cancel safely on hide, setup failure, and teardown.
Add regression tests for dynamic dragging, move/save ordering, timing holds,
and placement/clamping. Run desktop and native checks, then verify the existing
dev launcher has rebuilt and is running the changed executable. No commit or PR.

### Dragging follow-up validation — 2026-09-13

Both modes use the existing drag mechanism. Only actual pointer movement saves
a placement. Native drag hold prevents timer dismissal and competing placement;
queued moves are coalesced, and the final move finishes before persistence and
release. Saved connected positions precede edge defaults, clamp to work areas,
and survive database reopening. The existing display watcher now includes
arrangement and work-area changes. Retrieval and slide direction retain the
selected edge even at a custom position.

| Check | Result |
| --- | --- |
| Desktop lint and type-check | Passed after final frontend change |
| Desktop full tests | 119 files, 1,520 tests passed |
| Final targeted HUD tests | 44 tests passed after final release-path adjustment |
| Desktop production build | Passed after final frontend change |
| Changed frontend Prettier check | Passed |
| Shell formatting and Clippy | Passed |
| Shell tests | 1,237 tests passed |
| Standalone HUD formatting and Clippy | Passed |
| Standalone HUD tests | 28 tests passed |
| Design contract and diff whitespace checks | Passed |

Evidence logs: `/tmp/antiburn-hud-drag-tests.log`,
`/tmp/antiburn-hud-drag-final-targeted.log`,
`/tmp/antiburn-hud-drag-shell-tests.log`,
`/tmp/antiburn-hud-drag-crate-tests.log`, and
`/tmp/antiburn-hud-drag-final-build.log`.

The existing Tauri launcher rebuilt and relaunched the debug app automatically.
`/tmp/antiburn-dynamic-hud-dev.log` reports the final successful native build
and execution. At verification, PID 56909 runs
`/Users/keithlang/.cargo/shared-target/debug/antiburn`, with cwd in this worktree's
`apps/desktop/src-tauri`. Vite PID 80712 has this worktree's desktop cwd and
serves the updated drag lifecycle on port 1420. No additional app was launched.

Computer Use permissions remain unavailable. Keith still needs to verify
physical dragging, release outside the HUD, restart restoration, mixed-DPI
cross-display dragging, display removal/reconnection, and motion visually.
No analytics schema or parser changes were needed. No commit or PR was made.

## Authorized branch push — 2026-09-14

Inspect branch, remote, and intended changes. Run `pnpm run slop:all` and
`pnpm run secrets`; retain the completed implementation checks above unless
source changes require new checks. Commit the prototype with DCO sign-off,
push normally with upstream, and verify the remote commit. Do not open a PR.

Push checks passed: `pnpm run slop:all` reports 590 files, zero errors and
zero warnings; `pnpm run secrets` exits successfully. Logs are
`/tmp/antiburn-hud-push-slop.log` and `/tmp/antiburn-hud-push-secrets.log`.
Source modification times precede the final recorded implementation checks;
only this plan changed during push preparation. `git diff --check` passes.
Native visual limitations listed above remain.
