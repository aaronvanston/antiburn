import type { LiveUsageSummaryPayload } from "../../../lib/providerUsageIpc"
import {
  liveDisplayableProviders,
  liveErrorNote,
  liveFreshnessToneClass,
  liveGraceNote,
  livePlanAccountLabel,
  liveProviderStatus,
  liveUnavailableProviders,
  liveWindows,
  orderedLiveAccounts,
} from "../../../lib/presentation/liveUsage"

import { WindowMeterRow } from "../../../components/providerUsage/UsageLimitsBar"
import { useStableAccountNumbers } from "../../../components/providerUsage/useStableAccountNumbers"
import { Skeleton } from "../../../components/ui/Skeleton"

/** The popover's dot count. The group width cap keeps the dots as close. */
const OVERVIEW_METER_SEGMENTS = 32

/**
 * The provider limits panel: one group per provider account with a dot meter
 * for each of its windows and the reset time under each meter. A group is
 * capped at the popover row's width, so the dots pack the same as there.
 * The freshness tag floats in the top-right corner. The panel shows no
 * local cost figure; those belong to the totals above the panel.
 */
export function OverviewProviderLimits({
  live,
  loading = false,
}: {
  live: LiveUsageSummaryPayload | null
  loading?: boolean
}) {
  const limited = live
    ? orderedLiveAccounts(liveDisplayableProviders(live)).filter(
        ({ reading }) => liveWindows(reading).length > 0,
      )
    : []
  const unavailable = live ? liveUnavailableProviders(live) : []
  const providerCounts = new Map<string, number>()
  for (const { reading } of limited) {
    providerCounts.set(reading.provider, (providerCounts.get(reading.provider) ?? 0) + 1)
  }
  const accountNumbers = useStableAccountNumbers(
    limited.map(({ key, reading }) => ({ key, provider: reading.provider })),
  )
  // The instant the elapsed notches are measured from: the snapshot's own
  // time, not the wall clock. A render must not read the clock.
  const at = live ? Date.parse(live.generatedAt) || 0 : 0
  const stale = limited.some(({ reading }) => reading.freshness === "stale")

  return (
    <section
      aria-label="Provider limits"
      aria-busy={loading || undefined}
      className="relative rounded-control bg-surface-card p-[var(--space-lg)] shadow-stats-card"
    >
      {limited.length > 0 && (
        <p
          className={`type-caption absolute top-[var(--space-lg)] right-[var(--space-lg)] ${liveFreshnessToneClass(stale ? "stale" : "fresh")}`}
        >
          {stale ? "Stale" : "Live"}
        </p>
      )}
      {loading || !live ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-[var(--space-2xl)]">
          {["first", "second"].map((seat) => (
            <div key={seat} className="flex flex-col gap-[var(--space-md)]">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-full" />
            </div>
          ))}
        </div>
      ) : limited.length === 0 && unavailable.length === 0 ? (
        <p className="type-callout text-label-secondary">
          No provider limits to show. Sign in with a coding tool, or turn a meter on in
          Settings.
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-[var(--space-2xl)]">
          {limited.map(({ reading, key }) => {
            const count = providerCounts.get(reading.provider) ?? 1
            const displayName =
              count > 1
                ? `${reading.displayName} account ${accountNumbers.get(key)}`
                : reading.displayName
            const plan = livePlanAccountLabel(reading, count)
            const status = liveProviderStatus(live, reading)
            const graceNote =
              status.kind === "grace"
                ? liveGraceNote(status.category, reading.provider, status.ageMs)
                : null
            return (
              <div
                key={key}
                role="group"
                aria-label={plan ? `${displayName}, ${plan} plan` : displayName}
                className="min-w-0 max-w-[300px]"
              >
                <h3 className="type-footnote min-w-0 truncate pr-12 font-medium tracking-wide text-label">
                  <span className="uppercase">{displayName}</span>
                  {plan && <span className="text-label-secondary"> · {plan}</span>}
                </h3>
                {graceNote && (
                  <p className="type-footnote pt-1 text-label-tertiary">{graceNote}</p>
                )}
                <div className="flex flex-col gap-[var(--space-md)] pt-[var(--space-md)]">
                  {liveWindows(reading).map((window) => (
                    <WindowMeterRow
                      key={window.id}
                      window={window}
                      now={at}
                      resetPlacement="caption"
                      segments={OVERVIEW_METER_SEGMENTS}
                    />
                  ))}
                </div>
              </div>
            )
          })}
          {unavailable.map((entry) => (
            <div
              key={entry.provider}
              role="group"
              aria-label={entry.displayName}
              className="min-w-0 max-w-[300px]"
            >
              <h3 className="type-footnote truncate font-medium tracking-wide text-label uppercase">
                {entry.displayName}
              </h3>
              <p className="type-footnote pt-[var(--space-md)] text-label-secondary">
                {liveErrorNote(entry.category, entry.provider)}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
