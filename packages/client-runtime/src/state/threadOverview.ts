import {
  isProviderNativeSubagentThread,
  type OrchestrationV2PendingRuntimeRequestSummary,
  type OrchestrationV2Subagent,
  type OrchestrationV2ThreadShell,
  type ProjectArtifact,
  type ThreadId,
  type ThreadPullRequestSnapshot,
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

/** What each client draws for a group; it maps the icon and tone to its own glyphs and colours. */
export const THREAD_OVERVIEW_GROUP_PRESENTATION = {
  waiting_on_you: { label: "Waiting on you", icon: "alert", tone: "warning" },
  ready_for_review: { label: "Ready for review", icon: "pull-request", tone: "info" },
  working: { label: "Working", icon: "in-progress", tone: "info" },
  landing: { label: "Landing", icon: "pull-request", tone: "success" },
  idle: { label: "Idle", icon: "idle", tone: "muted" },
  resolved: { label: "Resolved", icon: "done", tone: "muted" },
} as const satisfies Record<
  ThreadOverviewGroup,
  {
    readonly label: string;
    readonly icon: "alert" | "pull-request" | "in-progress" | "idle" | "done";
    readonly tone: "warning" | "info" | "success" | "muted";
  }
>;

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

const REQUEST_LINES = {
  command: "Waiting for you to approve a command",
  "file-read": "Waiting for you to approve a file read",
  "file-change": "Waiting for you to approve a file change",
  permission: "Waiting for your permission",
  "mcp-elicitation": "A tool is asking you for input",
  dynamic_tool_call: "Waiting for you to approve a tool call",
  user_input: "Asked you a question",
  auth_refresh: "Needs you to sign in again",
} satisfies Record<OrchestrationV2PendingRuntimeRequestSummary["kind"], string>;

const LEADING_MARKER = /^(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+|\[[ xX]\]\s+|(?:->|=>|[→•▸►⇒➜])\s*)/;
const UNIX_ABSOLUTE_PATH = /(?<![\w:/.~])~?\/(?:[^\s/]+\/)+([^\s/]+)/g;
const WINDOWS_ABSOLUTE_PATH = /\b[A-Za-z]:\\(?:[^\s\\]+\\)+([^\s\\]+)/g;

/** Markdown and long paths read as noise in a one-line status; URLs and identifiers stay intact. */
function plainLine(line: string): string {
  if (line.trimStart().startsWith("```")) return "";
  let text = line
    .replace(/\[([^\]\n]+)\]\([^)\s]+\)/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(?<![\w*])\*(?=\S)([^*\n]*[^\s*])\*(?![\w*])/g, "$1")
    .replace(/(?<!\w)_(?=\S)([^_\n]*[^\s_])_(?!\w)/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(UNIX_ABSOLUTE_PATH, "$1")
    .replace(WINDOWS_ABSOLUTE_PATH, "$1")
    .replace(/\s+/g, " ")
    .trim();
  for (let stripped = text.replace(LEADING_MARKER, ""); stripped !== text;) {
    text = stripped;
    stripped = text.replace(LEADING_MARKER, "");
  }
  return text.replace(/^[*_`~|=-]+$/, "");
}

const firstLine = (text: string | null | undefined) =>
  text
    ?.split(/\r?\n/)
    .map(plainLine)
    .find((line) => line !== "") ?? null;

function pullRequestLine(number: number, snapshot: ThreadPullRequestSnapshot): string {
  if (snapshot.state !== "open") return `PR #${number} ${snapshot.state}`;
  if (snapshot.isDraft) return `PR #${number} draft`;
  const parts = [`PR #${number} open`];
  if (snapshot.reviewDecision === "approved") parts.push("approved");
  if (snapshot.checksState) parts.push(`checks ${snapshot.checksState}`);
  return parts.join(", ");
}

/**
 * One line of what a delegated thread last did, from data already on the client.
 * Null when nothing has content; the row then shows its status label.
 */
export function threadOverviewStatusLine(
  thread: EnvironmentThreadShell,
  subagent?: Pick<OrchestrationV2Subagent, "progress" | "result"> | undefined,
): string | null {
  const request = thread.source.pendingRuntimeRequest;
  if (request !== null) return REQUEST_LINES[request.kind];
  if (thread.hasPendingUserInput) return REQUEST_LINES.user_input;
  if (thread.hasPendingApprovals) return "Waiting for your approval";
  if (thread.pendingSubagentRequest === "approval")
    return "A subagent is waiting for your approval";
  if (thread.pendingSubagentRequest === "user_input") return "A subagent asked you a question";
  if (thread.latestRun?.status === "failed") {
    const error = firstLine(thread.source.lastError);
    if (error !== null) return error;
  }
  const link = visibleThreadPullRequests(thread.pullRequests).find(
    (candidate) => candidate.snapshot !== null,
  );
  if (link?.snapshot) return pullRequestLine(link.number, link.snapshot);
  const latest = thread.source.latestVisibleMessage;
  return (
    firstLine(subagent?.result) ??
    firstLine(subagent?.progress) ??
    (latest?.role === "assistant" ? firstLine(latest.text) : null)
  );
}

const ARTIFACT_STRIP_TILES = 3;

/** The strip's newest artifacts and each thread's artifact count, from one listing (newest first). */
export function threadOverviewArtifacts(artifacts: ReadonlyArray<ProjectArtifact>): {
  readonly strip: ReadonlyArray<ProjectArtifact>;
  readonly countByThread: ReadonlyMap<ThreadId, number>;
} {
  const countByThread = new Map<ThreadId, number>();
  for (const { threadId } of artifacts) {
    if (threadId !== null) countByThread.set(threadId, (countByThread.get(threadId) ?? 0) + 1);
  }
  return { strip: artifacts.slice(0, ARTIFACT_STRIP_TILES), countByThread };
}
