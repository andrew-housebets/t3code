import {
  EnvironmentId,
  ProjectId,
  RuntimeRequestId,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { presentThreadShell, type PendingSubagentRequest } from "./models.ts";
import { v2Now, v2ThreadShell } from "./orchestrationV2TestFixtures.ts";
import { pinnedProjects } from "./pinnedProjects.ts";

const local = EnvironmentId.make("local");
const remote = EnvironmentId.make("remote");

const project = (
  environmentId: EnvironmentId,
  id: string,
  pinnedAt: string | null,
  archivedAt: string | null = null,
) => ({ environmentId, id: ProjectId.make(id), pinnedAt, archivedAt });

function thread(
  id: string,
  projectId: string,
  options: {
    readonly environmentId?: EnvironmentId;
    readonly coordinator?: boolean;
    readonly updatedAt?: string;
    readonly parent?: string;
    readonly overrides?: Partial<OrchestrationV2ThreadShell>;
    readonly rollup?: PendingSubagentRequest;
  } = {},
) {
  return presentThreadShell(
    options.environmentId ?? local,
    {
      ...v2ThreadShell,
      id: ThreadId.make(id),
      projectId: ProjectId.make(projectId),
      tags: options.coordinator ? ["coordinator"] : [],
      updatedAt: options.updatedAt ? DateTime.makeUnsafe(options.updatedAt) : v2Now,
      ...(options.parent
        ? {
            lineage: {
              rootThreadId: ThreadId.make(options.parent),
              parentThreadId: ThreadId.make(options.parent),
              relationshipToParent: "subagent" as const,
            },
            creationSource: "mcp" as const,
          }
        : {}),
      ...options.overrides,
    },
    options.rollup ?? null,
  );
}

const approval: Partial<OrchestrationV2ThreadShell> = {
  pendingRuntimeRequest: {
    id: RuntimeRequestId.make("request-1"),
    kind: "command",
    createdAt: v2Now,
  },
};

const reviewable: Partial<OrchestrationV2ThreadShell> = {
  pullRequests: [
    {
      host: "github.com",
      repository: "acme/app",
      number: 7,
      url: "https://github.com/acme/app/pull/7",
      source: "agent",
      linkedAt: "2026-11-01T00:00:00.000Z",
      stack: null,
      snapshot: {
        state: "open",
        title: "Change",
        headBranch: "feature",
        baseBranch: "main",
        isDraft: false,
        updatedAt: null,
        syncedAt: "2026-11-01T00:00:00.000Z",
      },
    },
  ],
};

const groups = [
  { key: "older", members: [project(local, "older", "2026-11-01T00:00:00Z")] },
  { key: "unpinned", members: [project(local, "unpinned", null)] },
  {
    key: "archived",
    members: [project(local, "archived", "2026-11-12T00:00:00Z", "2026-11-13T00:00:00Z")],
  },
  {
    key: "two-checkouts",
    members: [project(local, "app", null), project(remote, "app", "2026-11-10T00:00:00Z")],
  },
];

const run = (threads: ReadonlyArray<ReturnType<typeof thread>>) =>
  pinnedProjects(groups, (group) => group.members, threads).map((entry) => [
    entry.group.key,
    entry.coordinator?.threadId ?? null,
    entry.needsYou,
  ]);

describe("pinnedProjects", () => {
  it("lists pinned, unarchived groups newest pin first, each opening its latest coordinator", () => {
    expect(
      run([
        thread("plain", "older", { updatedAt: "2026-11-14T00:00:00Z" }),
        thread("first", "older", { coordinator: true, updatedAt: "2026-11-12T00:00:00Z" }),
        thread("latest", "older", { coordinator: true, updatedAt: "2026-11-13T00:00:00Z" }),
        thread("gone", "older", {
          coordinator: true,
          updatedAt: "2026-11-15T00:00:00Z",
          overrides: { archivedAt: v2Now },
        }),
        thread("on-remote", "app", { environmentId: remote, coordinator: true }),
        thread("elsewhere", "unpinned", { coordinator: true }),
      ]),
    ).toEqual([
      ["two-checkouts", "on-remote", false],
      ["older", "latest", false],
    ]);
  });

  it.each([
    {
      name: "a delegated child awaits approval",
      threads: [
        thread("lead", "older", { coordinator: true }),
        thread("child", "older", { parent: "lead", overrides: approval }),
      ],
      waiting: true,
    },
    {
      name: "a delegated child's pull request awaits review",
      threads: [
        thread("lead", "older", { coordinator: true }),
        thread("child", "older", { parent: "lead", overrides: reviewable }),
      ],
      waiting: true,
    },
    {
      name: "the coordinator itself awaits approval",
      threads: [thread("lead", "older", { coordinator: true, overrides: approval })],
      waiting: true,
    },
    {
      name: "a delegated child is idle",
      threads: [
        thread("lead", "older", { coordinator: true }),
        thread("child", "older", { parent: "lead" }),
      ],
      waiting: false,
    },
    {
      name: "the coordinator carries a child's rolled-up approval",
      threads: [thread("lead", "older", { coordinator: true, rollup: "approval" })],
      waiting: true,
    },
    {
      name: "the waiting child's parent is not a coordinator",
      threads: [
        thread("lead", "older", { coordinator: true }),
        thread("plain", "older"),
        thread("child", "older", { parent: "plain", overrides: approval }),
      ],
      waiting: false,
    },
  ])("flags the project when $name: $waiting", ({ threads, waiting }) => {
    expect(run(threads).find(([key]) => key === "older")).toEqual(["older", "lead", waiting]);
  });
});
