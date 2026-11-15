import {
  isProviderNativeSubagentThread,
  type OrchestrationV2ThreadShell,
  type ThreadId,
} from "@t3tools/contracts";
import { visibleThreadPullRequests } from "@t3tools/shared/threadPullRequests";
import { groupBy } from "effect/Array";

import type { EnvironmentThreadShell } from "./models.ts";
import { isThreadWorking } from "./threadInbox.ts";
import { toSortableTimestamp } from "./threadSort.ts";

const THREAD_OVERVIEW_GROUPS = [
  "waiting_on_you",
  "ready_for_review",
  "working",
  "landing",
  "idle",
  "resolved",
] as const;
export type ThreadOverviewGroup = (typeof THREAD_OVERVIEW_GROUPS)[number];

/** Threads a coordinator delegated with `delegate_task`; provider-native subagents are read-only. */
export function isThreadOverviewChild(
  thread: OrchestrationV2ThreadShell,
  parentThreadId: ThreadId,
): boolean {
  return (
    thread.lineage.parentThreadId === parentThreadId &&
    thread.lineage.relationshipToParent === "subagent" &&
    thread.lineage.sideChat !== true &&
    !isProviderNativeSubagentThread(thread) &&
    thread.archivedAt === null &&
    thread.deletedAt === null
  );
}

const openReadyPullRequests = (thread: EnvironmentThreadShell) =>
  visibleThreadPullRequests(thread.pullRequests).flatMap(({ snapshot }) =>
    snapshot?.state === "open" && !snapshot.isDraft ? [snapshot] : [],
  );

const RULES: ReadonlyArray<
  readonly [ThreadOverviewGroup, (thread: EnvironmentThreadShell) => boolean]
> = [
  ["resolved", (thread) => thread.settledOverride === "settled"],
  [
    "waiting_on_you",
    (thread) =>
      thread.hasPendingApprovals ||
      thread.hasPendingUserInput ||
      thread.pendingSubagentRequest !== null ||
      thread.latestRun?.status === "failed",
  ],
  ["working", isThreadWorking],
  [
    "landing",
    (thread) =>
      openReadyPullRequests(thread).some(
        (snapshot) => snapshot.reviewDecision === "approved" && snapshot.checksState !== "failing",
      ),
  ],
  ["ready_for_review", (thread) => openReadyPullRequests(thread).length > 0],
];

export function threadOverviewGroupOf(thread: EnvironmentThreadShell): ThreadOverviewGroup {
  return RULES.find(([, matches]) => matches(thread))?.[0] ?? "idle";
}

export function groupThreadOverview(
  children: ReadonlyArray<EnvironmentThreadShell>,
): ReadonlyArray<{
  readonly group: ThreadOverviewGroup;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
}> {
  const newestFirst = [...children].sort(
    (left, right) =>
      (toSortableTimestamp(right.updatedAt) ?? 0) - (toSortableTimestamp(left.updatedAt) ?? 0),
  );
  const byGroup: Partial<Record<ThreadOverviewGroup, ReadonlyArray<EnvironmentThreadShell>>> =
    groupBy(newestFirst, threadOverviewGroupOf);
  return THREAD_OVERVIEW_GROUPS.flatMap((group) => {
    const threads = byGroup[group];
    return threads === undefined ? [] : [{ group, threads }];
  });
}
