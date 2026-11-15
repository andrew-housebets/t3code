import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  threadRuntimeIsActive,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { threadFamilyRead } from "@t3tools/client-runtime/state/threads";
import { isThreadOverviewGroupCollapsed } from "@t3tools/client-runtime/state/coordinator-ui";
import {
  groupThreadOverview,
  THREAD_OVERVIEW_GROUP_PRESENTATION,
  threadOverviewArtifactCue,
  threadOverviewArtifacts,
  threadOverviewArtifactsChanged,
  threadOverviewStatusLine,
  type ThreadOverviewGroup,
} from "@t3tools/client-runtime/state/thread-overview";
import { resolveThreadPullRequestBadge } from "@t3tools/client-runtime/thread-pull-requests";
import type { OrchestrationV2Subagent, ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  ChevronDownIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotDashedIcon,
  RotateCcwIcon,
  SquareIcon,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import { useThreadActions } from "../../hooks/useThreadActions";
import { useNowMinute } from "../../hooks/useNowMinute";
import { resolveThreadOpenRoute } from "../../lib/sideChatPane";
import { cn } from "../../lib/utils";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { environmentThreadDetails, threadEnvironment, threadFamilies } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { formatRelativeTime } from "../../timestampFormat";
import { threadRelationshipStatusLabel } from "../chat/ThreadRelationshipIcon";
import { PULL_REQUEST_STATE_PRESENTATION, PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { resolveThreadStatusPill } from "../Sidebar.logic";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useCoordinatorStore } from "./coordinatorStore";
import { ProjectArtifactsStrip } from "./ProjectArtifactsStrip";
import { openProjectArtifact, openProjectLibrary, useProjectArtifacts } from "./projectArtifacts";
import { useThreadOverviewChildren } from "./threadOverviewState";

type GroupPresentation = (typeof THREAD_OVERVIEW_GROUP_PRESENTATION)[ThreadOverviewGroup];

const GROUP_ICONS = {
  alert: CircleAlertIcon,
  "pull-request": PullRequestGlyph.pullRequest,
  "in-progress": CircleDotDashedIcon,
  idle: CircleDashedIcon,
  done: CircleCheckIcon,
} satisfies Record<GroupPresentation["icon"], LucideIcon>;

const GROUP_TONES = {
  warning: "text-warning",
  info: "text-info",
  success: "text-success",
  muted: "text-muted-foreground",
} satisfies Record<GroupPresentation["tone"], string>;

type RowAction = "resolve" | "reopen" | "stop";

const ROW_ACTIONS = {
  resolve: { label: "Mark resolved", Icon: CircleCheckIcon, failure: "Could not mark resolved" },
  reopen: { label: "Reopen", Icon: RotateCcwIcon, failure: "Could not reopen" },
  stop: { label: "Stop thread", Icon: SquareIcon, failure: "Could not stop the thread" },
} satisfies Record<
  RowAction,
  { readonly label: string; readonly Icon: LucideIcon; readonly failure: string }
>;

/** Settling refuses an active or blocked run, so a thread with a live run offers Stop instead. */
const rowActionsOf = (thread: EnvironmentThreadShell): ReadonlyArray<RowAction> =>
  thread.settledOverride === "settled"
    ? ["reopen"]
    : threadRuntimeIsActive(thread.runtime)
      ? ["stop"]
      : ["resolve"];

function PullRequestBadge({ thread }: { readonly thread: EnvironmentThreadShell }) {
  const badge = resolveThreadPullRequestBadge(thread.pullRequests);
  if (badge === null) return null;
  const presentation = PULL_REQUEST_STATE_PRESENTATION[badge.state];
  const count = badge.kind === "stack" ? badge.layers : badge.others + 1;
  return (
    <span
      aria-label={`${count} ${presentation.label.toLowerCase()} pull request${count === 1 ? "" : "s"}`}
      className={`inline-flex shrink-0 items-center gap-0.5 text-2xs tabular-nums ${presentation.toneClassName}`}
    >
      <presentation.Icon aria-hidden className="size-3" />
      {count > 1 ? count : null}
    </span>
  );
}

function OverviewRow(props: {
  readonly thread: EnvironmentThreadShell;
  readonly group: ThreadOverviewGroup;
  readonly subagent: OrchestrationV2Subagent | undefined;
  readonly nowMs: number;
  readonly artifactCount: number;
  readonly onOpen: () => void;
  readonly onOpenArtifacts: () => void;
  readonly onAction: (action: RowAction) => void;
}) {
  const { thread, group } = props;
  const { label, icon, tone } = THREAD_OVERVIEW_GROUP_PRESENTATION[group];
  const Icon = GROUP_ICONS[icon];
  const status = thread.source.activityRunStatus ?? thread.source.status;
  const line =
    threadOverviewStatusLine(thread, props.subagent) ??
    resolveThreadStatusPill({ thread })?.label ??
    threadRelationshipStatusLabel(status);
  const age = formatRelativeTime(thread.updatedAt, props.nowMs)?.value;
  return (
    <li
      data-thread-overview-row
      data-thread-overview-row-group={group}
      className="group/row relative"
    >
      <button
        type="button"
        onClick={props.onOpen}
        className="flex w-full min-w-0 items-start gap-2 rounded-md px-3 py-1.5 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
      >
        <Icon aria-label={label} className={cn("mt-0.5 size-3.5 shrink-0", GROUP_TONES[tone])} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
              {thread.title}
            </span>
            <PullRequestBadge thread={thread} />
            {age ? (
              <span className="shrink-0 text-2xs tabular-nums text-muted-foreground group-hover/row:invisible group-focus-within/row:invisible">
                {age}
              </span>
            ) : null}
          </span>
          <span
            data-thread-overview-row-status
            className={cn(
              "truncate text-xs",
              thread.latestRun?.status === "failed" ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {line}
          </span>
        </span>
      </button>
      {props.artifactCount > 0 ? (
        <Button
          size="xs"
          variant="ghost-muted"
          data-thread-overview-row-artifacts
          className="mb-1 ml-8"
          onClick={props.onOpenArtifacts}
        >
          {props.artifactCount} {props.artifactCount === 1 ? "artifact" : "artifacts"}
        </Button>
      ) : null}
      <span className="invisible absolute top-1 right-2 flex items-center gap-0.5 group-hover/row:visible group-focus-within/row:visible">
        {rowActionsOf(thread).map((action) => {
          const { label, Icon: ActionIcon } = ROW_ACTIONS[action];
          return (
            <Tooltip key={action}>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost-muted"
                    aria-label={`${label}: ${thread.title}`}
                    onClick={() => props.onAction(action)}
                  />
                }
              >
                <ActionIcon aria-hidden />
              </TooltipTrigger>
              <TooltipPopup side="top">{label}</TooltipPopup>
            </Tooltip>
          );
        })}
      </span>
    </li>
  );
}

function OverviewMessage(props: { readonly children: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      {props.children}
    </div>
  );
}

export function ThreadOverviewPanel({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const { environmentId, threadId } = threadRef;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps this thread's family in the shell rows while open, so idle children are listed
  useEffect(
    () => threadFamilies.mount(appAtomRegistry, environmentId, threadId),
    [environmentId, threadId],
  );
  const read = threadFamilyRead(useAtomValue(threadFamilies.familyAtom(environmentId, threadId)));
  const children = useThreadOverviewChildren(threadRef);
  const subagents = useAtomValue(environmentThreadDetails.quietThreadAtom(threadRef))?.projection
    .subagents;
  const threadKey = scopedThreadKey(threadRef);
  const collapsed = useCoordinatorStore((state) => state.collapsedGroups[threadKey]);
  const toggleGroup = useCoordinatorStore((state) => state.toggleGroup);
  const nowMs = Date.parse(`${useNowMinute()}Z`);
  const { settleThread, unsettleThread } = useThreadActions();
  const interruptTurn = useOrchestrationCommand(threadEnvironment.interruptTurn, {
    reportFailure: false,
  });
  const navigate = useNavigate();
  const groups = groupThreadOverview(children);
  const listing = useProjectArtifacts(threadRef);
  const refreshArtifacts = listing.refresh;
  const { runningChildren, settledTasks } = threadOverviewArtifactCue(children, subagents);
  const previous = useRef({ runningChildren, settledTasks });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- re-reads the server's artifact listing when a delegated thread stops or its task settles, the moments its files and renders are recorded
  useEffect(() => {
    const next = { runningChildren, settledTasks };
    if (threadOverviewArtifactsChanged(previous.current, next)) refreshArtifacts();
    previous.current = next;
  }, [runningChildren, settledTasks, refreshArtifacts]);
  const artifacts = threadOverviewArtifacts(listing.data?.artifacts ?? []);

  if (groups.length === 0) {
    if (read === "pending") {
      return (
        <OverviewMessage>
          <Spinner size="sm" />
        </OverviewMessage>
      );
    }
    if (read === "failed") {
      return (
        <OverviewMessage>
          <p className="text-xs text-muted-foreground">Could not load delegated threads.</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => threadFamilies.refresh(appAtomRegistry, environmentId, threadId)}
          >
            Retry
          </Button>
        </OverviewMessage>
      );
    }
    return (
      <OverviewMessage>
        <p className="max-w-60 text-xs text-muted-foreground">
          Threads this thread starts will appear here.
        </p>
      </OverviewMessage>
    );
  }

  const subagentByChild = new Map(
    (subagents ?? []).flatMap((agent) =>
      agent.origin === "app_owned" && agent.childThreadId !== null
        ? [[agent.childThreadId, agent] as const]
        : [],
    ),
  );

  const openThread = (thread: EnvironmentThreadShell) => {
    const routeRef = resolveThreadOpenRoute(
      scopeThreadRef(environmentId, thread.id),
      thread.source,
    );
    void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(routeRef) });
  };

  // A delegated child stops through its parent's task node, as the relationships control does.
  const stopTarget = (thread: EnvironmentThreadShell) => {
    const agent = subagentByChild.get(thread.id);
    return agent === undefined
      ? { threadId: thread.id }
      : { threadId: agent.threadId, subagentId: agent.id };
  };

  const runAction = async (thread: EnvironmentThreadShell, action: RowAction) => {
    const ref = scopeThreadRef(environmentId, thread.id);
    const result: AtomCommandResult<unknown, unknown> =
      action === "resolve"
        ? await settleThread(ref)
        : action === "reopen"
          ? await unsettleThread(ref)
          : await interruptTurn({ environmentId, input: stopTarget(thread) });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: ROW_ACTIONS[action].failure,
          description: error instanceof Error ? error.message : undefined,
        }),
      );
    }
  };

  return (
    <div data-thread-overview className="h-full min-h-0 overflow-y-auto overscroll-contain py-1">
      {listing.data !== null && artifacts.strip.length > 0 ? (
        <ProjectArtifactsStrip
          artifacts={artifacts.strip}
          nowMs={nowMs}
          onOpen={(artifact) =>
            listing.data && openProjectArtifact(threadRef, listing.data.library.path, artifact)
          }
          onViewAll={() => openProjectLibrary(threadRef, null)}
        />
      ) : null}
      {groups.map(({ group, threads }) => {
        const folded = isThreadOverviewGroupCollapsed(collapsed, group);
        const headingId = `thread-overview-${threadKey}-${group}`;
        return (
          <section key={group} data-thread-overview-group={group} aria-labelledby={headingId}>
            <h3 id={headingId} className="m-0">
              <button
                type="button"
                aria-expanded={!folded}
                onClick={() => toggleGroup(threadKey, group)}
                className="flex w-full items-center gap-1 px-3 py-1.5 text-left text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              >
                <span>
                  {THREAD_OVERVIEW_GROUP_PRESENTATION[group].label} ·{" "}
                  <span className="tabular-nums">{threads.length}</span>
                </span>
                <ChevronDownIcon
                  aria-hidden
                  className={cn("size-3.5 transition-transform", folded && "-rotate-90")}
                />
              </button>
            </h3>
            {folded ? null : (
              <ul className="m-0 list-none p-0">
                {threads.map((thread) => (
                  <OverviewRow
                    key={thread.id}
                    thread={thread}
                    group={group}
                    subagent={subagentByChild.get(thread.id)}
                    nowMs={nowMs}
                    artifactCount={artifacts.countByThread.get(thread.id) ?? 0}
                    onOpen={() => openThread(thread)}
                    onOpenArtifacts={() => openProjectLibrary(threadRef, thread.id)}
                    onAction={(action) => void runAction(thread, action)}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
