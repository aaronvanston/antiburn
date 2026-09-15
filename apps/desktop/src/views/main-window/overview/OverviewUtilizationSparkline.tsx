import type { AllowanceUtilizationPayload } from "../../../lib/providerUsageIpc"
import { MAXED_PERCENT, utilizationCaption } from "./overviewAllowance"

import "./overview.css"

/**
 * The periods behind the utilization figure, oldest on the left.
 *
 * A caption that names a count of periods tells the reader how many periods
 * the figure covers. It does not tell them the shape. A steady account and
 * an account that spikes once read the same in that sentence and read
 * differently here, so the drawing replaces the sentence.
 *
 * Every bar reads against the same ceiling: the full plan, or the peak when
 * a period goes over the plan. The top of the box is therefore 100% of the
 * allowance in the usual case.
 *
 * The sentence stays as the accessible name, because a screen reader needs
 * the words the drawing replaces.
 */

/** How many of the newest periods the sparkline draws. */
const SPARKLINE_MAX_PERIODS = 26

export function OverviewUtilizationSparkline({
  utilization,
}: {
  utilization: AllowanceUtilizationPayload
}) {
  const periods = utilization.periodPeaks.slice(-SPARKLINE_MAX_PERIODS)
  if (periods.length === 0) return null
  const ceiling = Math.max(MAXED_PERCENT, ...periods)
  return (
    <div
      role="img"
      aria-label={utilizationCaption(utilization)}
      className="overview-sparkline mt-[var(--space-xs)]"
    >
      {periods.map((percent, index) => (
        <span
          // The payload states a figure for each period and no key of its
          // own. The list is static between reads, so the place is the key.
          key={index}
          aria-hidden="true"
          className="overview-sparkline-bar bg-series-1"
          style={{ blockSize: `${(percent / ceiling) * 100}%` }}
        />
      ))}
    </div>
  )
}
