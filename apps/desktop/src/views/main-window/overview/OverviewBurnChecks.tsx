import { ArrowRight, CheckCircle2, CircleDashed, Flame } from "lucide-react"

import type { ChecksCategoryPayload, ChecksReportPayload } from "../../../lib/insightsIpc"
import { checksPresentation, formatTokenBurnPercent } from "../../../lib/presentation/checks"
import { sessionCountLabel } from "../../../lib/presentation/providerUsage"
import { checkRowPresentation } from "../../checks/checkUi"

import { Skeleton } from "../../../components/ui/Skeleton"

/** The most finding rows the panel lists. The full report has the rest. */
const OVERVIEW_FINDING_ROWS = 2

type OverviewChecksState = "findings" | "passed" | "pending"

interface OverviewChecksSummary {
  state: OverviewChecksState
  /** The one-line result, for example "2 findings · 7 passed". */
  headline: string
  /** The muted line under the headline, or null when nothing adds to it. */
  detail: string | null
  /** The finding rows to list, highest estimated burn first. */
  rows: ChecksCategoryPayload[]
}

function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`
}

/**
 * Rank the failed checks for the short list: the highest estimated burn
 * first, then the most affected sessions. `checksPresentation` already
 * sorts by estimate, so only the tie needs breaking here.
 */
function rankedFailures(failures: readonly ChecksCategoryPayload[]): ChecksCategoryPayload[] {
  return [...failures].sort(
    (left, right) =>
      (right.estimatedTokenBurnBasisPoints ?? -1) -
        (left.estimatedTokenBurnBasisPoints ?? -1) || right.finding - left.finding,
  )
}

/**
 * Reduce the report to the panel's three states. A report that still has
 * evidence in flight and no finding yet reads as pending, never as a clean
 * pass: an unsettled zero is not a result.
 */
function overviewChecksSummary(report: ChecksReportPayload): OverviewChecksSummary {
  const presentation = checksPresentation(report)
  const failures = rankedFailures(presentation.failures)
  const passed = presentation.wins.length
  if (failures.length > 0) {
    const burn = report.estimatedTokenBurnBasisPoints
    return {
      state: "findings",
      headline: [countLabel(failures.length, "finding"), passed > 0 ? `${passed} passed` : null]
        .filter(Boolean)
        .join(" · "),
      detail:
        burn != null
          ? `${formatTokenBurnPercent(burn)} estimated token burn`
          : report.evidenceSettled
            ? null
            : `Still assessing ${sessionCountLabel(report.pendingEvidence)}`,
      rows: failures.slice(0, OVERVIEW_FINDING_ROWS),
    }
  }
  if (report.evidenceSettled && passed > 0) {
    return {
      state: "passed",
      headline: `All ${countLabel(passed, "check")} passed`,
      detail: null,
      rows: [],
    }
  }
  return {
    state: "pending",
    headline: report.evidenceSettled ? "No checks assessed" : "Assessing sessions",
    detail: report.evidenceSettled
      ? "Findings appear after the first scan."
      : "Results appear when the scan finishes.",
    rows: [],
  }
}

const STATE_ICON = { findings: Flame, passed: CheckCircle2, pending: CircleDashed } as const

const STATE_MARK_CLASS: Record<OverviewChecksState, string> = {
  findings: "bg-brand-tint/15 text-brand",
  passed: "bg-burn-check-pass-fill/15 text-burn-check-pass-fill",
  pending: "bg-surface-tertiary text-label-tertiary",
}

/**
 * The Burn checks panel: one rollup line with a "More" link, then at most
 * two finding rows. Every control opens the full Burn checks section.
 */
export function OverviewBurnChecks({
  report,
  loading = false,
  onOpen,
}: {
  report: ChecksReportPayload | null
  loading?: boolean
  onOpen: () => void
}) {
  const summary = report ? overviewChecksSummary(report) : null
  const Icon = STATE_ICON[summary?.state ?? "pending"]
  return (
    <section
      aria-label="Burn checks"
      aria-busy={loading || undefined}
      className="rounded-control bg-surface-card p-[var(--space-lg)] shadow-stats-card"
    >
      <div className="flex items-center gap-[var(--space-md)]">
        <span
          aria-hidden="true"
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-[9999px] ${STATE_MARK_CLASS[summary?.state ?? "pending"]}`}
        >
          <Icon size={18} strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          {summary ? (
            <>
              <p className="truncate type-body font-semibold! text-label">{summary.headline}</p>
              {summary.detail && (
                <p className="truncate type-caption text-label-secondary">{summary.detail}</p>
              )}
            </>
          ) : (
            <>
              <Skeleton className="h-3.5 w-36" />
              <Skeleton className="mt-1.5 h-3 w-24" />
            </>
          )}
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex shrink-0 items-center gap-1 self-start type-caption text-label-secondary hover:text-label hover:underline hover:underline-offset-[3px]"
        >
          More
          <ArrowRight size={12} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
      {summary?.state === "findings" && (
        <ul className="mt-[var(--space-md)] divide-y divide-separator border-t border-separator">
          {summary.rows.map((check) => {
            const row = checkRowPresentation(check)
            return (
              <li key={check.id}>
                <button
                  type="button"
                  onClick={onOpen}
                  className="grid w-full grid-cols-[auto_minmax(0,1fr)_max-content] items-center gap-[var(--space-sm)] py-[var(--space-sm)] text-left type-callout text-label hover:text-brand"
                >
                  <row.Icon
                    size={14}
                    strokeWidth={1.75}
                    className="text-label-tertiary"
                    aria-hidden="true"
                  />
                  <span className="truncate">{row.label}</span>
                  <span className="type-caption tabular-nums text-burn-check-failure-text">
                    {sessionCountLabel(check.finding)}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {summary && summary.state !== "findings" && (
        <p
          className={`mt-[var(--space-md)] flex items-center gap-[var(--space-sm)] border-t border-separator pt-[var(--space-sm)] type-callout ${
            summary.state === "passed" ? "text-burn-check-pass-fill" : "text-label-secondary"
          }`}
        >
          <Icon size={14} strokeWidth={2} aria-hidden="true" />
          {summary.state === "passed"
            ? "Nothing to review right now."
            : "Findings appear here once the scan finishes."}
        </p>
      )}
    </section>
  )
}
