import {
  getRemoteHosts,
  getRemoteSessions,
  setRemoteHosts,
  type HostSnapshot,
} from "../../lib/remoteSessionsIpc"

type State = {
  hosts: string[]
  snapshots: ReadonlyMap<string, HostSnapshot>
  refreshing: boolean
  loaded: boolean
  error: string | null
}

/** Load cached snapshots when the remote view subscribes. Connections require a refresh action. */
export class RemoteSessionsStore {
  private state: State = {
    hosts: [],
    snapshots: new Map(),
    refreshing: false,
    loaded: false,
    error: null,
  }
  private listeners = new Set<() => void>()
  private started = false
  private saving = false
  getSnapshot = (): State => this.state
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    if (!this.started) {
      this.started = true
      void this.load()
    }
    return () => this.listeners.delete(listener)
  }
  private publish(update: Partial<State>): void {
    this.state = { ...this.state, ...update }
    for (const listener of this.listeners) listener()
  }
  private async load(): Promise<void> {
    try {
      const hosts = await getRemoteHosts()
      const results = await Promise.all(hosts.map((host) => getRemoteSessions(host, false)))
      this.publish({
        hosts,
        snapshots: new Map(results.map((result) => [result.host, result])),
        loaded: true,
      })
    } catch (error) {
      this.publish({ loaded: true, error: String(error) })
    }
  }
  async save(hosts: string[]): Promise<void> {
    if (this.state.refreshing || this.saving) return
    this.saving = true
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
      this.saving = false
    }
  }
  async refresh(): Promise<void> {
    if (this.state.refreshing || this.saving) return
    this.publish({ refreshing: true, error: null })
    await Promise.all(
      this.state.hosts.map(async (host) => {
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
  }
}
