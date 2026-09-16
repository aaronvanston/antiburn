import {
  getRemoteHosts,
  onRemoteSyncStatus,
  getRemoteSyncStatus,
  setRemoteSyncInterval,
  type RemoteSyncProgress,
  getRemoteSessions,
  setRemoteHosts,
  type HostSnapshot,
} from "../../lib/remoteSessionsIpc"

type State = {
  hosts: string[]
  snapshots: ReadonlyMap<string, HostSnapshot>
  loading: boolean
  saving: boolean
  refreshing: boolean
  loaded: boolean
  error: string | null
  progress: RemoteSyncProgress | null
  intervalSecs: number
  hostErrors: Record<string, string>
}

/** Observe cached sessions and the app-owned scan scheduler. */
export class RemoteSessionsStore {
  private state: State = {
    hosts: [],
    snapshots: new Map(),
    loading: false,
    saving: false,
    refreshing: false,
    loaded: false,
    error: null,
    progress: null,
    intervalSecs: 300,
    hostErrors: {},
  }
  private listeners = new Set<() => void>()
  private unlisten: (() => void) | null = null
  private started = false
  private reloadPending = false
  private generation = 0
  private statusRevision = 0
  private onFocus = () => {
    void this.load()
  }
  getSnapshot = (): State => this.state
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    if (!this.started) {
      this.started = true
      const generation = this.generation
      void onRemoteSyncStatus((status) => {
        if (!this.started || generation !== this.generation) return
        this.statusRevision++
        this.publish({
          progress: status.progress,
          intervalSecs: status.intervalSecs,
          hostErrors: status.errors,
        })
        if (!status.progress) void this.load()
      })
        .then((unlisten) => {
          if (this.started && generation === this.generation) this.unlisten = unlisten
          else unlisten()
        })
        .catch((error: unknown) => this.publish({ error: String(error) }))
      window.addEventListener("focus", this.onFocus)
      void this.load()
    }
    return () => {
      this.listeners.delete(listener)
      if (!this.listeners.size) {
        window.removeEventListener("focus", this.onFocus)
        this.unlisten?.()
        this.unlisten = null
        this.started = false
        this.generation++
      }
    }
  }
  private publish(update: Partial<State>): void {
    this.state = { ...this.state, ...update }
    for (const listener of this.listeners) listener()
  }
  private async load(): Promise<void> {
    if (this.state.loading || this.state.saving || this.state.refreshing) {
      this.reloadPending = true
      return
    }
    this.publish({ loading: true })
    const generation = this.generation
    try {
      const statusRevision = this.statusRevision
      const [hosts, status] = await Promise.all([getRemoteHosts(), getRemoteSyncStatus()])
      const results = await Promise.all(hosts.map((host) => getRemoteSessions(host, false)))
      if (generation !== this.generation) return
      this.publish({
        hosts,
        ...(statusRevision === this.statusRevision
          ? {
              progress: status.progress,
              intervalSecs: status.intervalSecs,
              hostErrors: status.errors,
            }
          : {}),
        snapshots: new Map(results.map((result) => [result.host, result])),
        loaded: true,
        error: null,
      })
    } catch (error) {
      if (generation === this.generation) this.publish({ loaded: true, error: String(error) })
    } finally {
      this.publish({ loading: false })
      this.reloadIfPending()
    }
  }
  private reloadIfPending(): void {
    if (this.reloadPending && this.started) {
      this.reloadPending = false
      void this.load()
    }
  }
  async saveInterval(seconds: number): Promise<void> {
    if (this.state.saving) return
    this.publish({ saving: true })
    try {
      await setRemoteSyncInterval(seconds)
      this.publish({ intervalSecs: seconds, error: null })
    } catch (error) {
      this.publish({ error: String(error) })
    } finally {
      this.publish({ saving: false })
      this.reloadIfPending()
    }
  }
  async save(hosts: string[]): Promise<void> {
    if (this.state.refreshing || this.state.progress || this.state.saving || this.state.loading)
      return
    this.publish({ saving: true })
    try {
      await setRemoteHosts(hosts)
      this.publish({
        hosts,
        snapshots: new Map([...this.state.snapshots].filter(([host]) => hosts.includes(host))),
        error: null,
      })
    } catch (error) {
      this.publish({ error: String(error) })
      throw error
    } finally {
      this.publish({ saving: false })
      this.reloadIfPending()
    }
  }
  async refresh(onlyHost?: string): Promise<void> {
    if (this.state.refreshing || this.state.progress || this.state.saving || this.state.loading)
      return
    this.publish({ refreshing: true, error: null, progress: null })
    for (const host of this.state.hosts.filter((host) => !onlyHost || host === onlyHost)) {
      try {
        const result = await getRemoteSessions(host, true)
        this.publish({ snapshots: new Map(this.state.snapshots).set(host, result) })
      } catch (error) {
        const previous = this.state.snapshots.get(host)
        this.publish({
          snapshots: new Map(this.state.snapshots).set(host, {
            host,
            snapshot: previous?.snapshot ?? null,
            connected: false,
            error: String(error),
          }),
        })
      }
    }
    this.publish({
      refreshing: false,
      error:
        [...this.state.snapshots.values()]
          .filter((value) => value.error)
          .map((value) => `${value.host}: ${value.error}`)
          .join("; ") || null,
    })
    this.reloadIfPending()
  }
}
