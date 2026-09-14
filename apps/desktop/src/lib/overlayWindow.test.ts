import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { HudVisibilitySession, type HudPreferences } from "./overlayWindow"

const invoke = vi.hoisted(() => vi.fn())
const events = vi.hoisted(() => new Map<string, (event: { payload: unknown }) => void>())
vi.mock("@tauri-apps/api/core", () => ({ invoke }))
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
    events.set(name, handler)
    return () => events.delete(name)
  }),
}))
const initial: HudPreferences = { enabled: true, dynamic: true, edge: "top" }
async function flush() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

describe("HUD preferences", () => {
  beforeEach(() => {
    events.clear()
    localStorage.clear()
    invoke.mockReset().mockResolvedValue(initial)
  })
  afterEach(() => vi.restoreAllMocks())

  it("keeps enabled state through temporary native conceal and synchronizes explicit close", async () => {
    const session = new HudVisibilitySession()
    const stop = session.subscribe(() => {})
    await flush()
    expect(session.getSnapshot()).toBe(true)
    expect(events.has("overlay_visibility_changed")).toBe(false)
    events.get("hud:settings")!({ payload: { ...initial, enabled: false } })
    expect(session.getSnapshot()).toBe(false)
    expect(localStorage.getItem("antiburn.showFloatingHud")).toBe("0")
    stop()
  })

  it("writes only changed fields and keeps explicit retrieval separate from enabling", () => {
    const session = new HudVisibilitySession()
    session.change({ edge: "left" })
    expect(invoke).toHaveBeenCalledWith("set_hud_preferences", { change: { edge: "left" } })
    session.set(true)
    expect(invoke).toHaveBeenCalledWith("set_hud_preferences", { change: { enabled: true } })
    session.reveal()
    expect(invoke).toHaveBeenCalledWith("open_overlay_window", { origin: "user" })
  })

  it("ignores a stale read after a newer preference event", async () => {
    let resolve!: (value: HudPreferences) => void
    invoke.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const session = new HudVisibilitySession()
    const stop = session.subscribe(() => {})
    await flush()
    events.get("hud:settings")!({ payload: { ...initial, edge: "bottom" } })
    resolve(initial)
    await flush()
    expect(session.getPreferencesSnapshot().edge).toBe("bottom")
    stop()
  })

  it("reports a failed setting save without inventing success", async () => {
    invoke.mockRejectedValueOnce(new Error("disk full"))
    const session = new HudVisibilitySession()
    session.set(true)
    await flush()
    expect(session.getSnapshot()).toBe(false)
    expect(session.getError()).toMatch(/could not be applied/)
  })
})
