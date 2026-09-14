import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type * as IpcModule from "../../lib/ipc"
import type { SessionAnalysisPayload } from "../../lib/ipc"
import { SessionPane, type SessionPaneProps } from "./SessionPane"

const mocks = vi.hoisted(() => ({
  revealSource: vi.fn(),
}))

vi.mock("../../lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof IpcModule>()),
  revealSource: mocks.revealSource,
}))

afterEach(cleanup)

/** The smallest analysis payload the pane accepts, with a chosen source path. */
function analysisPayload(sourcePath: string | null): SessionAnalysisPayload {
  return {
    summary: null,
    supportsAnalysis: true,
    title: "Fix the flaky test",
    wslDistro: null,
    isActive: false,
    cost: null,
    topLevelCost: null,
    subagentsCost: null,
    inclusiveTokens: null,
    subagentsTokens: null,
    efficiency: null,
    models: [],
    modelRuns: [],
    orchestration: null,
    relations: null,
    sourcePath,
    startedAtEpoch: null,
    analysisPending: false,
    analysisStale: false,
  }
}

function paneProps(sourcePath: string | null): SessionPaneProps {
  return {
    subject: {
      agent: "claude-code",
      sessionId: "session-1",
      wslDistro: null,
      title: "Fix the flaky test",
    },
    payload: analysisPayload(sourcePath),
    loading: false,
    refreshing: false,
    error: false,
    onOpenSession: () => {},
    onDeleted: () => {},
  }
}

function pane(sourcePath: string | null) {
  return render(<SessionPane {...paneProps(sourcePath)} />)
}

const writeText = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  writeText.mockResolvedValue(undefined)
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  })
})

describe("SessionPane — copy path", () => {
  it.each([
    "/Users/dev/.claude/projects/app/session-1.jsonl",
    "/Users/name with spaces/Éxamples/“quoted” & $PATH/transcript.jsonl",
    String.raw`C:\Users\dev\AppData\Roaming\agent logs\session 1.jsonl`,
    "/tmp/日本語/セッション⚡️.jsonl",
    "/weird/newline\nand\ttab/path.jsonl",
  ])("copies the exact source path as plain text: %s", async (sourcePath) => {
    pane(sourcePath)

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Copy path"))
    })

    expect(writeText).toHaveBeenCalledExactlyOnceWith(sourcePath)
    expect(screen.getByTestId("copy-path-tick")).toBeTruthy()
  })

  it("hides copy and reveal when the payload has no source path", () => {
    pane(null)
    expect(screen.queryByLabelText("Copy path")).toBeNull()
    expect(screen.queryByLabelText("Reveal in file manager")).toBeNull()
  })

  it("shows no success tick when the clipboard write fails", async () => {
    writeText.mockRejectedValue(new Error("denied"))
    pane("/Users/dev/.claude/projects/app/session-1.jsonl")

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Copy path"))
    })

    expect(writeText).toHaveBeenCalledOnce()
    expect(screen.queryByTestId("copy-path-tick")).toBeNull()
    expect(screen.getByLabelText("Copy path")).toBeTruthy()
  })

  it("shows no success tick when the clipboard API is unavailable", async () => {
    pane("/Users/dev/.claude/projects/app/session-1.jsonl")
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    })

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Copy path"))
    })

    expect(screen.queryByTestId("copy-path-tick")).toBeNull()
  })

  it("keeps reveal wired to the shell command, separate from copy", async () => {
    const sourcePath = "/Users/dev/.claude/projects/app/session-1.jsonl"
    pane(sourcePath)

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Reveal in file manager"))
    })

    expect(mocks.revealSource).toHaveBeenCalledExactlyOnceWith(sourcePath)
    expect(writeText).not.toHaveBeenCalled()
  })
})
