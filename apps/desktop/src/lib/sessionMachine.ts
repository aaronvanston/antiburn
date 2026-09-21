import type { SessionListEntry } from "../components/session/SessionList"

export function sessionsOnMachine(
  entries: readonly SessionListEntry[],
  machine: string,
): SessionListEntry[] {
  return entries.filter(
    (entry) =>
      machine === "all" ||
      (machine === "local"
        ? !entry.remoteHost
        : machine === "remote"
          ? !!entry.remoteHost
          : entry.remoteHost === machine.slice(5)),
  )
}
