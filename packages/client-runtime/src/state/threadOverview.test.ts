import {
  EnvironmentId,
  RunId,
  RuntimeRequestId,
  ThreadId,
  type OrchestrationV2ThreadShell,
  type ThreadPullRequestLink,
  type ThreadPullRequestSnapshot,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { presentThreadShell, type PendingSubagentRequest } from "./models.ts";
import { v2Now, v2ThreadShell } from "./orchestrationV2TestFixtures.ts";
import {
  groupThreadOverview,
  isThreadOverviewChild,
  threadOverviewGroupOf,
  type ThreadOverviewGroup,
} from "./threadOverview.ts";

const environmentId = EnvironmentId.make("environment-1");
const parentId = ThreadId.make("coordinator");
const runId = RunId.make("run-1");

const running: Partial<OrchestrationV2ThreadShell> = {
  latestRunId: runId,
  activeRunId: runId,
  status: "running",
  activityRunStatus: "running",
};
const completed: Partial<OrchestrationV2ThreadShell> = { latestRunId: runId, status: "completed" };
const approval: Partial<OrchestrationV2ThreadShell> = {
  pendingRuntimeRequest: {
    id: RuntimeRequestId.make("request-1"),
    kind: "command",
    createdAt: v2Now,
  },
};

function pr(
  snapshot: Partial<ThreadPullRequestSnapshot> | null,
  source: ThreadPullRequestLink["source"] = "agent",
): Partial<OrchestrationV2ThreadShell> {
  return {
    pullRequests: [
      {
        host: "github.com",
        repository: "acme/app",
        number: 7,
        url: "https://github.com/acme/app/pull/7",
        source,
        linkedAt: "2026-06-20T00:00:00.000Z",
        stack: null,
        snapshot:
          snapshot === null
            ? null
            : {
                state: "open",
                title: "Change",
                headBranch: "feature",
                baseBranch: "main",
                isDraft: false,
                updatedAt: null,
                syncedAt: "2026-06-20T00:00:00.000Z",
                ...snapshot,
              },
      },
    ],
  };
}

function child(
  overrides: Partial<OrchestrationV2ThreadShell> = {},
  pendingSubagentRequest: PendingSubagentRequest | null = null,
) {
  return presentThreadShell(
    environmentId,
    {
      ...v2ThreadShell,
      ...completed,
      lineage: {
        rootThreadId: parentId,
        parentThreadId: parentId,
        relationshipToParent: "subagent",
      },
      creationSource: "mcp",
      ...overrides,
    },
    pendingSubagentRequest,
  );
}

describe("threadOverviewGroupOf", () => {
  const rows: ReadonlyArray<[string, ReturnType<typeof child>, ThreadOverviewGroup]> = [
    ["settled", child({ settledOverride: "settled" }), "resolved"],
    ["pending approval", child(approval), "waiting_on_you"],
    [
      "pending user input",
      child({ pendingRuntimeRequest: { ...approval.pendingRuntimeRequest!, kind: "user_input" } }),
      "waiting_on_you",
    ],
    ["failed run", child({ status: "failed" }), "waiting_on_you"],
    ["its own subagent awaits approval", child({}, "approval"), "waiting_on_you"],
    ["running", child(running), "working"],
    [
      "approved PR, checks passing",
      child(pr({ reviewDecision: "approved", checksState: "passing" })),
      "landing",
    ],
    [
      "open PR awaiting review",
      child(pr({ reviewDecision: "review-required" })),
      "ready_for_review",
    ],
    ["nothing pending", child(), "idle"],
    [
      "settled beats a running approval with an approved PR",
      child({
        ...running,
        ...approval,
        ...pr({ reviewDecision: "approved" }),
        settledOverride: "settled",
      }),
      "resolved",
    ],
    ["approval on a running thread", child({ ...running, ...approval }), "waiting_on_you"],
    [
      "running with an approved PR",
      child({ ...running, ...pr({ reviewDecision: "approved" }) }),
      "working",
    ],
    [
      "approved PR, checks failing",
      child(pr({ reviewDecision: "approved", checksState: "failing" })),
      "ready_for_review",
    ],
    ["approved draft PR", child(pr({ reviewDecision: "approved", isDraft: true })), "idle"],
    ["merged PR", child(pr({ state: "merged" })), "idle"],
    ["PR not synced yet", child(pr(null)), "idle"],
    ["dismissed stack PR", child(pr({}, "stack-dismissed")), "idle"],
  ];

  it.each(rows)("%s", (_label, thread, group) => {
    expect(threadOverviewGroupOf(thread)).toBe(group);
  });
});

describe("groupThreadOverview", () => {
  it("orders groups for display, drops empty ones, and lists newest activity first", () => {
    const at = (iso: string) => ({ updatedAt: DateTime.makeUnsafe(iso) });
    const older = child({
      id: ThreadId.make("older"),
      ...running,
      ...at("2026-06-20T01:00:00.000Z"),
    });
    const newer = child({
      id: ThreadId.make("newer"),
      ...running,
      ...at("2026-06-20T02:00:00.000Z"),
    });
    const waiting = child({ id: ThreadId.make("waiting"), ...approval });
    expect(
      groupThreadOverview([older, waiting, newer]).map(({ group, threads }) => [
        group,
        threads.map((thread) => thread.id),
      ]),
    ).toEqual([
      ["waiting_on_you", ["waiting"]],
      ["working", ["newer", "older"]],
    ]);
  });
});

describe("isThreadOverviewChild", () => {
  it("keeps delegated children and leaves out provider-native subagents and other threads", () => {
    const delegated = child().source;
    expect(isThreadOverviewChild(delegated, parentId)).toBe(true);
    expect(isThreadOverviewChild({ ...delegated, creationSource: "provider" }, parentId)).toBe(
      false,
    );
    expect(isThreadOverviewChild(delegated, ThreadId.make("other"))).toBe(false);
    expect(
      isThreadOverviewChild(
        { ...delegated, lineage: { ...delegated.lineage, relationshipToParent: "fork" } },
        parentId,
      ),
    ).toBe(false);
    expect(isThreadOverviewChild({ ...delegated, archivedAt: v2Now }, parentId)).toBe(false);
  });
});
