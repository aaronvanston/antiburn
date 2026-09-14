import { CheckCircle2, CircleDashed } from "lucide-react"

import type { ChecksCategoryPayload, ChecksReportPayload } from "../../../lib/insightsIpc"
import { checksPresentation, formatTokenBurnPercent } from "../../../lib/presentation/checks"
import { sessionCountLabel } from "../../../lib/presentation/providerUsage"
import { checkRowPresentation } from "../../checks/checkUi"

import { SegmentedRadialDial } from "../../../components/ui/SegmentedRadialDial"
import { Skeleton } from "../../../components/ui/Skeleton"

/** The most finding rows the panel lists. The full report has the rest. */
const OVERVIEW_FINDING_ROWS = 2

/** The report hero's dial at half its size, with the same stroke ratio. */
const OVERVIEW_DIAL_SIZE = 44
const OVERVIEW_DIAL_STROKE = 4
/** The shortest visible arc, in pixels, so a small burn never vanishes. */
const MIN_BURN_ARC_LENGTH = 4
const MIN_BURN_BASIS_POINTS =
  (MIN_BURN_ARC_LENGTH / (Math.PI * (OVERVIEW_DIAL_SIZE - OVERVIEW_DIAL_STROKE))) * 10_000

type OverviewChecksState = "findings" | "passed" | "pending"

interface OverviewChecksSummary {
  state: OverviewChecksState
  /** The prominent line: the burn estimate when known, else the result. */
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
export function overviewChecksSummary(report: ChecksReportPayload): OverviewChecksSummary {
  const presentation = checksPresentation(report)
  const failures = rankedFailures(presentation.failures)
  const passed = presentation.wins.length
  if (failures.length > 0) {
    const burn = report.estimatedTokenBurnBasisPoints
    const result = [
      countLabel(failures.length, "finding"),
      passed > 0 ? `${passed} passed` : null,
    ]
      .filter(Boolean)
      .join(" · ")
    if (burn != null) {
      return {
        state: "findings",
        headline: `${formatTokenBurnPercent(burn)} estimated token burn`,
        detail: result,
        rows: failures.slice(0, OVERVIEW_FINDING_ROWS),
      }
    }
    return {
      state: "findings",
      headline: result,
      detail: report.evidenceSettled
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

/** The report hero's dial: the burn share over the rest, or a grey ring. */
function BurnDial({ report }: { report: ChecksReportPayload | null }) {
  const burn = report?.estimatedTokenBurnBasisPoints ?? null
  const displayed = burn != null && burn > 0 ? Math.max(burn, MIN_BURN_BASIS_POINTS) : burn
  return (
    <SegmentedRadialDial
      size={OVERVIEW_DIAL_SIZE}
      strokeWidth={OVERVIEW_DIAL_STROKE}
      gapAngle={0}
      strokeLinecap="butt"
      segments={
        displayed == null
          ? [{ id: "unknown", value: 1, className: "text-surface-tertiary" }]
          : [
              { id: "burn", value: displayed, className: "text-brand-tint" },
              {
                id: "remainder",
                value: Math.max(0, 10_000 - displayed),
                className: "text-measure",
              },
            ]
      }
    />
  )
}

/**
 * The Burn checks panel: the report hero's dial beside the burn estimate,
 * then at most two finding rows. The header and every row are buttons that
 * open the full Burn checks section.
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
  const FooterIcon = summary?.state === "passed" ? CheckCircle2 : CircleDashed
  return (
    <section
      aria-label="Burn checks"
      aria-busy={loading || undefined}
      className="rounded-control bg-surface-card p-[var(--space-lg)] shadow-stats-card"
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={summary ? `Open Burn checks: ${summary.headline}` : "Open Burn checks"}
        className="group flex w-full items-center gap-[var(--space-md)] rounded-control text-left"
      >
        <span aria-hidden="true" className="grid shrink-0 place-items-center">
          <BurnDial report={report} />
        </span>
        <span className="min-w-0 flex-1">
          {summary ? (
            <>
              <span className="block truncate type-title-2 text-label group-hover:text-brand">
                {summary.headline}
              </span>
              {summary.detail && (
                <span className="block truncate type-callout text-label-secondary">
                  {summary.detail}
                </span>
              )}
            </>
          ) : (
            <>
              <Skeleton className="h-4 w-36" />
              <Skeleton className="mt-1.5 h-3 w-24" />
            </>
          )}
        </span>
      </button>
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
          <FooterIcon size={14} strokeWidth={2} aria-hidden="true" />
          {summary.state === "passed"
            ? "Nothing to review right now."
            : "Findings appear here once the scan finishes."}
        </p>
      )}
    </section>
  )
}
