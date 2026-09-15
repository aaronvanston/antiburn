import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import type {
  AllowanceDayPayload,
  AllowanceUsageAccountPayload,
} from "../../../lib/providerUsageIpc"
import { OverviewAllowanceChart } from "./OverviewAllowanceChart"

function day(offset: number, usedPercent: number | null, blockCount = 0): AllowanceDayPayload {
  const date = new Date(2026, 8, 14 - (29 - offset))
  const localDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
  return { localDate, usedPercent, blockCount }
}

const days = Array.from({ length: 30 }, (_, index) =>
  day(index, index === 3 ? null : index * 0.5, index === 10 ? 2 : 0),
)
const previousDays = Array.from({ length: 30 }, (_, index) => day(index, 1))

function account(overrides: Partial<AllowanceUsageAccountPayload> = {}) {
  return {
    provider: "anthropic",
    displayName: "Claude",
    accountKey: "account",
    utilization: null,
    burst: null,
    overage: { blockCount: 0, waitedSeconds: 0, blocksWithoutWait: 0, lastBlockAt: null },
    days,
    previousDays,
    ...overrides,
  } satisfies AllowanceUsageAccountPayload
}

describe("OverviewAllowanceChart", () => {
  it("reads each day in allowance points and names the account", () => {
    render(<OverviewAllowanceChart accounts={[account()]} />)
    const group = screen.getByRole("group", {
      name: "Allowance for the past 30 days, Claude",
    })
    const buttons = within(group).getAllByRole("button")
    expect(buttons).toHaveLength(30)
    const today = "Today · 15 points · +14 points vs 30 days before"
    expect(buttons[29]).toHaveAttribute("aria-label", today)
    fireEvent.focus(buttons[29]!)
    expect(screen.getByRole("tooltip")).toHaveTextContent(today)
  })

  it("calls a day with no reading unknown, never zero", () => {
    render(<OverviewAllowanceChart accounts={[account()]} />)
    const group = screen.getByRole("group", {
      name: "Allowance for the past 30 days, Claude",
    })
    const buttons = within(group).getAllByRole("button")
    // The gap states no figure and makes no comparison against the day before.
    expect(buttons[3]).toHaveAttribute("aria-label", expect.stringContaining("no reading"))
    expect(buttons[3]!.getAttribute("aria-label")).not.toContain("vs 30 days before")
  })

  it("marks a day that carried a block", () => {
    const { container } = render(<OverviewAllowanceChart accounts={[account()]} />)
    const group = screen.getByRole("group", {
      name: "Allowance for the past 30 days, Claude",
    })
    const buttons = within(group).getAllByRole("button")
    expect(buttons[10]).toHaveAttribute("aria-label", expect.stringContaining("2 blocks"))
    expect(container.querySelectorAll(".overview-block-mark")).toHaveLength(1)
  })

  it("draws one chart for each account", () => {
    render(
      <OverviewAllowanceChart
        accounts={[
          account(),
          account({ provider: "openai", displayName: "Codex", accountKey: "other" }),
        ]}
      />,
    )
    expect(screen.getByRole("region", { name: "Allowance by day, Claude" })).toBeTruthy()
    expect(screen.getByRole("region", { name: "Allowance by day, Codex" })).toBeTruthy()
  })

  it("says antiburn has no readings rather than drawing an empty chart", () => {
    render(<OverviewAllowanceChart accounts={[account({ days: [], previousDays: [] })]} />)
    expect(screen.getByRole("region", { name: "Allowance by day" }).textContent).toContain(
      "no meter readings",
    )
  })

  it("walks the days with the arrow keys", () => {
    render(<OverviewAllowanceChart accounts={[account()]} />)
    const group = screen.getByRole("group", {
      name: "Allowance for the past 30 days, Claude",
    })
    const buttons = within(group).getAllByRole("button")
    buttons[29]!.focus()
    fireEvent.focus(buttons[29]!)
    fireEvent.keyDown(buttons[29]!, { key: "ArrowLeft" })
    expect(document.activeElement).toBe(buttons[28])
    fireEvent.keyDown(buttons[28]!, { key: "Home" })
    expect(document.activeElement).toBe(buttons[0])
    fireEvent.keyDown(buttons[0]!, { key: "End" })
    expect(document.activeElement).toBe(buttons[29])
  })
})
