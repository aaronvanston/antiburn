import type {
  AllowanceUsageSummaryPayload,
  ProviderUsageDayPayload,
  ProviderUsageWindowsPayload,
} from "../../../lib/providerUsageIpc"
import { SegmentedControl } from "../../../components/ui/SegmentedControl"
import { OverviewAllowanceChart } from "./OverviewAllowanceChart"
import { OverviewAllowanceTotals } from "./OverviewAllowanceTotals"
import { OverviewSpendChart } from "./OverviewSpendChart"
import { OverviewSpendTotals } from "./OverviewSpendTotals"
import { allowanceAccounts } from "./overviewAllowance"

import "./overview.css"

/** Which unit the whole Overview page reads in. */
export type OverviewMetric = "cost" | "allowance"

const METRICS: ReadonlyArray<{ value: OverviewMetric; label: string }> = [
  { value: "cost", label: "Cost" },
  { value: "allowance", label: "Allowance" },
]

/**
 * The Overview's usage block, in one of two units.
 *
 * Cost states what the local sessions would cost at list price. Allowance
 * states how much of each subscription the provider's own meter reports,
 * and how often the provider refused a request. A subscriber pays one price
 * whatever the token count, so the dollar figure answers a question they do
 * not have.
 *
 * The unit control sits over the chart and the figures together, because it
 * changes both. A control beside one of them would read as the control of
 * that one alone.
 *
 * The chart comes first: the shape of the last 30 days is the reason to
 * open this page, and the figures under it summarize that shape.
 */
export function OverviewUsage({
  metric,
  onMetricChange,
  totals,
  days,
  previousDays,
  allowance,
  loading = false,
}: {
  metric: OverviewMetric
  onMetricChange: (next: OverviewMetric) => void
  totals: ProviderUsageWindowsPayload | null
  days: ProviderUsageDayPayload[]
  previousDays: ProviderUsageDayPayload[]
  allowance: AllowanceUsageSummaryPayload | null
  loading?: boolean
}) {
  return (
    <section
      aria-label="Usage"
      className="overview-usage flex min-h-0 flex-1 flex-col gap-[var(--space-lg)]"
    >
      <SegmentedControl
        options={METRICS}
        value={metric}
        onChange={onMetricChange}
        ariaLabel="Usage unit"
        variant="text-tabs"
        className="self-start"
      />
      {metric === "cost" ? (
        <>
          <OverviewSpendChart days={days} previousDays={previousDays} loading={loading} />
          <OverviewSpendTotals totals={totals} loading={loading} />
        </>
      ) : (
        <>
          <OverviewAllowanceChart
            accounts={allowanceAccounts(allowance)}
            loading={loading && !allowance}
          />
          <OverviewAllowanceTotals
            accounts={allowanceAccounts(allowance)}
            spanDays={allowance?.overageSpanDays ?? 0}
            loading={loading && !allowance}
          />
        </>
      )}
    </section>
  )
}
