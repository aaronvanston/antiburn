import { expect, it } from "vitest"
import { sessionsOnMachine } from "./sessionMachine"
import { toActivityEntries } from "./activityEntries"
import { sessionKey } from "./sessionSubject"
import { costSubjectKey, topLevelCostSubject } from "./presentation/sessionCosts"

it("filters machine origins while keeping colliding session IDs separate", () => {
  const entries = toActivityEntries(
    [null, "one", "two"].map((remoteHost) => ({
      agent: "codex",
      sessionId: "same",
      remoteHost,
      repo: "project",
      timestamp: "2026-09-15T10:00:00Z",
      isActive: false,
      surface: "cli",
      wslDistro: null,
      title: "Synthetic",
      hasForkParent: false,
      forkChildCount: 0,
      cost: null,
      models: [],
      modelRuns: [],
    })),
  )
  expect(sessionsOnMachine(entries, "all")).toHaveLength(3)
  expect(sessionsOnMachine(entries, "local")).toHaveLength(1)
  expect(sessionsOnMachine(entries, "remote")).toHaveLength(2)
  expect(sessionsOnMachine(entries, "host:two")[0]?.remoteHost).toBe("two")
  const subjects = [undefined, "one", "two"].map((remoteHost) => ({
    agent: "codex",
    sessionId: "same",
    remoteHost,
  }))
  expect(new Set(subjects.map(sessionKey)).size).toBe(3)
  expect(
    new Set(
      subjects.map((subject) =>
        costSubjectKey(
          topLevelCostSubject(subject.agent, subject.sessionId, null, subject.remoteHost),
        ),
      ),
    ).size,
  ).toBe(3)
})
