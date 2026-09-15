import type {
  AllowanceOveragePayload,
  AllowanceUsageAccountPayload,
  AllowanceUsageSummaryPayload,
  AllowanceUtilizationPayload,
} from "../../../lib/providerUsageIpc"

/**
 * How the Overview states one account's two allowance numbers.
 *
 * Utilization is supply consumed: the share of the plan the provider's own
 * meter reports. Overage is demand refused: how often the provider blocked
 * a request. Neither follows from the other, so no function here derives
 * one from the other.
 *
 * Percent is the only unit. A dollar figure, a token count, and a "days'
 * worth" all change meaning when a vendor reprices a tier without renaming
 * it, and a reader cannot tell that happened.
 */

/** The figure a window reaches when the provider has nothing left to give. */
export const MAXED_PERCENT = 100

/** One hour in seconds, for reading a wait in hours. */
const SECONDS_PER_HOUR = 3600

/** Round a percentage the way every allowance figure on this page rounds. */
function percentFigure(percent: number): string {
  return `${Math.round(percent)}%`
}

/**
 * The utilization hero figure: a typical-to-peak range, or the peak alone.
 *
 * A peak answers "can this plan hold me". It does not answer "am I paying
 * for room I never use", which is why the pair reads as one figure. The
 * range collapses to the peak while the sample is too small for a typical
 * value, and the peak is honest at any sample size.
 */
export function utilizationFigure(utilization: AllowanceUtilizationPayload): string {
  const peak = percentFigure(utilization.peakPercent)
  if (utilization.typicalPercent == null) return peak
  return `${Math.round(utilization.typicalPercent)}-${peak}`
}

/**
 * The noun for one instance of a window, as the store names the window.
 *
 * The weekly window measures plan fit and the rolling window measures
 * burstiness. A reader who does not know which window a figure covers reads
 * the wrong question, so every utilization label names it.
 */
function periodNoun(windowKind: string, count: number): string {
  if (windowKind === "weekly") return count === 1 ? "week" : "weeks"
  if (windowKind === "rolling") return count === 1 ? "window" : "windows"
  return count === 1 ? "period" : "periods"
}

/** The heading over the utilization figure. It names the window measured. */
export function utilizationLabel(utilization: AllowanceUtilizationPayload): string {
  return `Busiest ${periodNoun(utilization.windowKind, 1)}`
}

/** What the utilization figure measures, in the reader's words. */
export function utilizationCaption(utilization: AllowanceUtilizationPayload): string {
  const count = utilization.periodCount
  const periods = `${count} ${periodNoun(utilization.windowKind, count)}`
  if (utilization.typicalPercent == null) return `peak of ${periods}`
  return `typical to peak of ${periods}`
}

/** The figure for a number antiburn does not hold. It is not a zero. */
const UNKNOWN_FIGURE = "\u2014"

/**
 * The overage hero figure: the time the reader waited on the provider.
 *
 * A block that states no usable reset contributes no time. When no block
 * states one, the wait is unknown and the figure says so. A zero there would
 * claim the reader waited no time, which is a different and false claim.
 */
export function blockedFigure(overage: AllowanceOveragePayload): string {
  if (overage.blockCount === 0) return "0h"
  if (overage.waitedSeconds <= 0) return UNKNOWN_FIGURE
  const hours = overage.waitedSeconds / SECONDS_PER_HOUR
  if (hours < 1) return `${Math.max(1, Math.round(overage.waitedSeconds / 60))}m`
  return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)}h`
}

/** How many blocks the wait above covers, over the span it covers. */
export function blockedCaption(overage: AllowanceOveragePayload, spanDays: number): string {
  const blocks = overage.blockCount === 1 ? "block" : "blocks"
  return `${overage.blockCount} ${blocks} in ${spanDays} days`
}

/**
 * The blocks that state no reset, or null when every block states one.
 *
 * The wait above covers only the blocks that state a reset. This note tells
 * the reader how many blocks the figure leaves out.
 */
export function blockedNote(overage: AllowanceOveragePayload): string | null {
  if (overage.blocksWithoutWait === 0) return null
  if (overage.blocksWithoutWait === overage.blockCount) return "no stated reset"
  return `${overage.blocksWithoutWait} with no stated reset`
}

/**
 * Why the blocks happened, from the short rolling window.
 *
 * A refusal happens at 100% and at nothing less. Across the five-hour
 * windows antiburn has recorded, windows peaking at 96% and 99% refused
 * nothing, so this line names no threshold below the ceiling.
 */
export function causeLine(burst: AllowanceUtilizationPayload | null): string | null {
  if (!burst || burst.periodCount === 0) return null
  if (burst.maxedPeriodCount === 0) return null
  const windows = periodNoun(burst.windowKind, burst.periodCount)
  return `${burst.maxedPeriodCount} of ${burst.periodCount} ${windows} reached ${MAXED_PERCENT}%`
}

/** True when an account has a number worth a cell of its own. */
export function hasAllowanceFigures(account: AllowanceUsageAccountPayload): boolean {
  return account.utilization != null || account.overage.blockCount > 0
}

/**
 * The accounts that have a number worth a cell.
 *
 * The backend sorts the accounts by provider and by account key. That order
 * keeps each cell in the same place between two reads.
 */
export function allowanceAccounts(
  summary: AllowanceUsageSummaryPayload | null,
): AllowanceUsageAccountPayload[] {
  if (!summary) return []
  return summary.accounts.filter(hasAllowanceFigures)
}
