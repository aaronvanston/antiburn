import { describe, expect, it, vi } from "vitest"

import type { LiveUsageSummaryPayload } from "../../lib/providerUsageIpc"
import {
  MainWindowLimitsSession,
  type MainWindowLimitsAdapter,
} from "./MainWindowLimitsSession"

const liveUsage = (generatedAt: string): LiveUsageSummaryPayload => ({
  providers: [],
  errors: [],
  meters: [],
  generatedAt,
})

function setup(visibleInitially = true) {
  let visible: (value: boolean) => void = () => undefined
  let liveChanged: (value: LiveUsageSummaryPayload) => void = () => undefined
  const adapter: MainWindowLimitsAdapter = {
    getLiveUsage: vi.fn().mockResolvedValue(liveUsage("first")),
    getVisible: vi.fn().mockResolvedValue(visibleInitially),
    onVisible: vi.fn(async (handler) => {
      visible = handler
      return vi.fn()
    }),
    onLiveUsageChanged: vi.fn(async (handler) => {
      liveChanged = handler
      return vi.fn()
    }),
  }
  return {
    adapter,
    session: new MainWindowLimitsSession(adapter),
    setVisible: (value: boolean) => visible(value),
    liveChanged: (value: LiveUsageSummaryPayload) => liveChanged(value),
  }
}

describe("MainWindowLimitsSession", () => {
  it("reads the limits for the sidebar without any section being active", async () => {
    // The sidebar shows the limits in every section, so the store answers to
    // the window alone.
    const { adapter, session } = setup()
    const stop = session.subscribe(() => undefined)
    await vi.waitFor(() => expect(session.getSnapshot().liveUsage?.generatedAt).toBe("first"))
    expect(session.getSnapshot().loading).toBe(false)
    expect(adapter.getLiveUsage).toHaveBeenCalledOnce()
    stop()
  })

  it("stays quiet while the window is hidden and reads again when it returns", async () => {
    const { adapter, session, setVisible, liveChanged } = setup(false)
    const stop = session.subscribe(() => undefined)
    await vi.waitFor(() => expect(adapter.getVisible).toHaveBeenCalled())
    expect(adapter.getLiveUsage).not.toHaveBeenCalled()

    // A push to a hidden window reaches nobody, so it must not be kept.
    liveChanged(liveUsage("hidden"))
    expect(session.getSnapshot().liveUsage).toBeNull()

    setVisible(true)
    await vi.waitFor(() => expect(session.getSnapshot().liveUsage?.generatedAt).toBe("first"))
    liveChanged(liveUsage("pushed"))
    expect(session.getSnapshot().liveUsage?.generatedAt).toBe("pushed")
    stop()
  })

  it("leaves the sidebar usable when the read fails", async () => {
    const { adapter, session } = setup()
    vi.mocked(adapter.getLiveUsage).mockRejectedValueOnce(new Error("no reading"))
    const stop = session.subscribe(() => undefined)
    await vi.waitFor(() => expect(session.getSnapshot().loading).toBe(false))
    expect(session.getSnapshot().liveUsage).toBeNull()
    stop()
  })
})
