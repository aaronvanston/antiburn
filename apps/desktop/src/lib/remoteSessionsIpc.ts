import { listen } from "@tauri-apps/api/event"
import { invoke } from "@tauri-apps/api/core"

export interface RemoteSession {
  agent: string
  sessionId: string
  title: string
  cwd: string | null
  surface: string
  updatedAt: number | null
}

export interface HostSnapshot {
  host: string
  connected: boolean
  error: string | null
  snapshot: {
    version: number
    collectedAt: number
    sessions: RemoteSession[]
    truncated: boolean
    skipped: number
    lookbackSecs: number
  } | null
}

export const getRemoteHosts = () => invoke<string[]>("get_remote_hosts")
export const setRemoteHosts = (hosts: string[]) => invoke<void>("set_remote_hosts", { hosts })
export const getRemoteSessions = (host: string, refresh: boolean) =>
  invoke<HostSnapshot>("get_remote_sessions", { host, refresh })
export type RemoteSyncProgress = { host: string; completed: number; total: number }
export const onRemoteSyncProgress = (callback: (progress: RemoteSyncProgress) => void) =>
  listen<RemoteSyncProgress>("remote-sync-progress", (event) => callback(event.payload))
