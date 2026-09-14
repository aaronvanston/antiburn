# Overview view — implementation plan

**Date:** 2026-09-14
**Status:** reviewed by Keith 2026-09-14 (six threads, all resolved); no code written
**Branch:** `claude/home-screen-planning-0d134f`, reset onto `origin/main` (`0456d51e`)
**Name:** the design handoff calls this view Home. Keith renamed it **Overview** on
2026-09-14 (review thread u-5). Code, files, and the sidebar label use Overview; the
handoff below is kept as the design record under its original name.
**Design source:** [`home-view-design-handoff.md`](home-view-design-handoff.md) (copied
from the `codex/home-view-design-handoff` worktree, where it is still untracked)

This plan turns the agreed design handoff into stacked, reviewable changes. The
handoff owns the *what*; this document owns the *how* and the *order*. Where the
code differs from what the handoff assumed, the difference is called out.

## What the code says today

Checked against `origin/main` on 2026-09-14.

| Handoff assumption | Reality | Effect on the plan |
|---|---|---|
| Overview section id is a TS change in `ipc.ts` | `MainWindowSectionId` is mirrored by the Rust `MainWindowSection` enum in `src-tauri/src/main_window.rs:39` (serde camelCase) | Add `Overview` on both sides in slice 1 |
| `getProviderUsage()` is callable from the main window | `src-tauri/capabilities/main.json` grants `allow-get-live-usage` but **not** `allow-get-provider-usage`; only the popover capability set has it | Add the capability entry in slice 2, plus one for the new daily command |
| Payload types live in `ipc.ts` | They live in `src/lib/providerUsageIpc.ts` (`ProviderUsageSummaryPayload`, `LiveProviderUsagePayload`, …); `ipc.ts` re-exports and owns the `invoke` wrappers | Types go in `providerUsageIpc.ts` |
| Daily buckets need a new series | Confirmed: `provider_usage::summarize` only fills `today / week / month_to_date / last_30_days` buckets from `updated_at_epoch` (`provider_usage/mod.rs:483`) | New `days` series in slice 2 |
| Recent sessions can come from `MainActivitySession` | Its list only loads once a viewer subscribes *actively* (`subscribeInactive` never starts the load). Subscribing actively from Overview would also start its selection/analysis machinery | Overview loads its own three rows with `listRecentSessions()` (same command the popover uses) |
| Session rows are reusable | `SessionRow` is a private function inside `SessionList.tsx:305`; `SessionList` itself is virtualized with grouping and a toolbar | Export the row from `SessionList.tsx`; do not mount the full list for three rows |
| Burn findings can open "with the check selected" | `BurnChecksReport` has no external selection API; each `CheckRow` owns its own `open` state (`BurnChecksReport.tsx:67`) | v1 navigates to the Burn checks section; a `focusDetector` request on `BurnChecksSession` is a small follow-up (see Decisions) |
| Burn checks summary can share `BurnChecksSession` | The session only becomes `active` with an active subscriber **and** a visible window, and an active subscriber also fires the `burn_checks` surface-exposure analytics | Overview reads the report with its own consumer id and never counts as a Burn checks exposure |
| Chart needs a library decision | `recharts` 3.10.1 is already a dependency (`ContextTokensChart.tsx`), but its bars are not keyboard-focusable | Plain DOM bars (30 buttons) — see Decisions |

## Decisions (proposed, for Keith to confirm)

1. **Daily series rides on the existing summary.** Add `days: Vec<ProviderUsageDay>`
   to `ProviderUsageSummary` (totals only, not per provider), computed inside
   `summarize` from the same `WindowBounds` and pricing pass. One IPC call, same
   timezone offset, same pricing snapshot, no second aggregation to drift. The
   payload grows by 30 small rows for every caller, including the popover; that is
   cheap. The alternative, a separate `get_provider_usage_days` command, is only
   worth it if the popover must never see the series.
   *Keith (u-1): "cheap vers, then we'll review".* Decided: the existing summary.
2. **Bars are plain DOM, not recharts.** Thirty `<button>` elements in a flex row,
   heights from the day's `estimatedUsd` as a percentage of the y-axis max, roving
   `tabindex` with arrow keys. This gives hover and keyboard focus the same
   selected-day detail line for free, renders identically in tests, and keeps the
   chart on semantic utilities. `ContextTokensChart` stays on recharts; the two
   charts do different jobs.
   *Keith (u-2): "some subtle growth animation in would be optimal".* So the bars
   grow in once on first paint: each bar transitions `height` from 0 over
   `--duration-slow` (300ms, the token `design.md` reserves for "a meter or bar
   that fills"), with a small per-bar stagger left to right so the chart reads as
   filling in rather than popping. Later data refreshes transition the height
   change only, no replay. `motion.css` already clamps every transition under
   `prefers-reduced-motion: reduce`, so nothing extra is needed there. Still no
   recharts: a CSS transition on a plain element does this job.
3. **Chart colours come from the prototype round, not from `measure`.** This
   period's bars are `token-in` (the bright cyan); the previous period's bars are
   `label-tertiary` at 30% opacity; past days of this period sit at 70% opacity and
   today at 100%. See "Settled design" below. No new token.
4. **Overview owns its data through one external store, `MainOverviewSession`**, built on
   the same `attach / start / syncActive / dispose` shape as `BurnChecksSession`.
   It reads local usage, live usage, the checks report, and recent sessions; it
   refreshes on `onSessionsInvalidated`, `onScanEvent` (finished phases),
   `onLiveUsageChanged`, `onChecksReportChanged`, and window visibility. No
   `useEffect` anywhere in the view.
5. **Finding rows navigate to Burn checks, not to a specific check, in v1.**
   Deep-linking would need a `focusDetector(id)` request on `BurnChecksSession`
   that `CheckRow` honours by opening and scrolling.
   *Keith (u-4): "I think we may need to re think burn checks a later day".* So
   slice 4b is dropped from this stack. Finding rows land on the Burn checks
   section and nothing more; the Overview side of the checks panel stays thin
   (title, count, verified savings, top three findings) so a later rethink of
   Burn checks does not have to unpick Overview.
6. **No Overview analytics surface in v1.** Adding `"overview"` to the `Surface` union
   touches the Rust analytics enums. Not needed to ship the view.
7. **No new stylesheet.** Tailwind semantic utilities cover the layout. If an
   `overview.css` becomes necessary, it is added to `design.md` `sources:` in the same
   change, per `AGENTS.md`.

## Settled design (prototype round, 2026-09-14)

Seven HTML prototype versions were reviewed in `discuss` (scratchpad
`proto/overview/playground-v7.html` is the latest; v1–v6 threads are all resolved).
The values below are Keith's pasted `overview-v6` settings plus his v6 notes, and
override the handoff where they differ. v7 is under review; anything that changes
there gets folded in here.

**Principle: reuse existing components wherever one exists.** Keith: "the design
needs to use as many existing components as possible. For example, the existing
Session list view." Only the bar chart is new drawing. Everything else composes
`SessionRow`, `SegmentedMeter`, `SegmentFigure`, and the presentation helpers.

Layout, top to bottom, at 1040px comfortable density, 16px panel padding:

1. **Hero totals above the chart, no headline.** Kicker "Estimated" (`type-callout`),
   then three cells with hairline dividers: Today, 7 days, 30 days. The figure is
   32px, weight 800, letter-spacing −0.03em, monospace, colour `measure`, rendered
   through `SegmentFigure` for the tabular digits (the mono family is a deliberate
   hero exception, so it is a class on the hero, not a change to `SegmentFigure`).
   Under each figure: "71.2M tokens · 4 sessions" in `type-footnote text-label-tertiary`.
   The right edge carries "Local sessions" as a quiet caption; "Updated just now" sits
   on the page header line.
2. **Daily chart, 90px tall, paired bars.** Title "Estimated spend by session activity
   date" with a key on the right ("Last 30 days" / "30 days before"). For each of 30
   days a pair: this period in `token-in`, the previous period in `label-tertiary` at
   30% opacity, 2px inside the pair, 3px between days. Bars are 7px wide, the same
   diameter as the `SegmentedMeter` dot, and fully rounded (pill), so a zero day is a
   single dot and a bar is a stretched dot. Past days at 70% opacity, today at 100%.
   Y axis with $0/$40/$80 guides; x labels weekly plus "Today" in `token-in`. Grow-in
   on first paint only: 300ms (`--duration-slow`), 12ms stagger per bar, ease-out.
   Below the axis, the selected-day line: "Today · $42.80 · 71.2M tokens · 4 sessions"
   and, once the previous series exists, "±$x vs 30 days before".
   **The previous-period series is new data.** `summarize` must add a second 30-day
   window (`previous_30_days_start = last_30_days_start − 30 × 86 400`) and emit
   `previous_days` alongside `days`; both are 30 buckets, oldest first. The
   `WindowBounds::earliest` query bound moves back to the previous window's start.
3. **Provider limits: dot meters only, no heading, no rings.** Two provider cards side
   by side (Claude Max, Codex Plus), each with the provider name and plan on top and a
   `WindowMeterRow` per window: label left, percent right through `SegmentFigure`,
   `SegmentedMeter` with 16 segments and the elapsed notch, and the reset time under
   the meter as a caption (always shown, not on hover: this surface shows one
   provider per card). The Live/Stale freshness tag floats in the panel's top-right
   corner. `UsageRing` is not used on Overview. `WindowMeterRow` is private to
   `UsageLimitsBar.tsx`; export it (or lift it with `SegmentedMeter` into
   `components/ui`) and give it a `segments` prop rather than duplicating it.
4. **Burn checks: no heading.** One summary line with the burn mark, "2 findings ·
   7 passed", "$27.60 verified savings" under it, and a "More →" link at the right
   edge of that line (not "View report"). Then up to two finding rows, label left and
   "N sessions" right in `brand`. All-passed state: mark, "All 9 checks passed",
   "184 sessions assessed".
5. **Recent sessions: no heading.** An "All sessions →" link above the rows, then three
   real `SessionRow`s with `badgeMetric="cost"`, exactly as the Sessions list renders
   them (status line, title, models, repo · time, fail wash).
6. **Both themes** verified at every version; no new token was needed.

## Slices

Each slice is one PR of roughly a few hundred lines, stacked on the one before
(per the PR-size habit). No PR opens until Keith has tested and asks for it.

### Slice 1 — Navigation shell

Goal: Overview exists, is the default, and shows a truthful placeholder.

- `apps/desktop/src-tauri/src/main_window.rs:39` — add `Overview` to `MainWindowSection`.
  Extend the `section_target_keeps_only_the_latest_request` test's neighbours with
  a `overview` round-trip.
- `apps/desktop/src/lib/ipc.ts:223` — `MainWindowSectionId = "overview" | "activity" | "burnChecks"`.
- `apps/desktop/src/views/main-window/MainWindowNavigationSession.ts:16` —
  initial `selected: "overview"`, `visited: ["overview"]`. Update
  `MainWindowNavigationSession.test.ts`.
- `apps/desktop/src/views/MainWindowView.tsx` — add the Overview section first
  (`House` icon from lucide per the handoff; open to a better glyph for an Overview label), route `selectSection("overview")` through
  `navigationSession.select`, keep Burn checks and Sessions after it.
- New `apps/desktop/src/views/main-window/OverviewView.tsx` — for this slice only: the
  macOS titlebar spacer (copy the pattern in `BurnChecksView.tsx:24`), an `sr-only`
  `<h1>Overview</h1>`, and a `Skeleton`-based loading block. No fake numbers.
- `apps/desktop/src/views/MainWindowView.test.tsx` — default section is Overview; the
  popover's `openMainWindowSection("burnChecks")` still lands on Burn checks.
- Verify: `pnpm --filter @antiburn/desktop lint|type-check|test`, plus
  `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`
  from `apps/desktop/src-tauri`.

### Slice 2 — Local totals and the daily chart

Goal: the cost-led top of the page, on real data.

Rust:
- `apps/desktop/src-tauri/src/dto.rs` — add `ProviderUsageDay { local_date: String,
  tokens_in, tokens_out, cache_read, estimated_usd: Option<f64>, cost_complete: bool,
  session_count: u32 }` and `days: Vec<ProviderUsageDay>` on `ProviderUsageSummary`.
- `apps/desktop/src-tauri/src/provider_usage/mod.rs` — add
  `previous_30_days_start` to `WindowBounds` (and to `earliest()`), and a
  `previous_30_days` membership flag. In `summarize`, keep two `[Bucket; 30]` arrays
  indexed by `(updated_at_epoch - <window start>) / 86_400`; emit exactly 30 ordered
  buckets per series, oldest first, zero days included, `local_date` as `YYYY-MM-DD`
  in the reader's offset. Reuse `window_of` for the conversion. The previous window
  feeds only `previous_days`, never the existing totals.
- `apps/desktop/src-tauri/src/provider_usage/tests.rs` — 30 buckets always; a
  session lands in the bucket of its `updated_at_epoch` local date; a boundary at
  local midnight with a non-zero offset; `cost_complete` false propagates to its day;
  sum of `days` equals `totals.last_30_days`; a session 31 days old lands in
  `previous_days` and in no total.
- `apps/desktop/src-tauri/capabilities/main.json` — add `allow-get-provider-usage`.

TypeScript:
- `apps/desktop/src/lib/providerUsageIpc.ts` — `ProviderUsageDayPayload` and
  `days?: ProviderUsageDayPayload[]` on `ProviderUsageSummaryPayload` (optional so
  the popover-peek fixtures keep compiling). `EMPTY_PROVIDER_USAGE` in `ipc.ts`
  gains `days: []`.
- New `apps/desktop/src/views/main-window/MainOverviewSession.ts` — snapshot
  `{ active, usage, usageError, liveUsage, generatedAt, loading, refreshing, … }`.
  This slice loads `getProviderUsage()` and `getLiveUsage()`; later slices add
  checks and sessions. Adapter interface for tests, like `BurnChecksAdapter`.
- New `apps/desktop/src/views/main-window/overview/OverviewSpendChart.tsx` — eyebrow
  "Estimated spend", the 30-day figure at `type-large-title` `font-mono tabular-nums`,
  the selected-day line top-right, the chart with the title "Estimated spend by
  session activity date", subtle guides, sparse date ticks, and the today mark.
  Y-axis max is the next step above the largest day (same rule as the Context
  chart). A day with `estimatedUsd === null` and tokens > 0 draws a hatched or
  outlined bar with "not priced" in its detail line; it is not drawn as zero.
- New `apps/desktop/src/views/main-window/overview/OverviewSpendTotals.tsx` — Today / 7 days
  / 30 days from `totals.today`, `totals.week`, `totals.last30Days`, hairline
  separators, `font-mono tabular-nums`. Reuse `formatSpendFigure`,
  `formatTokenFigure`, `windowTokens`, `sessionCountLabel` from
  `lib/presentation/providerUsage.ts`. `costComplete === false` appends "partial";
  `estimatedUsd === null` falls back to the token figure with a "tokens" label, as
  the handoff allows.
- `OverviewView.tsx` — replace the placeholder; wire the session with
  `useSyncExternalStore(active ? session.subscribe : session.subscribeInactive, …)`.
- Tests: `MainOverviewSession.test.ts`, `OverviewSpendChart.test.tsx` (30 bars, keyboard
  arrow selection updates the detail line, null-cost day is not zero),
  `OverviewSpendTotals.test.tsx` (partial and null states).

### Slice 3 — Provider limits panel

- `apps/desktop/src/components/providerUsage/UsageLimitsBar.tsx` — export
  `WindowMeterRow` with a `segments` prop (default 32) and a `resetPlacement`
  option so the reset can sit as a caption under the meter instead of beside the
  label. No visual change to the popover.
- New `apps/desktop/src/views/main-window/overview/OverviewProviderLimits.tsx` — a
  `bg-surface-card rounded-control` panel with no heading; the freshness tag
  (Live / Stale from `liveUsage.generatedAt`) absolutely positioned top-right.
  Providers from `orderedLiveAccounts(liveDisplayableProviders(live))`, each a
  column: display name, `livePlanAccountLabel`, then one `WindowMeterRow` per window
  at 16 segments with the reset caption always visible. Unavailable providers via
  `liveUnavailableProviders` and `liveUnavailableReason`. Two abreast with
  `grid-cols-[repeat(auto-fit,minmax(…))]` so it stacks when narrow. No `UsageRing`.
- Empty state when no provider reports anything: one quiet line pointing at Settings.
- `MainOverviewSession` — subscribe `onLiveUsageChanged`; no `refreshLiveUsage()` from
  Overview (the shell owns the polling cadence).
- Tests: `OverviewProviderLimits.test.tsx` — determinate meter with notch, `null`
  percent at half strength, red zone above 90%, unavailable seat, empty state; the
  local-cost figures never appear in this panel.

### Slice 4 — Burn checks summary and recent sessions

- `MainOverviewSession` — read `getChecksReport("main-home-<n>")` with
  `cancelChecksReport` on dispose, refresh on `onChecksReportChanged`; load
  `listRecentSessions()` and keep the newest three, refresh on
  `onSessionsInvalidated` and `onSessionEntryChanged`.
- New `overview/OverviewBurnChecks.tsx` — rollup via `checksPresentation` /
  `checksHeroPresentation` from `lib/presentation/checks.ts`; up to two categories
  with `finding > 0`, ranked by `estimatedTokenBurnBasisPoints` then `finding`,
  labelled through `checkRowPresentation` in `views/checks/checkUi.ts`; row trailing
  text "N sessions". All-passed and assessing/unavailable states per the handoff.
  No panel heading; the "More" link sits at the right of the summary line. "More" and
  each row call `onOpenBurnChecks()`.
- `apps/desktop/src/components/session/SessionList.tsx` — export `SessionRow`
  (and its props type) so Overview renders the same silhouette and states. No visual
  change to the list.
- New `overview/OverviewRecentSessions.tsx` — three `SessionRow`s with `badgeMetric="cost"`,
  `hygieneBySession` from `useSessionHygiene(sessionHygieneIdentities(rows))`, under
  an "All sessions" link (no heading). Row click → `navigationSession.select("activity")` then
  `activitySession.selectEntry(entry)`. Confirm during implementation that
  `selectEntry` before the list has loaded selects correctly; if not, route through
  `openRelated(subjectForEntry(entry))`.
- `MainWindowView.tsx` — pass the two navigation callbacks into `OverviewView`.
- Tests: `OverviewBurnChecks.test.tsx` (findings, all passed, pending never shows zero),
  `OverviewRecentSessions.test.tsx` (three rows, navigation callbacks),
  `MainWindowView.test.tsx` (Overview row click lands in Sessions with that session).

### Slice 5 — Polish and review

- Responsive: provider and checks panels stack below a measured width; totals
  stack at very narrow widths; date ticks thin before the chart ever scrolls.
  Built with CSS container queries on the page (`overview.css`), the same
  pattern as `session-detail.css`, because no `useElementWidth` hook exists.
  Panels stack below 700px, totals below 540px. The axis labels sit at a fixed
  pitch per day, so they never collide and need no thinning; below the chart's
  natural width the chart scrolls sideways instead of shrinking the bars.
- Light, dark, increased text size, reduced motion (the bar grow-in is clamped
  by `motion.css`; confirm nothing else moves), keyboard pass through nav →
  bars → finding rows → session rows with visible focus.
- `node scripts/check-design-drift.mjs` if any token or stylesheet changed.
- Design review of the built window in both themes, then Keith's hands-on test.
  Only then: ask whether to open PRs.

## Verification per slice

```sh
pnpm --filter @antiburn/desktop lint
pnpm --filter @antiburn/desktop type-check
pnpm --filter @antiburn/desktop test
pnpm --filter @antiburn/desktop build
```

Rust slices, from `apps/desktop/src-tauri`:

```sh
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

Every commit signed off with `git commit -s`.

## Open questions for Keith

- ✋ Handoff step 5 names a repository `design-review` skill. There is none in this
  repo's `.claude/`. Is there one elsewhere, or does "design review" mean a manual
  pass in both themes?

## Non-goals (unchanged from the handoff)

Billing reconciliation, budgets or invented denominators, predictive burn in the
hero, a menubar redesign, a second token system, a filler KPI grid, a spend/tokens
switch.

## Status

| Step | State |
|---|---|
| Worktree reset onto `origin/main` | done (2026-09-14) |
| Code audited against the handoff | done |
| Implementation plan written | done |
| Plan reviewed by Keith | done (2026-09-14, discuss, six threads resolved) |
| Design prototypes v1–v7 reviewed by Keith | v1–v6 done (2026-09-14, discuss); v7 open |
| Slice 1 — navigation shell | done (2026-09-14) |
| Slice 2 — totals and daily chart | done (2026-09-14) |
| Slice 3 — provider limits | done (2026-09-14) |
| Slice 4 — burn checks and recent sessions | done (2026-09-14) |
| Slice 5 — polish, design review, Keith's test | polish done (2026-09-14); awaiting Keith's hands-on test and `/design-review` on a live instance |
