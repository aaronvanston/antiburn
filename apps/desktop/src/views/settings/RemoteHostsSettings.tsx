import { useState, useSyncExternalStore } from "react"

import { Card } from "../../components/ui/Card"
import { PushButton } from "../../components/ui/PushButton"
import { SectionGroup } from "../../components/ui/SectionGroup"
import { RemoteSessionsStore } from "../remote/RemoteSessionsStore"

export function RemoteHostsSettings() {
  const [store] = useState(() => new RemoteSessionsStore())
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const [alias, setAlias] = useState("")
  const busy = !state.loaded || state.loading || state.saving || state.refreshing

  return (
    <SectionGroup title="Remote hosts">
      <Card>
        <div className="space-y-4 p-4">
          <p className="type-footnote text-label-secondary">
            Discover Claude Code and Codex sessions on your other machines over SSH. Select a
            machine in Sessions to browse its activity. Changes save automatically.
          </p>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (busy || !alias.trim()) return
              void store
                .save([...state.hosts, alias.trim()])
                .then(() => setAlias(""))
                .catch(() => undefined)
            }}
          >
            <label className="min-w-0 flex-1 space-y-1 type-footnote text-label">
              <span className="block">SSH host alias</span>
              <input
                value={alias}
                onChange={(event) => setAlias(event.target.value)}
                placeholder="e.g. my-dev-box"
                className="w-full rounded-control border border-separator bg-input-fill px-3 py-1.5 type-body"
              />
            </label>
            <button
              type="submit"
              className="ui-push-button disabled:opacity-50"
              disabled={busy || !alias.trim() || state.hosts.length >= 8}
            >
              Add host
            </button>
          </form>
          {state.progress && (
            <p role="status" className="type-footnote text-label-secondary">
              {state.progress.host}: {state.progress.completed}/{state.progress.total} sessions
            </p>
          )}
          <p className="type-caption text-label-secondary">
            Use an existing SSH alias with key authentication. The remote helper must be
            installed at ~/.local/bin/antiburn-remote on that machine. Up to eight hosts.
          </p>
          {!state.loaded && (
            <p role="status" className="type-footnote">
              Loading hosts…
            </p>
          )}
          {state.error && (
            <p role="alert" className="break-words type-footnote text-system-red-text">
              {state.error}
            </p>
          )}
          {state.loaded && !state.hosts.length && (
            <p className="type-footnote text-label-secondary">No remote hosts configured.</p>
          )}
          {state.hosts.map((host) => {
            const result = state.snapshots.get(host)
            return (
              <div key={host} className="space-y-2 border-t border-separator pt-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 break-all type-body text-label">{host}</span>
                  <PushButton
                    disabled={busy}
                    onClick={() => void store.refresh(host)}
                    ariaLabel={`Sync sessions to ${host}`}
                  >
                    Sync sessions
                  </PushButton>
                  <PushButton
                    disabled={busy}
                    onClick={() =>
                      void store
                        .save(state.hosts.filter((item) => item !== host))
                        .catch(() => undefined)
                    }
                    ariaLabel={`Remove ${host}`}
                  >
                    Remove
                  </PushButton>
                </div>
                <p role="status" className="break-words type-footnote text-label-secondary">
                  {result?.error
                    ? result.error
                    : result?.connected
                      ? `Synced · ${result.snapshot?.sessions.length ?? 0} recent sessions`
                      : "Not synced in this window"}
                </p>
              </div>
            )
          })}
          {state.progress && (
            <p role="status" className="type-footnote text-label-secondary">
              {state.progress.host}: {state.progress.completed}/{state.progress.total} sessions
            </p>
          )}
          <p className="type-caption text-label-secondary">
            Syncing copies transcripts and companion files into a private local cache for full
            analysis. Removing a host clears its cached transcripts and analysis on this
            machine; sessions on the remote machine stay intact.
          </p>
        </div>
      </Card>
    </SectionGroup>
  )
}
