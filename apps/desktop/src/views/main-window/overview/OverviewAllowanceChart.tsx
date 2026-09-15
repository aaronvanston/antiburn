import { useState, type CSSProperties, type KeyboardEvent } from "react"

import type {
  AllowanceDayPayload,
  AllowanceUsageAccountPayload,
} from "../../../lib/providerUsageIpc"
import {
  allowanceDeltaLabel,
  allowancePointsLabel,
  allowanceSeriesMax,
  blockDayLabel,
  dayLabel,
  percentCeiling,
} from "../../../lib/presentation/overviewChart"

import { Tooltip } from "../../../components/presentation/Tooltip"
import { SegmentFigure } from "../../../components/ui/SegmentFigure"
import { Skeleton } from "../../../components/ui/Skeleton"
import {
  Bar,
  ChartAxis,
  ChartLegend,
  GUIDE_FRACTIONS,
  GuideLabels,
  Guides,
  DAY_TOOLTIP_DELAY_MS,
} from "./overviewChartParts"

import "./overview.css"

/** The figures beside the guides: points of the allowance, in percent. */
function guideLabels(ceiling: number): Map<number, string> {
  return new Map(
    GUIDE_FRACTIONS.map((fraction) => [fraction, `${Math.round(ceiling * fraction)}%`]),
  )
}

/** The bar for one day: its height on the scale, and whether it has a figure. */
function barGeometry(day: AllowanceDayPayload | undefined, ceiling: number) {
  const percent = day?.usedPercent ?? null
  return {
    outline: day != null && percent == null,
    fraction: percent == null ? 0 : Math.min(1, percent / ceiling),
  }
}

/** The one-line reading in a day's tooltip. */
function dayDetail(
  day: AllowanceDayPayload,
  previous: AllowanceDayPayload | undefined,
  isToday: boolean,
): string {
  const parts = [
    isToday ? "Today" : dayLabel(day.localDate),
    allowancePointsLabel(day.usedPercent),
  ]
  const delta = allowanceDeltaLabel(day, previous)
  if (delta) parts.push(`${delta} vs 30 days before`)
  const blocks = blockDayLabel(day.blockCount)
  if (blocks) parts.push(blocks)
  return parts.join(" · ")
}

/**
 * Thirty days of allowance, one chart for each provider account.
 *
 * The bars read the provider's own meter, not the local dollar estimate. A
 * session's whole usage lands on the date of its last activity, so the dollar
 * series spikes one day for work spread over several. A meter reading carries
 * the time the provider stated it, so it does not.
 *
 * A day no reading speaks for draws an outlined dot and says "no reading". A
 * gap is unknown, never zero.
 */
export function OverviewAllowanceChart({
  accounts,
  loading = false,
}: {
  accounts: ReadonlyArray<AllowanceUsageAccountPayload>
  loading?: boolean
}) {
  const charted = accounts.filter((account) => account.days.length > 0)
  if (loading && charted.length === 0) {
    return (
      <section className="overview-chart" aria-label="Allowance by day" aria-busy>
        <Skeleton className="block min-h-[var(--overview-chart-height)] w-full flex-1" />
      </section>
    )
  }
  if (charted.length === 0) {
    return (
      <section className="overview-chart" aria-label="Allowance by day">
        <p className="type-body text-label-secondary">
          antiburn has no meter readings to chart yet. A reading arrives the next time an agent
          states this account&apos;s allowance.
        </p>
      </section>
    )
  }
  return (
    <div className="overview-allowance-charts">
      {charted.map((account) => (
        <AccountChart key={`${account.provider}:${account.accountKey}`} account={account} />
      ))}
    </div>
  )
}

/** One account's daily allowance, on its own scale. */
function AccountChart({ account }: { account: AllowanceUsageAccountPayload }) {
  // The keyboard's place in the row follows the date, not the index, so a
  // refresh that adds a day keeps the reader's day. A date the series no
  // longer holds falls back to today.
  const [focusDate, setFocusDate] = useState<string | null>(null)
  const days = account.days
  const previousDays = account.previousDays
  const lastIndex = days.length - 1
  const foundFocus =
    focusDate == null ? -1 : days.findIndex((day) => day.localDate === focusDate)
  const focusIndex = foundFocus >= 0 ? foundFocus : lastIndex
  const ceiling = percentCeiling(allowanceSeriesMax(days, previousDays))

  function focusDay(index: number, list: HTMLElement | null): void {
    const clamped = Math.max(0, Math.min(lastIndex, index))
    const day = days[clamped]
    if (!day) return
    setFocusDate(day.localDate)
    const button = list?.querySelector<HTMLButtonElement>(`[data-day="${day.localDate}"]`)
    button?.focus()
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    const list = event.currentTarget.parentElement
    const target =
      event.key === "ArrowLeft"
        ? index - 1
        : event.key === "ArrowRight"
          ? index + 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? lastIndex
              : null
    if (target == null) return
    event.preventDefault()
    focusDay(target, list)
  }

  return (
    <section className="overview-chart" aria-label={`Allowance by day, ${account.displayName}`}>
      <p className="type-caption mb-[var(--space-xs)] text-label-secondary">
        {account.displayName}
      </p>
      <div className="overview-chart-scroll">
        <div className="overview-chart-body">
          <div className="overview-plot">
            <div className="relative h-full">
              <ChartLegend nowClassName="bg-measure" />
              <Guides />
              <div
                role="group"
                aria-label={`Allowance for the past 30 days, ${account.displayName}`}
                className="overview-days relative"
              >
                {days.map((day, index) => {
                  const previous = previousDays[index]
                  const now = barGeometry(day, ceiling)
                  const before = barGeometry(previous, ceiling)
                  const isToday = index === lastIndex
                  const detail = dayDetail(day, previous, isToday)
                  return (
                    <Tooltip
                      key={day.localDate}
                      label={<SegmentFigure>{detail}</SegmentFigure>}
                      delayMs={DAY_TOOLTIP_DELAY_MS}
                    >
                      <button
                        type="button"
                        data-day={day.localDate}
                        aria-label={detail}
                        tabIndex={index === focusIndex ? 0 : -1}
                        className="overview-day overview-day-marked"
                        onFocus={() => setFocusDate(day.localDate)}
                        onKeyDown={(event) => onKeyDown(event, index)}
                        style={{ "--overview-bar-index": index } as CSSProperties}
                      >
                        {day.blockCount > 0 && (
                          <span
                            aria-hidden="true"
                            className="overview-block-mark bg-system-red-tint"
                          />
                        )}
                        <Bar
                          fraction={before.fraction}
                          outline={before.outline}
                          className="bg-label-tertiary/30 text-label-tertiary/30"
                        />
                        <Bar
                          fraction={now.fraction}
                          outline={now.outline}
                          className={
                            isToday
                              ? "bg-measure text-measure"
                              : "bg-measure text-measure opacity-70"
                          }
                        />
                      </button>
                    </Tooltip>
                  )
                })}
              </div>
            </div>
            <GuideLabels labels={guideLabels(ceiling)} />
          </div>
          <ChartAxis dates={days.map((day) => day.localDate)} />
        </div>
      </div>
    </section>
  )
}
