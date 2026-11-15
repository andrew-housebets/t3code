import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { threadFamilyRead } from "@t3tools/client-runtime/state/threads";
import {
  groupThreadOverview,
  type ThreadOverviewGroup,
} from "@t3tools/client-runtime/state/thread-overview";
import { resolveThreadPullRequestBadge } from "@t3tools/client-runtime/thread-pull-requests";
import type { ScopedThreadRef, ServerProvider } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { BotIcon } from "lucide-react";
import { useEffect, type ReactNode } from "react";

import { resolveThreadOpenRoute } from "../../lib/sideChatPane";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { useEnvironmentProviders } from "../../state/environments";
import { threadFamilies } from "../../state/threads";
import { buildThreadRouteParams } from "../../threadRoutes";
import { ThreadDetailsControl } from "../chat/ThreadDetailsControl";
import { ThreadDetailsSection } from "../chat/ThreadDetailsSection";
import {
  ThreadRelationshipIcon,
  threadRelationshipStatusLabel,
} from "../chat/ThreadRelationshipIcon";
import { PULL_REQUEST_STATE_PRESENTATION } from "../pullRequest/pullRequestIcons";
import { resolveThreadStatusPill } from "../Sidebar.logic";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { useThreadOverviewChildren } from "./threadOverviewState";

const GROUP_LABELS = {
  waiting_on_you: "Waiting on you",
  ready_for_review: "Ready for review",
  working: "Working",
  landing: "Landing",
  idle: "Idle",
  resolved: "Resolved",
} satisfies Record<ThreadOverviewGroup, string>;

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
  readonly provider: ServerProvider | undefined;
  readonly onOpen: () => void;
}) {
  const { thread } = props;
  const status = thread.source.activityRunStatus ?? thread.source.status;
  const failed = status === "failed";
  return (
    <li className="flex h-8 items-center">
      <ThreadDetailsControl size="sm" variant="ghost" part="row" onClick={props.onOpen}>
        <ThreadRelationshipIcon
          driver={props.provider?.driver}
          provider={props.provider}
          fallbackIcon={BotIcon}
          status={status}
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium leading-4 text-foreground/85">
          {thread.title}
        </span>
        <PullRequestBadge thread={thread} />
        <span
          className={`shrink-0 text-2xs ${failed ? "text-destructive" : "text-muted-foreground"}`}
        >
          {resolveThreadStatusPill({ thread })?.label ?? threadRelationshipStatusLabel(status)}
        </span>
      </ThreadDetailsControl>
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
  const providers = useEnvironmentProviders().get(environmentId);
  const navigate = useNavigate();
  const groups = groupThreadOverview(children);

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

  const openThread = (thread: EnvironmentThreadShell) => {
    const routeRef = resolveThreadOpenRoute(
      scopeThreadRef(environmentId, thread.id),
      thread.source,
    );
    void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(routeRef) });
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto overscroll-contain">
      {groups.map(({ group, threads }) => (
        <ThreadDetailsSection
          key={group}
          headingId={`thread-overview-${group}`}
          title={GROUP_LABELS[group]}
          actions={
            <span className="text-2xs tabular-nums text-muted-foreground">{threads.length}</span>
          }
        >
          <ul className="m-0 list-none p-0">
            {threads.map((thread) => (
              <OverviewRow
                key={thread.id}
                thread={thread}
                provider={providers?.find(
                  (entry) => entry.instanceId === thread.providerInstanceId,
                )}
                onOpen={() => openThread(thread)}
              />
            ))}
          </ul>
        </ThreadDetailsSection>
      ))}
    </div>
  );
}
