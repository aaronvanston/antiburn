# Overview: utilization and overages

Replace the Overview's dollar headline with the two numbers a subscriber
actually cares about, and re-unit the chart to match.

Status: **built 2026-09-15.** All seven steps of §5 are committed on
`claude/antiburn-overview-usage-28ee30`. Section 8 records where the built
work departs from the plan below, and why.

Base branch: `claude/home-screen-planning-0d134f` (tip `f9811298`, already merged
up from `codex/overview-4-checks-sessions`). It exists locally only — its origin
branch is gone. The Allowance work already on it is complete and validated,
pending Keith's local test; see `overview-allowance-handoff.md` and
`overview-subscription-headlines.md` on that branch. This plan is the
continuation its "Next work" section names.

---

## 1. The shape

Three pieces, top to bottom.

**Left hero — utilization.** One number per provider account: the **peak
percent reached inside a single window**, not a total across many. The target
is 100%, and both directions away from it are bad. Under means you are paying
for allowance you never touch. Over is impossible, because the meter clips —
which is why the right hero exists.

    Today      busiest 5-hour window   72%
    7 days     busiest week            96%
    30 days    busiest week            96%

Peak rather than sum because allowance does not sum. It never rolls over, each
window is use-it-or-lose-it, and Claude runs a 5-hour and a weekly at once, so
any single total across thirty days has to divide by a period that does not
exist. A peak has one honest denominator: the window's own allowance.

**Right hero — overages.** One number per provider: how many times you were
blocked and how long you waited. `3 blocks · 4h 20m waiting`.

**Bottom chart — allowance over time.** The existing 30-day bar chart, but the
bars are allowance consumed rather than dollars, with blocks marked on the
days they happened.

### Why two numbers and not one

Utilization is **supply consumed**. Overage is **demand refused**. The meter
clips at 100%, so once you hit the wall every further request becomes
invisible. Two people both reading "100% used" — one finished their day, one
was locked out at 2pm with four hours of work left. Same meter, opposite
situations. Neither number can be derived from the other.

**The shipped Allowance figure already measures demand, not supply.** It is
built from local priced spend against a learned weekly capacity, so it is not
clipped and *can* exceed the plan. On one real machine over thirty days it
reads 23.7 days' worth for Codex and 39.44 for Claude — 79% and 131% of a
weekly allowance respectively, and the Claude figure is above 100% precisely
because no meter could have produced it. Claude also blocked that machine eight
times in the same period.

So the existing work is half of this plan, not something it replaces. What is
missing is the supply side (the provider's own meter, peak per window) and the
refusals (how often demand was actually turned away, and what the waiting
cost).

---

## 2. What already exists

Verified on `codex/overview-4-checks-sessions`, 2026-09-15.

| Thing | Where | State |
|---|---|---|
| Overview page and its sections | `apps/desktop/src/views/main-window/OverviewView.tsx` | Built, unmerged |
| Cost/Allowance toggle, page-wide | `apps/desktop/src/views/main-window/overview/OverviewUsageTotals.tsx` | Built |
| Allowance arithmetic | `apps/desktop/src/views/main-window/overview/overviewAllowance.ts` | Built, estimate-based — see below |
| The hero strip to be replaced | `apps/desktop/src/views/main-window/overview/OverviewSpendTotals.tsx` | Dollars and tokens today |
| The 30-day chart to be re-united | `apps/desktop/src/views/main-window/overview/OverviewSpendChart.tsx` | Dollars today |
| Live meters per account | `apps/desktop/src/views/main-window/overview/OverviewProviderLimits.tsx` | Current reading only, no history |
| Window instances, durable | `provider_usage_period` table, `apps/desktop/src-tauri/src/store/schema.rs:629` | Built |
| Meter readings, durable | `provider_usage_observation` table, same file line 661 | Built |
| Codex history import | `apps/desktop/src-tauri/src/provider_usage/codex_rollout_history.rs` | Built — reads `token_count.rate_limits` out of every rollout file on disk |
| Dollars-per-percent factor | `apps/desktop/src-tauri/src/provider_usage/factor.rs` | Built |
| Pace, runway, elapsed-vs-used | `apps/desktop/src/lib/presentation/liveUsage.ts` | Built |
| Quota incident type and report section | `crates/antiburn-local/src/insights/quota.rs` | Built, **nothing feeds it** |

That last row is the one to notice. `QuotaIncident` carries timestamp, limit
kind, severity, model, reset time and utilization percent, and it flows all the
way to the DTO — but no vendor parser produces one, and a test asserts Claude
never will: `quota_incidents_are_unsupported_for_claude` in
`crates/antiburn-local/tests/claude_characterization.rs:503`.

### What the data looks like in practice

Measured on one real machine (Keith's), 2026-09-15.

**Codex** writes a full meter on every turn — `used_percent`, `window_minutes`
(300 and 10080), `resets_at`, `plan_type`, plus `rate_limit_reached_type` and
`spend_control_reached`. 16,081 readings spanning 10 Feb to 15 Sep. Both
refusal fields were null throughout, so the meter touched 100% on a few 5-hour
windows but Codex never actually turned him away.

**Claude** writes no meter at all. A block appears only as a transcript record
with `isApiErrorMessage: true` and the text
`"You've hit your session limit · resets 2pm (Australia/Sydney)"`. 34 raw
records deduplicated to 8 distinct blocks over 47 days, totalling 11.1 hours of
waiting. Retries repeat the same message, so dedupe on reset target plus a time
gap.

**The two providers are asymmetric, and the UI has to admit it.** Codex can
answer both questions. Claude can answer overages well and utilization only
from the live poll, which starts when the online opt-in is turned on and holds
at most 2,000 samples (`apps/desktop/src-tauri/src/provider_usage/live/history.rs:46`).

---

## 3. Data work

### 3.1 Claude block events (new)

Parse `isApiErrorMessage` records out of Claude transcripts into
`QuotaIncident` — the type that already exists and is already wired to the
report. Severity `HardHit`, limit kind `RollingWindow`, `reset_ts_ms` from the
message text, `utilization_pct` left null because Claude does not state one.

Dedupe within a session on reset target plus a three-hour gap, so a retry storm
counts once. Wait time is `reset − first hit`, taking the next occurrence of
that clock time.

The reset string is a local time with a named zone, e.g. `2pm (Australia/Sydney)`.
Parse the zone; do not assume the reader's.

**Two traps, both hit while pulling these numbers by hand on 15 Sep.**

*Match the record, not the line.* A transcript line containing the limit phrase
is not necessarily a limit error. Agent sessions that search for that phrase
write the results back into the transcript as `tool_result` content, and a
substring match over raw lines counts those too. Against Keith's transcripts a
loose match inflated 9 all-time refusals to 14. Require the record's own
top-level `isApiErrorMessage` to be true and read the text from
`message.content`.

*Bound the wait.* The reset clock time carries no date. Taking the next
occurrence of that time gives a 23-hour wait when the stated time has already
passed, which a five-hour window cannot produce. Discard, do not clamp, any
computed wait longer than the window: the parse is wrong, and a clamped value
would look like a real five-hour outage.

Flip `SourceCapabilities::quota_incidents` to true for Claude and replace the
characterization test rather than deleting it.

### 3.2 Codex refusals (new, small)

`rate_limit_reached_type` and `spend_control_reached` already arrive in the
payload and are already read past. Carry them into the observation row and emit
a `QuotaIncident` when either is set. This is the only honest source of "Codex
refused me" — a reading of 100% is not a refusal.

### 3.3 Per-period rollups (new)

`provider_usage_observation` is pruned at the session-data retention setting,
capped at 90 days, and `provider_usage_period` rows die with their last
observation (`apps/desktop/src-tauri/src/store/provider_usage_history.rs:203`).
So today the history quietly stops at 90 days.

Utilization is a per-period question — peak `used_percent` reached inside each
window instance — and one row per period is tiny. Write a rollup row when a
period closes: peak percent, whether a refusal landed inside it, and the
period's start and reset. Let it outlive the raw observations.

Without this the hero number cannot say "your busiest week", only "your busiest
week in the last 90 days".

### 3.4 Do not key windows on `resets_at`

It drifts between readings. A naive group-by on it merges and splits windows
wrongly — it produced 5-hour "windows" apparently resetting seven days later in
a throwaway pass over the same data. `provider_usage_period` is the correct
key and already exists.

---

## 4. Presentation decisions

### Settled by prototype, 15 Sep

Five treatments were built against Keith's real data and reviewed in `discuss`
(`scratchpad/proto/overview-usage/band-v5.html`). **Variant A is chosen**: the
weekly meter as the left hero, refusals as the right hero, and the 5-hour peaks
demoted to a cause line under the refusals.

The prototypes settled four things that were open or wrong in this plan.

**1. The two meters answer different questions, and this plan conflated them.**
The 5-hour rolling meter measures burstiness and is what refuses you. The weekly
meter measures plan fit. Keith's week ending 13 Sep proves they are independent:
the 5-hour meter reached 96% and 99%, and the week still closed at 62%. So
**utilization is the weekly meter** and the 5-hour peaks belong beside the block
count as its cause, not in the utilization hero.

**2. Refusals happen at 100% and at nothing less.** Across the 18 five-hour
windows antiburn has recorded, the windows peaking at 96% (8 Sep) and 99%
(11 Sep) refused nothing. The one window that reached 100% (14 Sep 12:36-15:50)
contains the 13:43 refusal exactly. Any "close to the limit" warning threshold
below 100% would be invented. The cause line therefore reads *1 of 18 five-hour
windows reached 100%*, not *N ran past 90%*.

**3. A hero may carry a gauge. It may never carry a time series.** Week-by-week
bars inside the hero duplicate the chart at the bottom of the page. A single
value meter is a gauge and stays. A typical-to-peak band is a distribution, not
a series, and also stays.

**4. Percent is the only unit.** See the moving-allowance risk in section 7.
Dollars, tokens, "days' worth" and "maxed windows per week" all silently change
meaning when the vendor reprices a tier without renaming it.

### The utilization number is a range, not an average

If your average week lands on 100%, half your weeks overshoot and you get
blocked. The two errors are not symmetric: under-use costs a known, small,
fixed amount; over-use costs unpredictable time and a broken flow mid-task. So
the honest number is your **busiest period**, not your mean.

> Busiest week used 96% of your plan. Right plan.

versus

> You average 60% of your plan.

Those are different claims and only the first supports a decision.

**Revised in review: show typical *and* peak, as a range.** A peak alone answers
"can this plan hold me" but not "am I paying for room I never use". Keith asked
for both, and the pair reads as one figure: `40-62%` for Claude, `77-100%` for
Codex.

Typical is the **median**, not the mean. An unspent weekly allowance expires, so
idle periods are real zeroes that drag a mean toward a number no week resembles.
On Keith's 5-hour meter the gap is large: mean 30%, median 15%, because a third
of the windows sit near zero.

The spread between the two is more diagnostic than either endpoint. Claude runs
18-62 and never reaches the ceiling. Codex runs 30-100 and reaches it twice.
Opposite plan advice from the same shape of figure.

**A range needs history this feature does not have yet.** Claude has two weekly
periods; the midpoint of two numbers is not a typical value. Do not show a
typical figure under roughly six periods, or label it provisional until then.
The peak alone is honest at any sample size.

### The verdict line is out of scope

Cut in review. A "Max 5x would have covered 27 of your last 30 days" line needs
tier ratios the provider never states, and it is the one part of this surface
that antiburn would assert rather than observe. Asserting it wrong recommends
someone onto a plan that blocks them.

The heroes therefore say what is happening and leave the decision to the
reader. If a recommendation is wanted later, the version needing no plan
catalogue is the counterfactual in the reader's own units — *you would have hit
this limit on 3 of the last 30 days at half your current allowance* — which is
arithmetic over the period rollups and nothing else.

### Overages lead with time, not money

For anyone without extra usage switched on, the overage **is** the waiting.
Dollars only exist for metered accounts.

### The chart unit

Bars become allowance consumed per day, and days carrying a block get a mark.
Keeping the paired thirty-days-before comparison the chart already draws.

The Cost/Allowance toggle is page-wide, so this is not a new mode — the chart
reads the same metric state the totals read, and the page can never show two
units at once.

Open: whether the bar is *percent of that day's fair share* or *percent of the
window the day sits in*. The second is truer and harder to read.

### Claude's hero is a live reading, and says so

Claude states no meter in its transcripts, so its utilization can only come
from the live poll. It carries the freshness tag the Overview already uses —
`liveFreshnessToneClass` and `liveGraceNote` in
`apps/desktop/src/lib/presentation/liveUsage.ts`, the same tag
`OverviewProviderLimits` floats in its card corner — plus a tooltip.

A live tag makes the number honest but does not make it the same number.
Codex's hero answers *your busiest week used 96%* from months of periods;
Claude's answers *you are at 41% right now*. Different questions in
identical-looking slots. So label each hero by what it measures — Codex reads
`Busiest week`, Claude reads `Right now · live` — and the reader stops
expecting them to be comparable. Claude's hero upgrades itself as live history
accumulates, without the label ever having lied.

### Never fill a gap

`liveUsage.ts` already lives by this rule and the new surfaces inherit it. A
period with no reading renders as unknown, not as zero. A provider with no
plan detected shows no utilization hero at all rather than a hero against a
guessed allowance.

---

## 5. Sequencing

Each step ships on its own.

| # | Step | Touches | Commit |
|---|---|---|---|
| 1 | Claude block parser → `QuotaIncident` | `crates/antiburn-local/src/analysis/vendors/claude.rs`, `evidence.rs`, characterization test | `45cbd283` |
| 2 | Codex refusal fields → `QuotaIncident` | `provider_usage/live/sources/codex_rollout.rs`, `codex_rollout_history.rs` | `e6c3c46e` |
| 3 | Per-period rollup table + retention exemption | `store/schema.rs`, `store/provider_usage_history.rs` | `f09b1128` |
| 4 | Overage query + IPC | `commands.rs`, `dto.rs`, `providerUsageIpc.ts` | `8c2133f6` |
| 5 | Utilization query + IPC (median and peak across periods, per account) | same | `8c2133f6` |
| 6 | Replace the hero strip | `overview/OverviewUsageTotals.tsx`, `overview/overviewAllowance.ts` | `3562460f` |
| 7 | Re-unit the chart on the Allowance branch | `overview/OverviewAllowanceChart.tsx`, `overview/overviewChartParts.tsx`, `lib/presentation/overviewChart.ts` | `919fcd6f` |

Steps 1–3 are independently useful — they also feed the existing Burn checks
report, which has had a quota-pressure section with nothing to show since it
was written.

---

## 6. Settled

Reviewed 2026-09-15; every question from that review is answered. The toggle
exists and is page-wide, `days' worth` is dropped, the verdict line is cut, the
base branch is `claude/home-screen-planning-0d134f`, and Claude's hero carries
a live label.

### Source: meter first, estimate as fallback — with one refinement

**Decided:** where a provider states its own meter, the utilization figure
reads the meter. The learned-factor estimate stays as the fallback for accounts
that have none. That drops the `seeded` caveat for Codex.

**Refinement found after that decision, for step 5.** The two sources do not
measure the same thing, so replacing one with the other loses information:

- the **meter** is clipped at 100% — it is *supply consumed*;
- the shipped **estimate** is uncapped and can exceed the plan — it is
  *demand*, which is why Claude reads 131% over thirty days.

Swapping the estimate out for the meter would delete the most informative
number on the page. So keep both, and give each the job it can actually do:

| Figure | Source | Reads |
|---|---|---|
| Utilization hero | provider meter, peak per period | `busiest week 96%` |
| Demand | existing learned-factor estimate, uncapped | `131% of plan wanted` |
| Overages hero | refusal events | `8 blocks · 11h waiting` |

The estimate keeps its `seeded` and `partial` caveats, because as a demand
figure it is still an estimate. The hero sheds them, because the meter is the
provider's own statement.

### Correction to the earlier read of `overviewAllowance.ts`

During review I described the displayed figure as a per-period *rate*. It is
not. `overviewAllowance.ts` computes `percent = weekly * (7 / days)` and
`daysWorth` in `OverviewSpendTotals.tsx` computes `percent * days / 100` — the
period factors cancel exactly, so the number on screen is
`weeklyPercent * 7 / 100`, a cumulative total. The pair only exists to pass a
normalized value between two functions. Both halves go together or neither.

### Session attribution is a reason to prefer the meter

`overview-allowance-handoff.md` records that a session's whole usage lands on
the date of its last activity, so one long session can spike a day. The meter
carries no such distortion: a reading is stamped when the provider stated it.
Worth stating on the chart, where daily bars make the distortion visible.

## 7. Risks

- **The Claude parser is matching an error string.** Claude Code can reword it
  in any release. Match loosely, test against fixtures, and treat a miss as
  no-incident rather than a crash.
- **Telling subscribers to use more conflicts with antiburn's whole posture.**
  For a metered user, less is better; for a subscriber, unused allowance is
  waste. The subscriber's version of antiburn is fit and rhythm — right plan,
  no walls, no idle allowance — not frugality. Worth settling before the copy
  is written, because it changes every verb.
- **Two sources on one page.** The meter and the estimate will not agree, and
  they are not meant to — one is clipped, one is not. The page must label them
  so the difference reads as information rather than as a bug. If that labelling
  cannot be made clear, show the meter alone.
- **The allowance moves under us.** Anthropic changed the Max allowance twice in
  September 2026 — down about half, then up a quarter — without changing the
  tier string. `provider_usage_observation.plan_tier` reads
  `default_claude_max_5x` on both sides of the change, so the tier cannot detect
  it. Three consequences:
  - `usd_per_percent` in `provider_usage/factor.rs` already decays: a weighted
    median, a `0.5^(age_days / 7)` weight, a 14-day sample window, and
    `filter_by_plan` to drop old-plan samples. The gap is that `plan_changed`
    (`factor.rs:388`) compares the `plan` / `plan_tier` strings, so a change
    inside a tier never sets it. Only the seven-day half-life responds, and a
    weighted median does not move until new samples own half the weight — about
    a week of a figure that can be 2× wrong after a 50% cut. Filed as
    antiburn/antiburn#551.
  - The percentage meter is the only figure that survives the change, because it
    self-normalises. Every absolute unit — dollars, tokens, "days' worth",
    "maxed-out windows per week" — silently changes meaning. Do not put an
    absolute capacity claim on the page.
  - A utilization trend that straddles the change is uninterpretable: a fall from
    100% to 50% means either less work or a bigger allowance. The chart needs a
    marker where the exchange rate steps, or a window short enough not to
    straddle one.

  The detectable signal is the exchange rate itself: weekly percent consumed per
  unit of observed work. antiburn already stores both series. In Keith's data it
  moved from 16.3% of the week per maxed 5-hour window (8-13 Sep) to 11.6%
  (13-20 Sep) — the right shape, on too little data to confirm.
- **Refusals are the durable number.** A block means the same thing before and
  after a repricing; a percentage does not. This is an argument for the overages
  hero carrying more of the page's weight than the utilization hero.

---

## 8. Where the build departed from this plan

Four decisions changed while the code was written. Each one is a place the
plan asked for something antiburn cannot honestly say, or a better place to
put the same rule.

### The engine stores a reset clock, not a reset timestamp

`antiburn-local` has no network and no IANA timezone database, so it cannot
turn a Claude limit error's reset string into an instant. It records a
`QuotaResetClock` — the hour, the minute, and the zone name the provider
wrote — and the desktop crate resolves it with `jiff`.

The reset string carries no date. Taking the next occurrence of that clock
gives a five-hour window a wait of 19 to 23 hours, which that window cannot
produce. A wait longer than the window is **discarded, not clamped**: the
block still counts, and it contributes no time. A clamped wait would state
a figure the evidence does not support.

### Retry-storm dedupe lives at the query layer

The plan put the dedupe in the parser. It is in `allowance::blocks` instead,
grouped by time and account rather than by session. One block that two
transcripts recorded then counts once, and no resume-snapshot state changes.

### The utilization hero label comes from the stored window kind

§4 asks for "Busiest week" on Codex and "Right now · live" on Claude. The
payload carries no live-versus-history distinction, and inventing one would
be a claim antiburn cannot back. Instead the rollup row's `window_kind`
(`weekly`, `rolling`, or the provider's own word) rides through `Utilization`
to the DTO, and `periodNoun` in `overviewAllowance.ts` derives the label from
it. The newest period names the window, so a provider that renames a window
does not leave a stale name behind.

A Claude account with only live readings therefore reads `Busiest week` over
a one-week sample, and the caption says `peak of 1 week`. The sample size is
stated rather than dressed as a different question.

### The daily chart reads the meter through its own series

§6 already says the meter is the reason to prefer it over the dollar series.
The chart needed a series the plan did not specify, so step 7 added one:
`provider_usage_readings` returns raw `primaryLong` readings, and
`allowance::consumption` reduces them to per-day rises — the first reading of
a period contributes its whole value, a later reading the rise since the one
before it, and a fall inside a period consumes nothing.

Two details follow from "never fill a gap". The query starts one weekly
window before the series, so a period straddling the first day does not
credit its whole rise to that day. And a day is known only when a reading
span covers it: two readings that bracket a day prove the meter did not move,
so zero is a true figure there, while a day no span touches reports null and
draws as an outlined dot.
