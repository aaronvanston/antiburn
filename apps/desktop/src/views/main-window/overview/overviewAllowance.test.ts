import { describe, expect, it } from "vitest"

import type {
  AllowanceOveragePayload,
  AllowanceUsageAccountPayload,
  AllowanceUsageSummaryPayload,
  AllowanceUtilizationPayload,
} from "../../../lib/providerUsageIpc"
import {
  allowanceAccounts,
  blockedCaption,
  blockedFigure,
  blockedNote,
  causeLine,
  hasAllowanceFigures,
  utilizationCaption,
  utilizationFigure,
  utilizationLabel,
} from "./overviewAllowance"

function utilization(
  overrides: Partial<AllowanceUtilizationPayload> = {},
): AllowanceUtilizationPayload {
  return {
    typicalPercent: 40,
    peakPercent: 62,
    periodCount: 9,
    maxedPeriodCount: 0,
    windowKind: "weekly",
    firstPeriodAt: "2026-07-13T00:00:00Z",
    lastPeriodAt: "2026-09-14T00:00:00Z",
    ...overrides,
  }
}

function account(
  overrides: Partial<AllowanceUsageAccountPayload> = {},
): AllowanceUsageAccountPayload {
  return {
    provider: "anthropic",
    displayName: "Claude",
    accountKey: "account",
    utilization: utilization(),
    burst: null,
    overage: {
      blockCount: 0,
      waitedSeconds: 0,
      blocksWithoutWait: 0,
      lastBlockAt: null,
    },
    days: [],
    previousDays: [],
    ...overrides,
  }
}

describe("utilizationFigure", () => {
  it("states a typical-to-peak range once enough periods exist", () => {
    expect(utilizationFigure(utilization())).toBe("40-62%")
  })

  it("states the peak alone while the sample is too small for a typical figure", () => {
    expect(utilizationFigure(utilization({ typicalPercent: null, periodCount: 2 }))).toBe("62%")
  })
})

describe("utilizationLabel and utilizationCaption", () => {
  it("names the weekly window, which measures plan fit", () => {
    const weekly = utilization()
    expect(utilizationLabel(weekly)).toBe("Busiest week")
    expect(utilizationCaption(weekly)).toBe("typical to peak of 9 weeks")
  })

  it("names the rolling window, which measures burstiness", () => {
    const rolling = utilization({
      windowKind: "rolling",
      typicalPercent: null,
      periodCount: 18,
    })
    expect(utilizationLabel(rolling)).toBe("Busiest window")
    expect(utilizationCaption(rolling)).toBe("peak of 18 windows")
  })

  it("falls back to a neutral noun for a window it does not know", () => {
    const other = utilization({ windowKind: "other:fortnightly", periodCount: 7 })
    expect(utilizationLabel(other)).toBe("Busiest period")
    expect(utilizationCaption(other)).toBe("typical to peak of 7 periods")
  })
})

function overage(overrides: Partial<AllowanceOveragePayload> = {}): AllowanceOveragePayload {
  return {
    blockCount: 2,
    waitedSeconds: 8220,
    blocksWithoutWait: 0,
    lastBlockAt: "2026-09-14T03:43:00Z",
    ...overrides,
  }
}

describe("blockedFigure", () => {
  it("reads a long wait in hours and a short one in minutes", () => {
    expect(blockedFigure(overage())).toBe("2.3h")
    expect(blockedFigure(overage({ waitedSeconds: 2700 }))).toBe("45m")
    expect(blockedFigure(overage({ blockCount: 12, waitedSeconds: 39_960 }))).toBe("11h")
  })

  it("counts the blocks when no block states a reset", () => {
    // A block that reports no usable reset is counted and adds no time.
    // "0h" would claim the reader waited no time, which is false.
    expect(
      blockedFigure(overage({ blockCount: 1, waitedSeconds: 0, blocksWithoutWait: 1 })),
    ).toBe("1")
    expect(blockedFigure(overage({ blockCount: 0, waitedSeconds: 0 }))).toBe("0")
  })
})

describe("blockedCaption and blockedNote", () => {
  it("names the wait, and the blocks it covers, over the span", () => {
    expect(blockedCaption(overage(), 30)).toBe("waiting on 2 blocks in 30 days")
    expect(blockedCaption(overage({ blockCount: 1 }), 30)).toBe("waiting on 1 block in 30 days")
  })

  it("leaves the count to the figure when the figure is the count", () => {
    const counted = overage({ blockCount: 1, waitedSeconds: 0, blocksWithoutWait: 1 })
    expect(blockedCaption(counted, 30)).toBe("block in 30 days")
  })

  it("says nothing when every block states a reset", () => {
    expect(blockedNote(overage())).toBeNull()
  })

  it("names the blocks the wait leaves out", () => {
    expect(blockedNote(overage({ blockCount: 3, blocksWithoutWait: 1 }))).toBe(
      "1 with no stated reset",
    )
    expect(
      blockedNote(overage({ blockCount: 1, waitedSeconds: 0, blocksWithoutWait: 1 })),
    ).toBe("no stated reset")
  })
})

describe("causeLine", () => {
  it("counts only the windows that reached the ceiling", () => {
    const burst = utilization({ windowKind: "rolling", periodCount: 18, maxedPeriodCount: 1 })
    expect(causeLine(burst)).toBe("1 of 18 windows reached 100%")
  })

  it("says nothing when no window reached the ceiling", () => {
    // A refusal happens at 100% and at nothing less. A window at 99% refused
    // nothing, so there is no threshold below the ceiling to report.
    const burst = utilization({ windowKind: "rolling", peakPercent: 99, maxedPeriodCount: 0 })
    expect(causeLine(burst)).toBeNull()
  })

  it("says nothing when no short window was recorded", () => {
    expect(causeLine(null)).toBeNull()
  })
})

describe("allowanceAccounts", () => {
  it("drops an account with neither figure and keeps one with either", () => {
    const summary: AllowanceUsageSummaryPayload = {
      accounts: [
        account({ accountKey: "empty", utilization: null }),
        account({ accountKey: "metered" }),
        account({
          accountKey: "blocked",
          utilization: null,
          overage: {
            blockCount: 3,
            waitedSeconds: 100,
            blocksWithoutWait: 0,
            lastBlockAt: "2026-09-14T03:43:00Z",
          },
        }),
      ],
      overageSpanDays: 30,
      generatedAt: "2026-09-15T00:00:00Z",
    }

    expect(allowanceAccounts(summary).map((entry) => entry.accountKey)).toEqual([
      "metered",
      "blocked",
    ])
  })

  it("has nothing to show before the first read", () => {
    expect(allowanceAccounts(null)).toEqual([])
  })

  it("counts an account with a meter but no block", () => {
    expect(hasAllowanceFigures(account())).toBe(true)
  })
})
