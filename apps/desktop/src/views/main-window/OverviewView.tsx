import { isMacOS } from "../../lib/platform"

import { ScrollPane } from "../../components/ui/ScrollPane"
import { Skeleton } from "../../components/ui/Skeleton"

/**
 * The main window's landing section: local spend, provider limits, Burn
 * checks, and recent sessions on one page.
 *
 * This first slice ships the section and a placeholder. The panels arrive in
 * later slices; until then the view shows a loading block and no figures.
 */
export function OverviewView({ active }: { active: boolean }) {
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
      <ScrollPane className="min-h-0" topEdgeFade>
        <div
          role="region"
          aria-label="Loading Overview"
          aria-busy="true"
          className="w-full px-8 py-6"
        >
          <p role="status" className="sr-only">
            Loading Overview.
          </p>
          <div className="grid grid-cols-3 gap-[var(--space-lg)]">
            {["today", "week", "month"].map((span) => (
              <div key={span} className="flex flex-col gap-[var(--space-sm)]">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-8 w-32" />
                <Skeleton className="h-3 w-40 max-w-full" />
              </div>
            ))}
          </div>
          <Skeleton className="mt-[var(--space-2xl)] h-24 w-full" />
        </div>
      </ScrollPane>
    </div>
  )
}
