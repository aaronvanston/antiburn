import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import type { ProviderUsageDayPayload } from "../../../lib/providerUsageIpc"
import { OverviewSpendChart } from "./OverviewSpendChart"

const IDLE_HINT = "Hover a day for its reading"

function day(offset: number, usd: number | null, tokens = 900): ProviderUsageDayPayload {
  const date = new Date(2026, 8, 14 - (29 - offset))
  const localDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
  return {
    localDate,
    tokensIn: tokens,
    tokensOut: 0,
    cacheRead: 0,
    estimatedUsd: usd,
    costComplete: usd != null || tokens === 0,
    sessionCount: tokens > 0 ? 2 : 0,
  }
}

const days = Array.from({ length: 30 }, (_, index) =>
  day(index, index === 3 ? null : index * 0.5),
)
const previousDays = Array.from({ length: 30 }, (_, index) => day(index, 1))

describe("OverviewSpendChart", () => {
  it("draws a button for each of the thirty days and reads the hovered day", () => {
    render(<OverviewSpendChart days={days} previousDays={previousDays} />)
    const group = screen.getByRole("group", { name: "Estimated spend for the past 30 days" })
    const buttons = within(group).getAllByRole("button")
    expect(buttons).toHaveLength(30)
    expect(buttons[29]).toHaveAttribute("tabindex", "0")
    expect(buttons[0]).toHaveAttribute("tabindex", "-1")
    expect(buttons[29]).toHaveAttribute(
      "aria-label",
      "Today · $14.50 · 900 · 2 sessions · +$13.50 vs 30 days before",
    )
    // Nothing is under the pointer yet, so the line holds the hint.
    expect(screen.getByTestId("overview-chart-detail")).toHaveTextContent(IDLE_HINT)
    fireEvent.mouseEnter(buttons[29]!)
    expect(screen.getByTestId("overview-chart-detail")).toHaveTextContent(
      "Today · $14.50 · 900 · 2 sessions · +$13.50 vs 30 days before",
    )
    fireEvent.mouseEnter(buttons[28]!)
    expect(screen.getByTestId("overview-chart-detail")).toHaveTextContent(
      /^Sun 13 Sep · \$14\.00/,
    )
    fireEvent.mouseLeave(group)
    expect(screen.getByTestId("overview-chart-detail")).toHaveTextContent(IDLE_HINT)
  })

  it("walks the days with the arrow keys and reads the focused day", () => {
    render(<OverviewSpendChart days={days} previousDays={previousDays} />)
    const group = screen.getByRole("group", { name: "Estimated spend for the past 30 days" })
    const buttons = within(group).getAllByRole("button")
    buttons[29]!.focus()
    fireEvent.focus(buttons[29]!)
    expect(screen.getByTestId("overview-chart-detail")).toHaveTextContent(/^Today/)
    fireEvent.keyDown(buttons[29]!, { key: "ArrowLeft" })
    expect(document.activeElement).toBe(buttons[28])
    expect(buttons[28]).toHaveAttribute("tabindex", "0")
    expect(buttons[29]).toHaveAttribute("tabindex", "-1")
    expect(screen.getByTestId("overview-chart-detail")).toHaveTextContent(
      /^Sun 13 Sep · \$14\.00/,
    )
    fireEvent.keyDown(buttons[28]!, { key: "Home" })
    expect(document.activeElement).toBe(buttons[0])
    expect(screen.getByTestId("overview-chart-detail")).toHaveTextContent(
      "Sun 16 Aug · $0.00 · 900 · 2 sessions · −$1.00 vs 30 days before",
    )
    fireEvent.keyDown(buttons[0]!, { key: "ArrowLeft" })
    expect(document.activeElement).toBe(buttons[0])
    buttons[0]!.blur()
    fireEvent.blur(buttons[0]!)
    expect(screen.getByTestId("overview-chart-detail")).toHaveTextContent(IDLE_HINT)
  })

  it("marks an unpriced day as not priced instead of zero", () => {
    render(<OverviewSpendChart days={days} previousDays={previousDays} />)
    const group = screen.getByRole("group", { name: "Estimated spend for the past 30 days" })
    const buttons = within(group).getAllByRole("button")
    fireEvent.mouseEnter(buttons[3]!)
    expect(screen.getByTestId("overview-chart-detail")).toHaveTextContent(
      "Wed 19 Aug · not priced · 900 · 2 sessions",
    )
    expect(screen.getByTestId("overview-chart-detail")).not.toHaveTextContent(
      "vs 30 days before",
    )
    expect(buttons[3]!.querySelector("[data-unpriced]")).not.toBeNull()
    expect(buttons[4]!.querySelector("[data-unpriced]")).toBeNull()
  })

  it("shows a placeholder while loading and with no days", () => {
    const { rerender } = render(<OverviewSpendChart days={[]} previousDays={[]} loading />)
    expect(screen.queryByRole("group")).toBeNull()
    expect(screen.getByRole("region", { name: "Estimated spend by day" })).toHaveAttribute(
      "aria-busy",
      "true",
    )
    rerender(<OverviewSpendChart days={[]} previousDays={[]} />)
    expect(screen.queryByRole("group")).toBeNull()
  })
})
