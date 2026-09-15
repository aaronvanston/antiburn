import { Clock } from "lucide-react"

import { Tooltip } from "../../../components/presentation/Tooltip"

export function RemindLaterAction() {
  return (
    <Tooltip label="Coming soon" side="bottom">
      <button
        type="button"
        aria-disabled="true"
        className="burn-check-action burn-check-reminder type-callout gap-1"
      >
        <Clock size={12} aria-hidden="true" />
        Remind me later
      </button>
    </Tooltip>
  )
}
