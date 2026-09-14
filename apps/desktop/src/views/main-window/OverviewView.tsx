import { useSyncExternalStore } from "react"

import { isMacOS } from "../../lib/platform"

import { ScrollPane } from "../../components/ui/ScrollPane"
import { type MainOverviewSession } from "./MainOverviewSession"
import { OverviewProviderLimits } from "./overview/OverviewProviderLimits"
import { OverviewSpendChart } from "./overview/OverviewSpendChart"
import { OverviewSpendTotals } from "./overview/OverviewSpendTotals"

/**
 * The main window's landing section: local spend, provider limits, Burn
 * checks, and recent sessions on one page.
 *
 * The Burn checks summary and the recent sessions arrive in a later slice.
 */
export function OverviewView({
  active,
  session,
}: {
  active: boolean
  session: MainOverviewSession
}) {
  const state = useSyncExternalStore(
    active ? session.subscribe : session.subscribeInactive,
    session.getSnapshot,
    session.getSnapshot,
  )
  const usage = state.usage
  const loading = !usage && !state.usageError
  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-window"
      data-overview-active={active ? "" : undefined}
    >
      {isMacOS() && (
        <div
          className="h-[var(--main-window-titlebar-height)] shrink-0"
          data-tauri-drag-region
          aria-hidden="true"
        />
      )}
      <h1 className="sr-only">Overview</h1>
      {!usage && state.usageError ? (
        <div className="flex flex-1 items-center justify-center text-center">
          <div>
            <p role="alert" className="type-body text-label-secondary">
              Local usage is unavailable.
            </p>
            <button type="button" onClick={session.refresh} className="ui-push-button mt-3">
              Retry
            </button>
          </div>
        </div>
      ) : (
        <ScrollPane className="min-h-0" topEdgeFade>
          <div
            role="region"
            aria-label={loading ? "Loading Overview" : "Overview"}
            aria-busy={loading || undefined}
            className="flex w-full flex-col gap-[var(--space-2xl)] px-8 py-6"
          >
            {loading && (
              <p role="status" className="sr-only">
                Loading Overview.
              </p>
            )}
            <OverviewSpendTotals totals={usage?.totals ?? null} loading={loading} />
            <OverviewSpendChart
              days={usage?.days ?? []}
              previousDays={usage?.previousDays ?? []}
              loading={loading}
            />
            <OverviewProviderLimits
              live={state.liveUsage}
              loading={loading && !state.liveUsage}
            />
          </div>
        </ScrollPane>
      )}
    </div>
  )
}
