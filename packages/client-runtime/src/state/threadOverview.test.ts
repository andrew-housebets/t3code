import {
  EnvironmentId,
  MessageId,
  NodeId,
  RunId,
  RuntimeRequestId,
  type ProjectArtifact,
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
  threadOverviewArtifactCue,
  threadOverviewArtifactsChanged,
  threadOverviewGroupOf,
  threadOverviewArtifacts,
  threadNeedsYou,
  threadOverviewStatusLine,
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
    ["never ran", child({ latestRunId: null, status: "idle" }), "idle"],
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

describe("threadNeedsYou", () => {
  const coordinator = (
    overrides: Partial<OrchestrationV2ThreadShell> = {},
    rollup: PendingSubagentRequest | null = null,
  ) =>
    presentThreadShell(
      environmentId,
      { ...v2ThreadShell, ...completed, id: parentId, ...overrides },
      rollup,
    );
  const visited = (iso: string) => ({ lastVisitedAt: DateTime.makeUnsafe(iso) });
  const rows: ReadonlyArray<
    [
      string,
      ReturnType<typeof coordinator> | null,
      ReadonlyArray<ReturnType<typeof child>>,
      boolean,
    ]
  > = [
    ["nothing to do", coordinator(visited("2026-06-21T00:00:00.000Z")), [child()], false],
    ["a child waits on you", coordinator(), [child(), child(approval)], true],
    ["a child's PR awaits review", null, [child(pr({}))], true],
    ["a child's PR is landing", null, [child(pr({ reviewDecision: "approved" }))], false],
    ["a child is working", null, [child(running)], false],
    ["the coordinator awaits approval", coordinator(approval), [], true],
    [
      "the coordinator carries a child's rolled-up question",
      coordinator({}, "user_input"),
      [],
      true,
    ],
    ["the coordinator's run failed", coordinator({ status: "failed" }), [], true],
    [
      "the coordinator finished after you looked",
      coordinator(visited("2026-06-19T00:00:00.000Z")),
      [],
      true,
    ],
    ["the coordinator was never opened", coordinator(), [], false],
    [
      "a resolved child's old question",
      null,
      [child({ ...approval, settledOverride: "settled" })],
      false,
    ],
  ];

  it.each(rows)("%s", (_label, thread, children, needsYou) => {
    expect(threadNeedsYou(thread, children)).toBe(needsYou);
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

describe("threadOverviewStatusLine", () => {
  const message = (role: "user" | "assistant", text: string) => ({
    latestVisibleMessage: { id: MessageId.make("message-1"), role, text, updatedAt: v2Now },
  });
  const agent = { progress: "Running the tests", result: null };
  const rows: ReadonlyArray<
    [
      string,
      ReturnType<typeof child>,
      Parameters<typeof threadOverviewStatusLine>[1],
      string | null,
    ]
  > = [
    [
      "a pending request beats an error and a PR",
      child({ ...approval, status: "failed", lastError: "Boom", ...pr({}) }),
      agent,
      "Waiting for you to approve a command",
    ],
    [
      "its own subagent's question",
      child({}, "user_input"),
      agent,
      "A subagent asked you a question",
    ],
    [
      "the first line of the error of a failed run",
      child({ status: "failed", lastError: "\nRate limited\nretry later", ...pr({}) }),
      agent,
      "Rate limited",
    ],
    [
      "a failed run's error over the task's closing note",
      child({ status: "failed", lastError: "Out of credits" }),
      { progress: "", result: "Child task ended with status failed." },
      "Out of credits",
    ],
    [
      "a run you stopped",
      child({ status: "interrupted", ...message("assistant", "Halfway through") }),
      { progress: "", result: "Child task ended with status interrupted." },
      "Stopped",
    ],
    [
      "a stale error on a run that did not fail",
      child({ lastError: "Old failure", ...message("assistant", "All done") }),
      undefined,
      "All done",
    ],
    [
      "a PR with checks beats subagent progress",
      child(pr({ checksState: "passing" })),
      agent,
      "PR #7 open, checks passing",
    ],
    ["an approved PR", child(pr({ reviewDecision: "approved" })), agent, "PR #7 open, approved"],
    ["a merged PR", child(pr({ state: "merged" })), agent, "PR #7 merged"],
    ["a PR not synced yet", child(pr(null)), agent, "Running the tests"],
    [
      "a subagent result beats its progress",
      child(),
      { progress: "Halfway", result: "Fixed the flaky test" },
      "Fixed the flaky test",
    ],
    [
      "the latest assistant message",
      child(message("assistant", "Pushed a fix")),
      undefined,
      "Pushed a fix",
    ],
    [
      "never the delegated task itself",
      child(message("user", "<project_context>\nUse pnpm")),
      undefined,
      null,
    ],
    [
      "bold, an arrow bullet and code",
      child(),
      { progress: "", result: "**→ Not done: the sandbox blocked `sleep 120`…**" },
      "Not done: the sandbox blocked sleep 120…",
    ],
    [
      "an absolute path cut to its file name",
      child(),
      {
        progress: "",
        result: "Saved to `/home/andrew/.t3/userdata/projects/p/library/binary-search.md`.",
      },
      "Saved to binary-search.md.",
    ],
    [
      "a heading and a rule before the text",
      child(),
      { progress: "", result: "---\n## Summary\nDone" },
      "Summary",
    ],
    [
      "a list marker and italics",
      child(),
      { progress: "", result: "- *Fixed* the `parse_args` helper in src/cli/*.ts" },
      "Fixed the parse_args helper in src/cli/*.ts",
    ],
    [
      "URLs, relative paths and identifiers as they are",
      child(),
      {
        progress: "",
        result: "Opened https://github.com/acme/app/pull/7 for apps/web/src/a.ts and __init__",
      },
      "Opened https://github.com/acme/app/pull/7 for apps/web/src/a.ts and __init__",
    ],
    [
      "a markdown link as its text",
      child(),
      { progress: "", result: "1. See [PR #7](https://github.com/acme/app/pull/7)  now" },
      "See PR #7 now",
    ],
    [
      "a Windows path",
      child(),
      { progress: "", result: "Wrote C:\\Users\\me\\notes\\report.md" },
      "Wrote report.md",
    ],
    [
      "a code fence skipped",
      child(),
      { progress: "", result: "```ts\nconst x = 1;" },
      "const x = 1;",
    ],
    ["nothing to show", child(), { progress: "  ", result: null }, null],
  ];

  it.each(rows)("%s", (_label, thread, subagent, line) => {
    expect(threadOverviewStatusLine(thread, subagent)).toBe(line);
  });
});

describe("threadOverviewArtifacts", () => {
  const artifact = (id: string, threadId: string | null): ProjectArtifact => ({
    id,
    source: "library",
    path: id,
    title: id,
    threadId: threadId === null ? null : ThreadId.make(threadId),
    sizeBytes: null,
    updatedAt: null,
  });

  it.each<[string, ReadonlyArray<ProjectArtifact>, ReadonlyArray<string>, Record<string, number>]>([
    ["nothing produced yet", [], [], {}],
    [
      "the newest three on the strip, every owned one counted",
      [
        artifact("e", "a"),
        artifact("d", null),
        artifact("c", "b"),
        artifact("b", "a"),
        artifact("a", "a"),
      ],
      ["e", "d", "c"],
      { a: 3, b: 1 },
    ],
  ])("%s", (_label, artifacts, strip, counts) => {
    const overview = threadOverviewArtifacts(artifacts);
    expect(overview.strip.map((entry) => entry.id)).toEqual(strip);
    expect(Object.fromEntries(overview.countByThread)).toEqual(counts);
  });
});

describe("threadOverviewArtifactsChanged", () => {
  const task = (status: "running" | "completed", updatedAt = "2026-06-20T00:00:00.000Z") => ({
    id: NodeId.make("task-1"),
    origin: "app_owned" as const,
    status,
    updatedAt: DateTime.makeUnsafe(updatedAt),
  });
  it.each([
    {
      name: "a child stops running",
      before: [[child(running)], []],
      after: [[child()], []],
      changed: true,
    },
    {
      name: "a child starts running",
      before: [[child()], []],
      after: [[child(running)], []],
      changed: false,
    },
    {
      name: "a task settles",
      before: [[], [task("running")]],
      after: [[], [task("completed")]],
      changed: true,
    },
    {
      name: "a settled task records again",
      before: [[], [task("completed")]],
      after: [[], [task("completed", "2026-06-20T00:01:00.000Z")]],
      changed: true,
    },
    {
      name: "nothing moves",
      before: [[child()], [task("completed")]],
      after: [[child()], [task("completed")]],
      changed: false,
    },
  ] as const)("re-reads artifacts when $name: $changed", ({ before, after, changed }) => {
    expect(
      threadOverviewArtifactsChanged(
        threadOverviewArtifactCue(before[0], before[1]),
        threadOverviewArtifactCue(after[0], after[1]),
      ),
    ).toBe(changed);
  });
});
