import { fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type {
  AllowanceUsageAccountPayload,
  AllowanceUsageSummaryPayload,
  ProviderUsageWindowsPayload,
} from "../../../lib/providerUsageIpc"
import { OverviewUsageTotals } from "./OverviewUsageTotals"

const TOTALS: ProviderUsageWindowsPayload = {
  today: window_(1.5),
  week: window_(12.25),
  last30Days: window_(48),
  monthToDate: window_(30),
}

function window_(estimatedUsd: number) {
  return {
    tokensIn: 1_000,
    tokensOut: 500,
    cacheRead: 0,
    estimatedUsd,
    costComplete: true,
    sessionCount: 3,
  }
}

function account(
  overrides: Partial<AllowanceUsageAccountPayload> = {},
): AllowanceUsageAccountPayload {
  return {
    provider: "anthropic",
    displayName: "Claude",
    accountKey: "account",
    utilization: {
      typicalPercent: 40,
      peakPercent: 62,
      periodCount: 9,
      maxedPeriodCount: 0,
      windowKind: "weekly",
      firstPeriodAt: "2026-07-13T00:00:00Z",
      lastPeriodAt: "2026-09-14T00:00:00Z",
    },
    burst: {
      typicalPercent: 15,
      peakPercent: 100,
      periodCount: 18,
      maxedPeriodCount: 1,
      windowKind: "rolling",
      firstPeriodAt: "2026-08-30T00:00:00Z",
      lastPeriodAt: "2026-09-14T00:00:00Z",
    },
    overage: {
      blockCount: 8,
      waitedSeconds: 39_960,
      blocksWithoutWait: 0,
      lastBlockAt: "2026-09-14T03:43:00Z",
    },
    ...overrides,
  }
}

function summary(
  accounts: AllowanceUsageAccountPayload[] = [account()],
): AllowanceUsageSummaryPayload {
  return { accounts, overageSpanDays: 30, generatedAt: "2026-09-15T00:00:00Z" }
}

function renderTotals(
  overrides: Partial<Parameters<typeof OverviewUsageTotals>[0]> = {},
): (next: "cost" | "allowance") => void {
  const onMetricChange = vi.fn()
  render(
    <OverviewUsageTotals
      metric="allowance"
      onMetricChange={onMetricChange}
      totals={TOTALS}
      allowance={summary()}
      {...overrides}
    />,
  )
  return onMetricChange
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("OverviewUsageTotals", () => {
  it("shows the spend figures on the cost branch and the meters on the allowance branch", () => {
    const { rerender } = render(
      <OverviewUsageTotals
        metric="cost"
        onMetricChange={vi.fn()}
        totals={TOTALS}
        allowance={summary()}
      />,
    )
    expect(screen.getByRole("region", { name: "Estimated local spend" })).toBeInTheDocument()
    expect(screen.queryByRole("region", { name: "Allowance" })).not.toBeInTheDocument()

    rerender(
      <OverviewUsageTotals
        metric="allowance"
        onMetricChange={vi.fn()}
        totals={TOTALS}
        allowance={summary()}
      />,
    )
    expect(screen.getByRole("region", { name: "Allowance" })).toBeInTheDocument()
    expect(
      screen.queryByRole("region", { name: "Estimated local spend" }),
    ).not.toBeInTheDocument()
  })

  it("hands the page the unit the reader picked", () => {
    const onMetricChange = renderTotals()
    fireEvent.click(screen.getByRole("radio", { name: "Cost" }))
    expect(onMetricChange).toHaveBeenCalledWith("cost")
  })

  it("states utilization as a range and the blocks beside it with their cause", () => {
    renderTotals()
    const cell = screen.getByRole("region", { name: "Allowance" })

    expect(within(cell).getByText("Busiest week")).toBeInTheDocument()
    expect(within(cell).getByText("40-62%")).toBeInTheDocument()
    expect(within(cell).getByText("typical to peak of 9 weeks")).toBeInTheDocument()
    expect(within(cell).getByText("8")).toBeInTheDocument()
    expect(within(cell).getByText(/blocks in 30 days/)).toBeInTheDocument()
    expect(within(cell).getByText(/11h waiting/)).toBeInTheDocument()
    expect(within(cell).getByText("1 of 18 windows reached 100%")).toBeInTheDocument()
  })

  it("shows no utilization figure for an account with no meter history", () => {
    // A gap is unknown, never zero. An account the provider never metered
    // gets no hero rather than a hero against a made-up allowance.
    renderTotals({ allowance: summary([account({ utilization: null })]) })
    const cell = screen.getByRole("region", { name: "Allowance" })

    expect(within(cell).queryByText(/Busiest/)).not.toBeInTheDocument()
    expect(within(cell).getByText("8")).toBeInTheDocument()
  })

  it("says the readings have not arrived rather than showing an empty meter", () => {
    renderTotals({ allowance: summary([]) })
    expect(screen.getByText(/no allowance readings yet/)).toBeInTheDocument()
  })
})
