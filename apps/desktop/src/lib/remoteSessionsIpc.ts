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

export interface RemoteAnalysis {
  version: number
  collectedAt: number
  session: RemoteSession
  coverage: string
  metrics: {
    model: string | null
    tokensIn: number
    tokensOut: number
    peakContextTokens: number
    contextWindow: number
    contextWindowSource: string
    compactionCount: number
    durationSecs: number
    eventCount: number
    cost: { totalUsd: number } | null
    buckets: { contextTokens: number; tokensIn: number; tokensOut: number }[]
  }
}

export const getRemoteHosts = () => invoke<string[]>("get_remote_hosts")
export const setRemoteHosts = (hosts: string[]) => invoke<void>("set_remote_hosts", { hosts })
export const getRemoteSessions = (host: string, refresh: boolean) =>
  invoke<HostSnapshot>("get_remote_sessions", { host, refresh })
export const analyzeRemoteSession = (host: string, session: RemoteSession) =>
  invoke<RemoteAnalysis>("analyze_remote_session", {
    host,
    agent: session.agent,
    sessionId: session.sessionId,
  })
