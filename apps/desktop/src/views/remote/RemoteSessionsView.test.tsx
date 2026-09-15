import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"
import {
  analyzeRemoteSession,
  getRemoteHosts,
  getRemoteSessions,
} from "../../lib/remoteSessionsIpc"
import { RemoteSessionsView } from "./RemoteSessionsView"

vi.mock("../../lib/remoteSessionsIpc", () => ({
  getRemoteHosts: vi.fn(),
  getRemoteSessions: vi.fn(),
  setRemoteHosts: vi.fn(),
  analyzeRemoteSession: vi.fn(),
}))

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getRemoteHosts).mockResolvedValue(["build-one", "build-two"])
  vi.mocked(getRemoteSessions).mockImplementation(async (host) => ({
    host,
    connected: false,
    error: null,
    snapshot: {
      version: 1,
      collectedAt: 100,
      truncated: false,
      skipped: 0,
      lookbackSecs: 604800,
      sessions: [
        {
          agent: "codex",
          sessionId: "same-id",
          title: `${host} session`,
          cwd: "/synthetic/project",
          surface: "cli",
          updatedAt: 100,
        },
      ],
    },
  }))
  vi.mocked(analyzeRemoteSession).mockRejectedValue(new Error("Host is offline"))
})

it("routes identical session IDs to their selected host and displays a connection error", async () => {
  render(<RemoteSessionsView />)
  fireEvent.click(await screen.findByRole("button", { name: /build-two session/ }))
  await waitFor(() =>
    expect(analyzeRemoteSession).toHaveBeenCalledWith(
      "build-two",
      expect.objectContaining({ sessionId: "same-id", agent: "codex" }),
    ),
  )
  expect(await screen.findByRole("alert")).toHaveTextContent("Host is offline")
  expect(screen.getByRole("button", { name: "Refresh analysis" })).toBeEnabled()
})

it("filters cached sessions without starting SSH", async () => {
  render(<RemoteSessionsView />)
  await screen.findByRole("button", { name: /build-two session/ })
  fireEvent.change(screen.getByRole("textbox", { name: "Filter remote sessions" }), {
    target: { value: "build-one" },
  })
  expect(screen.queryByRole("button", { name: /build-two session/ })).not.toBeInTheDocument()
  expect(screen.getByRole("button", { name: /build-one session/ })).toBeVisible()
  expect(getRemoteSessions).toHaveBeenCalledTimes(2)
  expect(analyzeRemoteSession).not.toHaveBeenCalled()
})
