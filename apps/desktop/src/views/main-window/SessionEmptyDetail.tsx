import { MessagesSquare, SearchX } from "lucide-react"

import type { MainWindowNavigationNotice } from "../../lib/ipc"

export function SessionEmptyDetail({
  notice = null,
}: {
  notice?: MainWindowNavigationNotice | null
}) {
  const notFound = notice === "sessionNotFound"
  const Icon = notFound ? SearchX : MessagesSquare
  return (
    <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-6 text-center">
      <div
        className="flex max-w-xs flex-col items-center"
        role={notFound ? "status" : undefined}
      >
        <div
          className="mb-4 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-surface-secondary text-label-tertiary"
          aria-hidden="true"
        >
          <Icon size={24} strokeWidth={1.5} />
        </div>
        <h3 className="type-title-2 text-balance text-label">
          {notFound ? "Session not found" : "No session selected"}
        </h3>
        <p className="mt-2 type-body text-pretty text-label-secondary">
          {notFound
            ? "antiburn has not discovered the linked session on this device. Choose a session from the list to explore it."
            : "Choose a session from the list to explore its activity, cost, and burn checks."}
        </p>
      </div>
    </div>
  )
}
