import { useState, useSyncExternalStore } from "react"

import { isMacOS } from "../../lib/platform"

import type { SessionListEntry } from "../../components/session/SessionList"
import { ScrollPane } from "../../components/ui/ScrollPane"
import { type MainOverviewSession } from "./MainOverviewSession"
import { OverviewProviderLimits } from "./overview/OverviewProviderLimits"
import { OverviewRecentSessions } from "./overview/OverviewRecentSessions"
import { OverviewAllowanceChart } from "./overview/OverviewAllowanceChart"
import { OverviewSpendChart } from "./overview/OverviewSpendChart"
import { allowanceAccounts } from "./overview/overviewAllowance"
import { OverviewUsageTotals, type OverviewMetric } from "./overview/OverviewUsageTotals"

import "./overview/overview.css"

/**
 * The main window's landing section: the usage totals in the unit the page
 * reads in, then one card with the recent sessions beside the provider
 * limits card, and the daily chart along the bottom, where it takes any
 * height the window has to spare. The Sessions panel is a summary; its
 * control leaves for the full section.
 *
 * The page holds the unit. The totals and the chart both read it, so the
 * page can never show dollars in one place and allowance in another.
 */
export function OverviewView({
  active,
  session,
  onOpenSessions,
  onSelectSession,
}: {
  active: boolean
  session: MainOverviewSession
  onOpenSessions: () => void
  onSelectSession: (entry: SessionListEntry) => void
}) {
  const state = useSyncExternalStore(
    active ? session.subscribe : session.subscribeInactive,
    session.getSnapshot,
    session.getSnapshot,
  )
  const [metric, setMetric] = useState<OverviewMetric>("cost")
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
            className="overview-page flex w-full flex-col gap-[var(--space-xl)] px-8 py-6"
          >
            {loading && (
              <p role="status" className="sr-only">
                Loading Overview.
              </p>
            )}
            <OverviewUsageTotals
              metric={metric}
              onMetricChange={setMetric}
              totals={usage?.totals ?? null}
              allowance={state.allowance}
              loading={loading}
            />
            <div className="overview-panels">
              <div className="overview-stack p-[var(--space-lg)]">
                <OverviewRecentSessions
                  entries={state.recentSessions}
                  loading={loading && !state.recentSessions}
                  onSelect={onSelectSession}
                  onOpenAll={onOpenSessions}
                />
              </div>
              <OverviewProviderLimits
                live={state.liveUsage}
                loading={loading && !state.liveUsage}
              />
            </div>
            {metric === "cost" ? (
              <OverviewSpendChart
                days={usage?.days ?? []}
                previousDays={usage?.previousDays ?? []}
                loading={loading}
              />
            ) : (
              <OverviewAllowanceChart
                accounts={allowanceAccounts(state.allowance)}
                loading={loading && !state.allowance}
              />
            )}
          </div>
        </ScrollPane>
      )}
    </div>
  )
}
