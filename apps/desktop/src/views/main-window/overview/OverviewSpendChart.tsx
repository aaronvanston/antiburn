import { useState, type CSSProperties, type KeyboardEvent } from "react"

import type { ProviderUsageDayPayload } from "../../../lib/providerUsageIpc"
import {
  axisDayLabel,
  dayLabel,
  niceCeiling,
  seriesMax,
  spendDeltaLabel,
} from "../../../lib/presentation/overviewChart"
import {
  formatSpendFigure,
  formatTokenFigure,
  sessionCountLabel,
  windowTokens,
} from "../../../lib/presentation/providerUsage"

import { SegmentFigure } from "../../../components/ui/SegmentFigure"
import { Skeleton } from "../../../components/ui/Skeleton"

import "./overview.css"

/** The axis names every seventh day and the last one. */
const AXIS_LABEL_STEP = 7
/** A dated label this close to "Today" would collide with it. */
const AXIS_LABEL_CLEARANCE = 3

/** The fractions of the scale that carry a hairline and a figure. */
const GUIDE_FRACTIONS = [1, 0.75, 0.5, 0.25]

/**
 * The figures beside the guides, one precision for the whole scale: whole
 * dollars when every guide lands on one, else dollars and cents.
 */
function guideLabels(ceiling: number): Map<number, string> {
  const values = GUIDE_FRACTIONS.map((fraction) => [fraction, ceiling * fraction] as const)
  const whole = values.every(([, usd]) => Number.isInteger(usd))
  return new Map(
    values.map(([fraction, usd]) => [
      fraction,
      whole ? `$${usd.toLocaleString("en-US")}` : formatSpendFigure(usd),
    ]),
  )
}

/** The bar for one day: its height on the scale, and whether it has a figure. */
function barGeometry(day: ProviderUsageDayPayload | undefined, ceiling: number) {
  const usd = day?.estimatedUsd ?? null
  const tokens = day ? windowTokens(day) : 0
  return {
    unpriced: usd == null && tokens > 0,
    fraction: usd == null ? 0 : Math.min(1, usd / ceiling),
  }
}

/** The one-line reading under the bars for one day. */
function dayDetail(
  day: ProviderUsageDayPayload,
  previous: ProviderUsageDayPayload | undefined,
  isToday: boolean,
): string {
  const tokens = windowTokens(day)
  const figure =
    day.estimatedUsd != null
      ? formatSpendFigure(day.estimatedUsd)
      : tokens > 0
        ? "not priced"
        : "no sessions"
  const parts = [isToday ? "Today" : dayLabel(day.localDate), figure]
  if (tokens > 0)
    parts.push(`${formatTokenFigure(tokens)} tokens`, sessionCountLabel(day.sessionCount))
  const delta = spendDeltaLabel(day, previous)
  if (delta) parts.push(`${delta} vs 30 days before`)
  return parts.join(" · ")
}

/**
 * Thirty days of estimated local spend as paired pill bars: this period in
 * front, the thirty days before it behind in a quiet neutral. Each day is a
 * button, and the arrow keys walk the days. A selected past day writes its
 * reading on the line under the chart. Today has no line there: the totals
 * under the chart already show it.
 *
 * A day with tokens but no price draws an outlined dot and says "not priced",
 * so it is never mistaken for a day at zero.
 */
export function OverviewSpendChart({
  days,
  previousDays,
  loading = false,
}: {
  days: ReadonlyArray<ProviderUsageDayPayload>
  previousDays: ReadonlyArray<ProviderUsageDayPayload>
  loading?: boolean
}) {
  // The selection follows the date, not the index, so a refresh that adds a
  // day keeps the reader's day selected. A date the series no longer holds
  // falls back to today.
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const lastIndex = days.length - 1
  const foundIndex =
    selectedDate == null ? -1 : days.findIndex((day) => day.localDate === selectedDate)
  const selectedIndex = foundIndex >= 0 ? foundIndex : lastIndex
  const selected = days[selectedIndex]
  const ceiling = niceCeiling(seriesMax(days, previousDays))

  function select(index: number, list: HTMLElement | null): void {
    const clamped = Math.max(0, Math.min(lastIndex, index))
    const day = days[clamped]
    if (!day) return
    setSelectedDate(day.localDate)
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
    select(target, list)
  }

  return (
    <section
      className="overview-chart"
      aria-label="Estimated spend by day"
      aria-busy={loading || undefined}
    >
      {loading || days.length === 0 ? (
        <Skeleton className="block h-[var(--overview-chart-height)] w-full" />
      ) : (
        <>
          <div className="overview-chart-scroll">
            <div className="overview-chart-body">
              <div className="overview-plot">
                <div className="relative">
                  <Guides />
                  <div
                    role="group"
                    aria-label="Estimated spend for the past 30 days"
                    className="overview-days relative"
                  >
                    {days.map((day, index) => {
                      const previous = previousDays[index]
                      const now = barGeometry(day, ceiling)
                      const before = barGeometry(previous, ceiling)
                      const isToday = index === lastIndex
                      const isSelected = index === selectedIndex
                      return (
                        <button
                          key={day.localDate}
                          type="button"
                          data-day={day.localDate}
                          aria-pressed={isSelected}
                          aria-label={dayDetail(day, previous, isToday)}
                          tabIndex={isSelected ? 0 : -1}
                          className="overview-day"
                          onClick={() => setSelectedDate(day.localDate)}
                          onKeyDown={(event) => onKeyDown(event, index)}
                          style={{ "--overview-bar-index": index } as CSSProperties}
                        >
                          <Bar
                            fraction={before.fraction}
                            unpriced={before.unpriced}
                            className="bg-label-tertiary/30 text-label-tertiary/30"
                          />
                          <Bar
                            fraction={now.fraction}
                            unpriced={now.unpriced}
                            className={
                              isToday
                                ? "bg-token-in text-token-in"
                                : "bg-token-in text-token-in opacity-70"
                            }
                          />
                        </button>
                      )
                    })}
                  </div>
                </div>
                <GuideLabels ceiling={ceiling} />
              </div>
              <div
                className="overview-axis type-caption mt-[var(--space-xs)] text-label-tertiary"
                aria-hidden="true"
              >
                {days.map((day, index) => (
                  <span key={day.localDate} className="overview-axis-day">
                    {index === lastIndex ? (
                      <span className="overview-axis-label">Today</span>
                    ) : index % AXIS_LABEL_STEP === 0 &&
                      index < lastIndex - AXIS_LABEL_CLEARANCE ? (
                      <span className="overview-axis-label">{axisDayLabel(day.localDate)}</span>
                    ) : null}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-[var(--space-sm)] flex items-baseline justify-between gap-[var(--space-md)]">
            {selected && selectedIndex !== lastIndex ? (
              <p
                role="status"
                className="type-caption min-w-0 truncate text-label-secondary"
                data-testid="overview-chart-detail"
              >
                <SegmentFigure>
                  {dayDetail(selected, previousDays[selectedIndex], false)}
                </SegmentFigure>
              </p>
            ) : (
              <span aria-hidden="true" />
            )}
            <Legend />
          </div>
        </>
      )}
    </section>
  )
}

/** The key for the two series, at the right edge under the axis. */
function Legend() {
  return (
    <p className="type-caption flex shrink-0 items-center gap-[var(--space-md)] text-label-tertiary">
      <span className="inline-flex items-center gap-[var(--space-xs)]">
        <span aria-hidden="true" className="h-2 w-2 rounded-small bg-token-in" />
        Last 30 days
      </span>
      <span className="inline-flex items-center gap-[var(--space-xs)]">
        <span aria-hidden="true" className="h-2 w-2 rounded-small bg-label-tertiary/30" />
        30 days before
      </span>
    </p>
  )
}

/** One pill, sized as a share of the chart height. */
function Bar({
  fraction,
  unpriced,
  className,
}: {
  fraction: number
  unpriced: boolean
  className: string
}) {
  return (
    <span
      aria-hidden="true"
      className={`overview-bar ${className}`}
      data-unpriced={unpriced ? "" : undefined}
      style={{ blockSize: `${fraction * 100}%` }}
    />
  )
}

/** Hairlines at each quarter of the scale, behind the bars. */
function Guides() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      {GUIDE_FRACTIONS.map((fraction) => (
        <div
          key={fraction}
          className="absolute inset-x-0 border-t border-separator/60"
          style={{ top: `${(1 - fraction) * 100}%` }}
        />
      ))}
    </div>
  )
}

/** The figures for the guides, in a gutter to the right of the bars. */
function GuideLabels({ ceiling }: { ceiling: number }) {
  const labels = guideLabels(ceiling)
  return (
    <div
      aria-hidden="true"
      className="overview-scale type-metadata relative text-label-tertiary"
    >
      {GUIDE_FRACTIONS.map((fraction) => (
        <span
          key={fraction}
          className="absolute right-0 -translate-y-1/2 whitespace-nowrap"
          style={{ top: `${(1 - fraction) * 100}%` }}
        >
          <SegmentFigure>{labels.get(fraction) ?? ""}</SegmentFigure>
        </span>
      ))}
    </div>
  )
}
