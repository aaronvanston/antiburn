import {
  getLiveUsage,
  getMainWindowVisible,
  getProviderUsage,
  onLiveUsageChanged,
  onMainWindowVisibilityChanged,
  onScanEvent,
  onSessionsInvalidated,
} from "../../lib/ipc"
import type {
  LiveUsageSummaryPayload,
  ProviderUsageSummaryPayload,
} from "../../lib/providerUsageIpc"

export interface MainOverviewAdapter {
  getUsage(): Promise<ProviderUsageSummaryPayload>
  getLiveUsage(): Promise<LiveUsageSummaryPayload>
  getVisible(): Promise<boolean>
  onVisible(handler: (visible: boolean) => void): Promise<() => void>
  onLiveUsageChanged(handler: (usage: LiveUsageSummaryPayload) => void): Promise<() => void>
  onSessionsInvalidated(handler: () => void): Promise<() => void>
  onScanFinished(handler: () => void): Promise<() => void>
}

const productionAdapter: MainOverviewAdapter = {
  getUsage: () => getProviderUsage(),
  getLiveUsage: () => getLiveUsage(),
  getVisible: () => getMainWindowVisible(),
  onVisible: (handler) => onMainWindowVisibilityChanged(handler),
  onLiveUsageChanged: (handler) => onLiveUsageChanged(handler),
  onSessionsInvalidated: (handler) => onSessionsInvalidated(handler),
  onScanFinished: (handler) =>
    onScanEvent((_status, phase) => {
      if (phase === "finished") handler()
    }),
}

export interface MainOverviewSnapshot {
  active: boolean
  /** The local usage summary, or null before the first successful read. */
  usage: ProviderUsageSummaryPayload | null
  /** True when the newest local usage read failed and nothing replaced it. */
  usageError: boolean
  /** The provider limit snapshot, or null before the first successful read. */
  liveUsage: LiveUsageSummaryPayload | null
  /** True while the first local usage read is in flight. */
  loading: boolean
  /** True while a later local usage read is in flight. */
  refreshing: boolean
}

/**
 * Own the Overview section's reads: local provider usage and the live
 * provider limits. The section is the main window's landing page, so the
 * store loads only while the window is visible and a viewer is active, and
 * it refreshes after every scan and every live usage update.
 */
export class MainOverviewSession {
  private readonly adapter: MainOverviewAdapter
  private snapshot: MainOverviewSnapshot = {
    active: false,
    usage: null,
    usageError: false,
    liveUsage: null,
    loading: false,
    refreshing: false,
  }
  private readonly listeners = new Set<() => void>()
  private readonly activeListeners = new Set<() => void>()
  private readonly stops: Array<() => void> = []
  private generation = 0
  private workVersion = 0
  private refreshVersion = 0
  private visible = false
  private initialized = false
  private refreshTask: Promise<void> | null = null
  private refreshDirty = false

  constructor(adapter: MainOverviewAdapter = productionAdapter) {
    this.adapter = adapter
  }

  getSnapshot = (): MainOverviewSnapshot => this.snapshot
  subscribe = (listener: () => void): (() => void) => this.attach(listener, true)
  subscribeInactive = (listener: () => void): (() => void) => this.attach(listener, false)

  private update(patch: Partial<MainOverviewSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener()
  }

  private attach(listener: () => void, active: boolean): () => void {
    this.listeners.add(listener)
    if (active) this.activeListeners.add(listener)
    if (this.listeners.size === 1) void this.start()
    this.syncActive()
    return () => {
      this.listeners.delete(listener)
      this.activeListeners.delete(listener)
      this.syncActive()
      if (this.listeners.size === 0) this.dispose()
    }
  }

  private async listen(generation: number, pending: Promise<() => void>): Promise<void> {
    const stop = await pending.catch(() => null)
    if (!stop) return
    if (generation !== this.generation) stop()
    else this.stops.push(stop)
  }

  private async start(): Promise<void> {
    const generation = ++this.generation
    let visibilityRevision = 0
    const refreshWhenCurrent = () => {
      if (generation === this.generation) this.refresh()
    }
    await Promise.all([
      this.listen(
        generation,
        this.adapter.onVisible((visible) => {
          if (generation !== this.generation) return
          visibilityRevision += 1
          this.visible = visible
          this.syncActive()
        }),
      ),
      this.listen(
        generation,
        this.adapter.onLiveUsageChanged((liveUsage) => {
          if (generation === this.generation && this.snapshot.active) this.update({ liveUsage })
        }),
      ),
      this.listen(generation, this.adapter.onSessionsInvalidated(refreshWhenCurrent)),
      this.listen(generation, this.adapter.onScanFinished(refreshWhenCurrent)),
    ])
    const revision = visibilityRevision
    const visible = await this.adapter.getVisible().catch(() => false)
    if (generation !== this.generation) return
    if (revision === visibilityRevision) this.visible = visible
    this.initialized = true
    this.syncActive()
  }

  private syncActive(): void {
    const active = this.initialized && this.visible && this.activeListeners.size > 0
    if (active === this.snapshot.active) return
    this.workVersion += 1
    this.update({ active, loading: active && !this.snapshot.usage, refreshing: false })
    if (active) this.refresh()
  }

  refresh = (): void => {
    this.refreshVersion += 1
    this.refreshDirty = true
    if (!this.snapshot.active || this.refreshTask) return
    this.refreshTask = this.runRefresh().finally(() => {
      this.refreshTask = null
      if (this.refreshDirty && this.snapshot.active) this.refresh()
    })
  }

  private async runRefresh(): Promise<void> {
    while (this.refreshDirty && this.snapshot.active) {
      this.refreshDirty = false
      const work = this.workVersion
      const version = this.refreshVersion
      this.update({ loading: !this.snapshot.usage, refreshing: !!this.snapshot.usage })
      void this.loadLiveUsage(work, version)
      try {
        const usage = await this.adapter.getUsage()
        if (work !== this.workVersion || version !== this.refreshVersion) continue
        this.update({ usage, loading: false, refreshing: false, usageError: false })
      } catch {
        if (work === this.workVersion && version === this.refreshVersion) {
          this.update({ loading: false, refreshing: false, usageError: true })
        }
      }
    }
  }

  private async loadLiveUsage(work: number, version: number): Promise<void> {
    try {
      const liveUsage = await this.adapter.getLiveUsage()
      if (
        work === this.workVersion &&
        version === this.refreshVersion &&
        this.snapshot.active
      ) {
        this.update({ liveUsage })
      }
    } catch {
      // The limits panel shows its own empty state. A failed read must not
      // hide the local totals.
    }
  }

  dispose = (): void => {
    this.generation += 1
    this.workVersion += 1
    this.initialized = false
    this.visible = false
    this.refreshTask = null
    for (const stop of this.stops.splice(0)) stop()
    this.update({ active: false, loading: false, refreshing: false })
  }
}
