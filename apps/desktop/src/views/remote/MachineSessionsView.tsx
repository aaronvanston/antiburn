import { useState, useSyncExternalStore, type ComponentProps } from "react"

import { isMacOS } from "../../lib/platform"
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
      </div>
      <div className="flex min-h-0 min-w-0 flex-1">
        <MainActivityView {...activityProps} machine={effectiveMachine} />
      </div>
    </div>
  )
}
