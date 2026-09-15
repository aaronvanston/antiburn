import type {
  AllowanceUsageSummaryPayload,
  ProviderUsageWindowsPayload,
} from "../../../lib/providerUsageIpc"
import { SegmentedControl } from "../../../components/ui/SegmentedControl"
import { OverviewAllowanceTotals } from "./OverviewAllowanceTotals"
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
 * The Overview's headline, in one of two units.
 *
 * Cost states what the local sessions would cost at list price. Allowance
 * states how much of each subscription the provider's own meter reports,
 * and how often the provider refused a request. A subscriber pays one price
 * whatever the token count, so the dollar figure answers a question they do
 * not have.
 *
 * The choice is page-wide. The chart below reads the same state, so the page
 * can never show two units at once.
 */
export function OverviewUsageTotals({
  metric,
  onMetricChange,
  totals,
  allowance,
  loading = false,
}: {
  metric: OverviewMetric
  onMetricChange: (next: OverviewMetric) => void
  totals: ProviderUsageWindowsPayload | null
  allowance: AllowanceUsageSummaryPayload | null
  loading?: boolean
}) {
  return (
    <div className="flex flex-col gap-[var(--space-md)]">
      <SegmentedControl
        options={METRICS}
        value={metric}
        onChange={onMetricChange}
        ariaLabel="Usage unit"
        variant="text-tabs"
        className="self-start"
      />
      {metric === "cost" ? (
        <OverviewSpendTotals totals={totals} loading={loading} />
      ) : (
        <OverviewAllowanceTotals
          accounts={allowanceAccounts(allowance)}
          spanDays={allowance?.overageSpanDays ?? 0}
          loading={loading && !allowance}
        />
      )}
    </div>
  )
}
