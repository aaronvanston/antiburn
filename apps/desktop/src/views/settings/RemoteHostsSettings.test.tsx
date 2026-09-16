import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, expect, it, vi } from "vitest"

import {
  getRemoteHosts,
  getRemoteSessions,
  setRemoteHosts,
  setRemoteSyncInterval,
} from "../../lib/remoteSessionsIpc"
import { RemoteHostsSettings } from "./RemoteHostsSettings"

vi.mock("../../lib/remoteSessionsIpc", () => ({
  onRemoteSyncStatus: vi.fn(async () => () => {}),
  getRemoteSyncStatus: async () => ({ intervalSecs: 300, progress: null, errors: {} }),
  setRemoteSyncInterval: vi.fn(),
  getRemoteHosts: vi.fn(),
  getRemoteSessions: vi.fn(),
  setRemoteHosts: vi.fn(),
}))

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getRemoteHosts).mockResolvedValue(["build-one"])
  vi.mocked(setRemoteHosts).mockResolvedValue()
  vi.mocked(getRemoteSessions).mockImplementation(async (host, refresh) => ({
    host,
    connected: refresh,
    error: null,
    snapshot: null,
  }))
})

it("adds and removes hosts from Settings without starting SSH", async () => {
  render(<RemoteHostsSettings />)
  await screen.findByText("build-one")
  fireEvent.change(screen.getByRole("textbox", { name: "SSH host alias" }), {
    target: { value: " build-two " },
  })
  fireEvent.click(screen.getByRole("button", { name: "Add host" }))
  await screen.findByText("build-two")
  expect(setRemoteHosts).toHaveBeenCalledWith(["build-one", "build-two"])
  expect(screen.getByRole("textbox")).toHaveValue("")
  fireEvent.click(screen.getByRole("button", { name: "Remove build-one" }))
  await waitFor(() => expect(screen.queryByText("build-one")).not.toBeInTheDocument())
  expect(setRemoteHosts).toHaveBeenLastCalledWith(["build-two"])
  expect(getRemoteSessions).toHaveBeenCalledExactlyOnceWith("build-one", false)
})

it("syncs only the chosen host and shows connection failures", async () => {
  vi.mocked(getRemoteHosts).mockResolvedValue(["build-one", "build-two"])
  render(<RemoteHostsSettings />)
  await screen.findByText("build-two")
  fireEvent.click(screen.getByRole("button", { name: "Scan build-two now" }))
  await screen.findByText("Synced · 0 recent sessions")
  expect(getRemoteSessions).toHaveBeenLastCalledWith("build-two", true)
  vi.mocked(getRemoteSessions).mockRejectedValueOnce(new Error("Permission denied"))
  fireEvent.click(screen.getByRole("button", { name: "Scan build-one now" }))
  await screen.findByText("Error: Permission denied")
})

it("retains the alias and saved hosts when persistence fails", async () => {
  vi.mocked(setRemoteHosts).mockRejectedValueOnce(new Error("Duplicate SSH host alias"))
  render(<RemoteHostsSettings />)
  await screen.findByText("build-one")
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "build-one" } })
  fireEvent.click(screen.getByRole("button", { name: "Add host" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("Duplicate SSH host alias")
  expect(screen.getByRole("textbox")).toHaveValue("build-one")
  expect(screen.getAllByRole("button", { name: /Remove/ })).toHaveLength(1)
})

it("saves the automatic scan frequency and supports manual mode", async () => {
  render(<RemoteHostsSettings />)
  await screen.findByText("build-one")
  const frequency = screen.getByRole("combobox", { name: "Rescan remote sessions" })
  expect(frequency).toHaveValue("300")
  fireEvent.change(frequency, { target: { value: "900" } })
  await waitFor(() => expect(setRemoteSyncInterval).toHaveBeenCalledWith(900))
  await waitFor(() => expect(frequency).toHaveValue("900"))
  fireEvent.change(frequency, { target: { value: "0" } })
  await screen.findByText(/Automatic scans are off/)
  expect(setRemoteSyncInterval).toHaveBeenLastCalledWith(0)
})
