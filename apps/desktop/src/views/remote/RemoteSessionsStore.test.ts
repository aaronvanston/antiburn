import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  getRemoteHosts,
  onRemoteSyncStatus,
  getRemoteSessions,
  setRemoteHosts,
  type HostSnapshot,
} from "../../lib/remoteSessionsIpc"
import { RemoteSessionsStore } from "./RemoteSessionsStore"

vi.mock("../../lib/remoteSessionsIpc", () => ({
  onRemoteSyncStatus: vi.fn(async () => () => {}),
  getRemoteSyncStatus: async () => ({ intervalSecs: 300, progress: null, errors: {} }),
  setRemoteSyncInterval: vi.fn(),
  getRemoteHosts: vi.fn(),
  getRemoteSessions: vi.fn(),
  setRemoteHosts: vi.fn(),
}))

const cached: HostSnapshot = {
  host: "test-box",
  connected: false,
  error: null,
  snapshot: {
    version: 1,
    collectedAt: 100,
    sessions: [],
    truncated: false,
    skipped: 0,
    lookbackSecs: 604800,
  },
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getRemoteHosts).mockResolvedValue(["test-box"])
  vi.mocked(getRemoteSessions).mockResolvedValue(cached)
  vi.mocked(setRemoteHosts).mockResolvedValue()
})

const subscriptions: (() => void)[] = []
afterEach(() => {
  for (const stop of subscriptions.splice(0)) stop()
})

async function loadedStore() {
  const store = new RemoteSessionsStore()
  subscriptions.push(store.subscribe(() => undefined))
  await vi.waitFor(() => expect(store.getSnapshot().loaded).toBe(true))
  return store
}

describe("remote snapshots", () => {
  it("loads only cached data until the user refreshes", async () => {
    const store = await loadedStore()
    expect(getRemoteSessions).toHaveBeenCalledExactlyOnceWith("test-box", false)
    await store.refresh()
    expect(getRemoteSessions).toHaveBeenLastCalledWith("test-box", true)
  })
  it("preserves the last snapshot after a failed connection", async () => {
    const store = await loadedStore()
    vi.mocked(getRemoteSessions).mockRejectedValueOnce(new Error("Offline"))
    await store.refresh()
    const result = store.getSnapshot().snapshots.get("test-box")
    expect(result?.snapshot?.collectedAt).toBe(100)
    expect(result?.connected).toBe(false)
    expect(result?.error).toContain("Offline")
    expect(store.getSnapshot().refreshing).toBe(false)
  })
  it("coalesces refreshes and prevents host removal while collecting", async () => {
    const store = await loadedStore()
    let finish!: (value: HostSnapshot) => void
    vi.mocked(getRemoteSessions).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const pending = store.refresh()
    await store.refresh()
    await store.save([])
    expect(setRemoteHosts).not.toHaveBeenCalled()
    finish(cached)
    await pending
    expect(getRemoteSessions).toHaveBeenCalledTimes(2)
  })
  it("removes a host and its cached snapshot together", async () => {
    const store = await loadedStore()
    await store.save([])
    expect(setRemoteHosts).toHaveBeenCalledWith([])
    expect(store.getSnapshot().snapshots.size).toBe(0)
  })
})

it("reloads host changes on focus without reconnecting, and releases the focus listener", async () => {
  const store = await loadedStore()
  vi.mocked(getRemoteHosts).mockResolvedValue([])
  window.dispatchEvent(new Event("focus"))
  await vi.waitFor(() => expect(store.getSnapshot().hosts).toEqual([]))
  expect(store.getSnapshot().snapshots.size).toBe(0)
  expect(getRemoteSessions).toHaveBeenCalledExactlyOnceWith("test-box", false)
  for (const stop of subscriptions.splice(0)) stop()
  window.dispatchEvent(new Event("focus"))
  expect(getRemoteHosts).toHaveBeenCalledTimes(2)
})

it("queues focus reloads during collection so a removed host cannot reappear", async () => {
  const store = await loadedStore()
  let finish!: (value: HostSnapshot) => void
  vi.mocked(getRemoteSessions).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const refresh = store.refresh()
  vi.mocked(getRemoteHosts).mockResolvedValue([])
  window.dispatchEvent(new Event("focus"))
  expect(getRemoteHosts).toHaveBeenCalledTimes(1)
  finish(cached)
  await refresh
  await vi.waitFor(() => expect(store.getSnapshot().hosts).toEqual([]))
  expect(store.getSnapshot().snapshots.size).toBe(0)
})

it("observes background progress and completion from other windows", async () => {
  const store = await loadedStore()
  const update = vi.mocked(onRemoteSyncStatus).mock.calls[0]![0]
  update({
    intervalSecs: 900,
    progress: { host: "test-box", completed: 1, total: 3 },
    errors: {},
  })
  expect(store.getSnapshot().progress?.completed).toBe(1)
  expect(store.getSnapshot().intervalSecs).toBe(900)
  await store.refresh()
  expect(getRemoteSessions).toHaveBeenCalledTimes(1)
  update({ intervalSecs: 300, progress: null, errors: {} })
  await vi.waitFor(() => expect(getRemoteSessions).toHaveBeenCalledTimes(2))
  expect(store.getSnapshot().progress).toBeNull()
  expect(getRemoteSessions).toHaveBeenLastCalledWith("test-box", false)
})

it("does not replace a newer scan event with an older cached load", async () => {
  const store = await loadedStore()
  const update = vi.mocked(onRemoteSyncStatus).mock.calls[0]![0]
  let finish!: (value: HostSnapshot) => void
  vi.mocked(getRemoteSessions).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  window.dispatchEvent(new Event("focus"))
  await vi.waitFor(() => expect(getRemoteSessions).toHaveBeenCalledTimes(2))
  update({
    intervalSecs: 900,
    progress: { host: "test-box", completed: 2, total: 3 },
    errors: {},
  })
  finish(cached)
  await vi.waitFor(() => expect(store.getSnapshot().loading).toBe(false))
  expect(store.getSnapshot().progress?.completed).toBe(2)
  expect(store.getSnapshot().intervalSecs).toBe(900)
  for (const stop of subscriptions.splice(0)) stop()
  update({ intervalSecs: 0, progress: null, errors: {} })
  expect(store.getSnapshot().intervalSecs).toBe(900)
})
