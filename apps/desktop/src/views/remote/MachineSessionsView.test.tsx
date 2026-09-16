import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useState } from "react"
import { beforeEach, expect, it, vi } from "vitest"

import { openSettingsWindow } from "../../lib/ipc"
import { getRemoteHosts, getRemoteSessions } from "../../lib/remoteSessionsIpc"
import { MainActivitySession } from "../main-window/MainActivitySession"
import { MachineSessionsView } from "./MachineSessionsView"

vi.mock("../../lib/remoteSessionsIpc", () => ({
  onRemoteSyncProgress: async () => () => {},
  getRemoteHosts: vi.fn(),
  getRemoteSessions: vi.fn(),
  setRemoteHosts: vi.fn(),
  analyzeRemoteSession: vi.fn(),
}))
vi.mock("../../lib/ipc", () => ({ openSettingsWindow: vi.fn() }))
vi.mock("../main-window/MainActivityView", () => ({
  MainActivityView: ({ machine }: { machine: string }) => (
    <p>Standard session list: {machine}</p>
  ),
}))
vi.mock("../main-window/MainActivitySession", () => ({ MainActivitySession: class {} }))

function Harness() {
  const [machine, setMachine] = useState("local")
  return (
    <MachineSessionsView
      active
      session={new MainActivitySession()}
      hygieneBySession={new Map()}
      machine={machine}
      onMachineChange={setMachine}
    />
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(openSettingsWindow).mockResolvedValue()
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
          title: `${host} task`,
          cwd: "/test/project",
          surface: "cli",
          updatedAt: 100,
        },
      ],
    },
  }))
})

it("switches between local sessions and specific remote origins without starting SSH", async () => {
  render(<Harness />)
  expect(screen.getByText("Standard session list: local")).toBeVisible()
  await screen.findByRole("option", { name: "build-two" })
  fireEvent.change(screen.getByRole("combobox", { name: "Session machine" }), {
    target: { value: "host:build-two" },
  })
  expect(screen.getByText("Standard session list: host:build-two")).toBeVisible()
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "remote" } })
  expect(screen.getByText("Standard session list: remote")).toBeVisible()
  expect(getRemoteSessions).toHaveBeenCalledTimes(2)
  expect(getRemoteSessions).not.toHaveBeenCalledWith(expect.anything(), true)
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "local" } })
  expect(screen.getByText("Standard session list: local")).toBeVisible()
})

it("opens host settings and reconciles changes when the main window regains focus", async () => {
  render(<Harness />)
  await screen.findByRole("option", { name: "build-two" })
  fireEvent.click(screen.getByRole("button", { name: "Manage hosts…" }))
  expect(openSettingsWindow).toHaveBeenCalledWith("sources")
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "host:build-two" } })
  vi.mocked(getRemoteHosts).mockResolvedValue(["build-one"])
  fireEvent.focus(window)
  await waitFor(() =>
    expect(screen.queryByRole("option", { name: "build-two" })).not.toBeInTheDocument(),
  )
  expect(screen.getByRole("combobox")).toHaveValue("remote")
  expect(screen.queryByRole("button", { name: /build-two task/ })).not.toBeInTheDocument()
})

it("syncs only the selected machine without replacing the standard session view", async () => {
  render(<Harness />)
  await screen.findByRole("option", { name: "build-two" })
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "host:build-two" } })
  fireEvent.click(screen.getByRole("button", { name: "Sync remote sessions" }))
  await waitFor(() => expect(getRemoteSessions).toHaveBeenCalledWith("build-two", true))
  expect(getRemoteSessions).not.toHaveBeenCalledWith("build-one", true)
  expect(screen.getByText("Standard session list: host:build-two")).toBeVisible()
})
