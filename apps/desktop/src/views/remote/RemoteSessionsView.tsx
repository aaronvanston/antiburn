import { useRef, useState, useSyncExternalStore } from "react"
import {
  analyzeRemoteSession,
  type RemoteAnalysis,
  type RemoteSession,
} from "../../lib/remoteSessionsIpc"
import { openSettingsWindow } from "../../lib/ipc"
import { RemoteSessionsStore } from "./RemoteSessionsStore"

const buttonClass =
  "rounded-control border border-separator px-3 py-1.5 type-body text-label hover:bg-surface-hover disabled:opacity-50"
const number = (value: number) => value.toLocaleString()
const date = (value: number | null | undefined) =>
  value ? new Date(value * 1000).toLocaleString() : "Unknown"

export function RemoteSessionsView({
  store: suppliedStore,
  hostFilter = "",
}: {
  store?: RemoteSessionsStore
  hostFilter?: string
}) {
  const [ownStore] = useState(() => new RemoteSessionsStore())
  const store = suppliedStore ?? ownStore
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [filter, setFilter] = useState("")
  const [selected, setSelected] = useState<{ host: string; session: RemoteSession } | null>(
    null,
  )
  const [analysis, setAnalysis] = useState<RemoteAnalysis | null>(null)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const request = useRef(0)

  async function select(host: string, session: RemoteSession) {
    const revision = ++request.current
    setSelected({ host, session })
    setAnalysis(null)
    setAnalysisError(null)
    setAnalyzing(true)
    try {
      const result = await analyzeRemoteSession(host, session)
      if (request.current === revision) setAnalysis(result)
    } catch (error) {
      if (request.current === revision) setAnalysisError(String(error))
    } finally {
      if (request.current === revision) setAnalyzing(false)
    }
  }

  const needle = filter.toLowerCase()
  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col text-label"
      aria-label="Remote sessions"
    >
      <header className="space-y-3 border-b border-separator p-5">
        <div className="flex items-center justify-between gap-3">
          <h1 className="type-title-2">Remote sessions</h1>
          <button
            className={buttonClass}
            disabled={!state.hosts.length || state.refreshing || state.loading || state.saving}
            onClick={() => void store.refresh(hostFilter || undefined)}
          >
            {state.refreshing ? "Refreshing…" : "Refresh hosts"}
          </button>
        </div>
        <p className="type-body text-label-secondary">
          Claude Code and Codex activity from your SSH hosts. Up to 200 recent transcripts per
          host from the last seven days.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            className={buttonClass}
            onClick={() => {
              setSettingsError(null)
              void openSettingsWindow("sources").catch((error: unknown) =>
                setSettingsError(String(error)),
              )
            }}
          >
            Manage hosts in Settings
          </button>
          <input
            aria-label="Filter remote sessions"
            placeholder="Filter sessions…"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            className="min-w-0 flex-1 rounded-control border border-separator bg-input-fill px-3 py-1.5 type-body"
          />
        </div>
        {settingsError && (
          <p role="alert" className="type-body text-label-secondary">
            {settingsError}
          </p>
        )}
        {state.error && (
          <p role="alert" className="type-body text-label-secondary">
            {state.error}
          </p>
        )}
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-2">
        <div className="overflow-auto border-r border-separator p-4">
          {!state.loaded && (
            <p role="status" className="type-body">
              Loading hosts…
            </p>
          )}
          {state.loaded && !state.hosts.length && (
            <p className="type-body text-label-secondary">
              Add a remote host in Settings → Sources, then refresh to discover sessions.
            </p>
          )}
          {state.hosts
            .filter((host) => !hostFilter || host === hostFilter)
            .map((host) => {
              const result = state.snapshots.get(host)
              const snapshot = result?.snapshot
              const sessions =
                snapshot?.sessions.filter((session) =>
                  `${session.title} ${session.cwd ?? ""} ${session.agent} ${host}`
                    .toLowerCase()
                    .includes(needle),
                ) ?? []
              return (
                <section key={host} className="mb-5 space-y-2" aria-label={host}>
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="type-headline">{host}</h2>
                  </div>
                  <p className="type-caption text-label-secondary">
                    {result?.error
                      ? "Unreachable · cached data"
                      : result?.connected
                        ? "Last connection succeeded"
                        : "Cached snapshot"}{" "}
                    · Updated {date(snapshot?.collectedAt)}
                  </p>
                  {result?.error && (
                    <p role="alert" className="break-words type-caption text-label-secondary">
                      {result.error}
                    </p>
                  )}
                  {snapshot?.truncated && (
                    <p className="type-caption text-label-secondary">
                      Showing the 200 most recently modified transcripts.
                    </p>
                  )}
                  {!!snapshot?.skipped && (
                    <p className="type-caption text-label-secondary">
                      {snapshot.skipped} unreadable or unrecognised transcripts skipped.
                    </p>
                  )}
                  {!sessions.length && (
                    <p className="type-body text-label-secondary">
                      {snapshot
                        ? "No matching recent sessions."
                        : "Refresh to collect sessions."}
                    </p>
                  )}
                  {sessions.map((session) => (
                    <button
                      key={JSON.stringify([session.agent, session.sessionId])}
                      disabled={analyzing}
                      onClick={() => void select(host, session)}
                      className={`block w-full rounded-control p-3 text-left hover:bg-surface-hover ${selected?.host === host && selected.session.agent === session.agent && selected.session.sessionId === session.sessionId ? "bg-surface-selected" : "bg-surface-card"}`}
                    >
                      <span className="block truncate type-body">{session.title}</span>
                      <span className="block truncate type-caption text-label-secondary">
                        {host} · {session.agent} · {session.surface} ·{" "}
                        {session.cwd ?? "Repository unknown"}
                      </span>
                      <span className="block type-caption text-label-secondary">
                        Last file change {date(session.updatedAt)}
                      </span>
                    </button>
                  ))}
                </section>
              )
            })}
        </div>
        <div className="space-y-4 overflow-auto p-5">
          {!selected && (
            <p className="type-body text-label-secondary">
              Select a session to analyse its context and token usage on the source machine.
            </p>
          )}
          {selected && (
            <>
              <p className="type-caption text-label-secondary">
                {selected.host} · {selected.session.agent}
              </p>
              <h2 className="break-words type-title-2">{selected.session.title}</h2>
              <p className="break-all type-caption text-label-secondary">
                {selected.session.cwd}
              </p>
              <button
                className={buttonClass}
                disabled={analyzing}
                onClick={() => void select(selected.host, selected.session)}
              >
                Refresh analysis
              </button>
            </>
          )}
          {analyzing && (
            <p role="status" className="type-body">
              Analysing on {selected?.host}…
            </p>
          )}
          {analysisError && (
            <p role="alert" className="break-words type-body text-label-secondary">
              {analysisError}
            </p>
          )}
          {analysis && (
            <>
              <p className="type-body">{analysis.metrics.model ?? "Model unknown"}</p>
              <dl className="grid grid-cols-2 gap-4 rounded-control bg-surface-card p-4">
                {[
                  ["Input tokens", number(analysis.metrics.tokensIn)],
                  ["Output tokens", number(analysis.metrics.tokensOut)],
                  ["Peak context", number(analysis.metrics.peakContextTokens)],
                  ["Compactions", number(analysis.metrics.compactionCount)],
                  [
                    "API-equivalent cost",
                    analysis.metrics.cost
                      ? `~$${analysis.metrics.cost.totalUsd.toFixed(2)}`
                      : "Unavailable",
                  ],
                  ["Duration", `${Math.round(analysis.metrics.durationSecs / 60)} min`],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="type-caption text-label-secondary">{label}</dt>
                    <dd className="type-headline">{value}</dd>
                  </div>
                ))}
              </dl>
              <h3 className="type-headline">Context over the session</h3>
              <svg
                viewBox="0 0 600 150"
                role="img"
                aria-label={`Context history, peak ${number(analysis.metrics.peakContextTokens)} tokens`}
                className="w-full rounded-control bg-surface-card text-accent"
              >
                <polyline
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  points={analysis.metrics.buckets
                    .map(
                      (bucket, index, buckets) =>
                        `${(index / Math.max(1, buckets.length - 1)) * 596 + 2},${148 - (bucket.contextTokens / Math.max(1, analysis.metrics.peakContextTokens)) * 144}`,
                    )
                    .join(" ")}
                />
              </svg>
              <p className="type-caption text-label-secondary">{analysis.coverage}</p>
              <p className="type-caption text-label-secondary">
                Collected {date(analysis.collectedAt)}. File activity does not confirm a running
                process.
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
