import {
  getRemoteHosts,
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
}

/** Load cached snapshots when the remote view subscribes. Connections require a refresh action. */
export class RemoteSessionsStore {
  private state: State = {
    hosts: [],
    snapshots: new Map(),
    loading: false,
    saving: false,
    refreshing: false,
    loaded: false,
    error: null,
  }
  private listeners = new Set<() => void>()
  private started = false
  private reloadPending = false
  private generation = 0
  private onFocus = () => {
    void this.load()
  }
  getSnapshot = (): State => this.state
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    if (!this.started) {
      this.started = true
      window.addEventListener("focus", this.onFocus)
      void this.load()
    }
    return () => {
      this.listeners.delete(listener)
      if (!this.listeners.size) {
        window.removeEventListener("focus", this.onFocus)
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
      const hosts = await getRemoteHosts()
      const results = await Promise.all(hosts.map((host) => getRemoteSessions(host, false)))
      if (generation !== this.generation) return
      this.publish({
        hosts,
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
  async save(hosts: string[]): Promise<void> {
    if (this.state.refreshing || this.state.saving || this.state.loading) return
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
    if (this.state.refreshing || this.state.saving || this.state.loading) return
    this.publish({ refreshing: true, error: null })
    await Promise.all(
      this.state.hosts
        .filter((host) => !onlyHost || host === onlyHost)
        .map(async (host) => {
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
        }),
    )
    this.publish({ refreshing: false })
    this.reloadIfPending()
  }
}
