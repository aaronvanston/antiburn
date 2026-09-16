import { useState, useSyncExternalStore, type ComponentProps } from "react"

import { isMacOS } from "../../lib/platform"
import { openSettingsWindow } from "../../lib/ipc"
import { MainActivityView } from "../main-window/MainActivityView"
import { RemoteSessionsStore } from "./RemoteSessionsStore"

export function MachineSessionsView({
  machine,
  onMachineChange,
  ...activityProps
}: ComponentProps<typeof MainActivityView> & {
  machine: string
  onMachineChange: (machine: string) => void
}) {
  const [store] = useState(() => new RemoteSessionsStore())
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const [error, setError] = useState<string | null>(null)
  const effectiveMachine =
    machine.startsWith("host:") && state.loaded && !state.hosts.includes(machine.slice(5))
      ? "remote"
      : machine
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <div
        data-tauri-drag-region={isMacOS() ? "deep" : undefined}
        className={`flex flex-wrap items-center gap-3 border-b border-separator px-5 pb-3 ${isMacOS() ? "pt-10" : "pt-3"}`}
      >
        <label className="flex min-w-0 items-center gap-2 type-body text-label">
          Machine
          <select
            aria-label="Session machine"
            value={effectiveMachine}
            onChange={(event) => onMachineChange(event.target.value)}
            className="min-w-0 rounded-control border border-separator bg-input-fill px-3 py-1.5 type-body"
          >
            <option value="all">All machines</option>
            <option value="local">This machine</option>
            <option value="remote">All remote hosts</option>
            {state.hosts.map((host) => (
              <option key={host} value={`host:${host}`}>
                {host}
              </option>
            ))}
          </select>
        </label>
        <button
          className="ui-push-button"
          onClick={() => {
            setError(null)
            void openSettingsWindow("sources").catch((cause: unknown) =>
              setError(String(cause)),
            )
          }}
        >
          Manage hosts…
        </button>
        <button
          className="ui-push-button"
          disabled={state.refreshing || state.loading || !state.hosts.length}
          onClick={() =>
            void store.refresh(
              effectiveMachine.startsWith("host:") ? effectiveMachine.slice(5) : undefined,
            )
          }
        >
          {state.refreshing ? "Syncing transcripts…" : "Sync remote sessions"}
        </button>
        {state.progress && (
          <p role="status" className="type-footnote text-label-secondary">
            {state.progress.host}: {state.progress.completed}/{state.progress.total} sessions
          </p>
        )}
        {error && (
          <p role="alert" className="type-footnote text-label-secondary">
            {error}
          </p>
        )}
        {[...state.snapshots.values()]
          .filter(
            (value) =>
              (effectiveMachine === "all" ||
                effectiveMachine === "remote" ||
                effectiveMachine === `host:${value.host}`) &&
              (value.snapshot?.truncated || value.snapshot?.skipped),
          )
          .map((value) => (
            <p key={value.host} className="type-footnote text-label-secondary">
              {value.host}: {value.snapshot?.truncated ? "Latest 200 sessions only. " : ""}
              {value.snapshot?.skipped ? `${value.snapshot.skipped} sources skipped.` : ""}
            </p>
          ))}
        {state.error && (
          <p role="alert" className="type-footnote text-label-secondary">
            {state.error}
          </p>
        )}
      </div>
      <div className="flex min-h-0 min-w-0 flex-1">
        <MainActivityView {...activityProps} machine={effectiveMachine} />
      </div>
    </div>
  )
}
