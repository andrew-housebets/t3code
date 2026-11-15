import { useAtomValue } from "@effect/atom-react";
import {
  arrayElementsEqual,
  parseThreadKey,
  threadKey,
} from "@t3tools/client-runtime/state/entities";
import {
  toggleThreadOverviewGroup,
  type ThreadOverviewGroupCollapse,
} from "@t3tools/client-runtime/state/coordinator-ui";
import {
  presentThreadShell,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import {
  isThreadOverviewChild,
  threadNeedsYou,
  type ThreadOverviewGroup,
} from "@t3tools/client-runtime/state/thread-overview";
import type {
  EnvironmentId,
  OrchestrationV2ThreadShell,
  ProjectId,
  ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import { isCoordinatorThread } from "@t3tools/shared/coordinatorThread";
import { AsyncResult, Atom } from "effect/reactivity";
import { useEffect } from "react";

import { appAtomRegistry } from "../../state/atom-registry";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import {
  environmentThreadDetails,
  environmentThreadShells,
  threadFamilies,
} from "../../state/threads";

export type OverviewTab = "threads" | "library" | "scheduled";

export interface OverviewTarget {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId | null;
}

const EMPTY_CHILDREN: ReadonlyArray<EnvironmentThreadShell> = [];

const childrenAtomFamily = Atom.family((key: string) => {
  const ref = parseThreadKey(key);
  let previousSources: ReadonlyArray<OrchestrationV2ThreadShell> = [];
  let previousRequests: ReadonlyMap<unknown, unknown> | null = null;
  let previous = EMPTY_CHILDREN;
  return Atom.make((get) => {
    const requests = get(environmentThreadShells.pendingSubagentRequestsAtom(ref.environmentId));
    const sources = get(environmentThreadShells.environmentThreadsAtom(ref.environmentId)).filter(
      (thread) => isThreadOverviewChild(thread, ref.threadId),
    );
    if (requests === previousRequests && arrayElementsEqual(previousSources, sources)) {
      return previous;
    }
    previousSources = sources;
    previousRequests = requests;
    previous = sources.map((thread) =>
      presentThreadShell(ref.environmentId, thread, requests.get(thread.id) ?? null),
    );
    return previous;
  }).pipe(Atom.withLabel(`mobile-thread-overview-children:${key}`));
});

export function useThreadOverviewChildren(
  ref: ScopedThreadRef,
): ReadonlyArray<EnvironmentThreadShell> {
  return useAtomValue(childrenAtomFamily(threadKey(ref)));
}

/** The live shell drops idle delegated children, so the family is mounted while it is on screen. */
export function useMountedThreadFamily(ref: ScopedThreadRef | null) {
  const environmentId = ref?.environmentId ?? null;
  const threadId = ref?.threadId ?? null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps this thread's family in the shell rows while mounted, so idle children are listed
  useEffect(() => {
    if (environmentId === null || threadId === null) return;
    return threadFamilies.mount(appAtomRegistry, environmentId, threadId);
  }, [environmentId, threadId]);
}

export type ThreadOverviewEntryState = "hidden" | "shown" | "waiting";

const entryStateAtomFamily = Atom.family((key: string) =>
  Atom.make((get): ThreadOverviewEntryState => {
    const ref = parseThreadKey(key);
    const children = get(childrenAtomFamily(key));
    const thread = get(environmentThreadShells.quietThreadShellAtom(ref));
    const shown =
      children.length > 0 ||
      (thread !== null && isCoordinatorThread(thread.source)) ||
      (get(environmentThreadDetails.quietThreadAtom(ref))?.projection.subagents ?? []).some(
        (agent) => agent.origin === "app_owned" && agent.childThreadId !== null,
      );
    if (!shown) return "hidden";
    return threadNeedsYou(thread, children) ? "waiting" : "shown";
  }).pipe(Atom.withLabel(`mobile-thread-overview-entry:${key}`)),
);

/** Whether the thread's detail, and so its delegated tasks, has loaded. */
export function useThreadOverviewDetailLoaded(ref: ScopedThreadRef): boolean {
  return useAtomValue(environmentThreadDetails.quietThreadAtom(ref)) !== null;
}

const HIDDEN_ENTRY_ATOM = Atom.make<ThreadOverviewEntryState>("hidden").pipe(
  Atom.withLabel("mobile-thread-overview-entry:none"),
);

export function useThreadOverviewEntryState(ref: ScopedThreadRef | null): ThreadOverviewEntryState {
  return useAtomValue(ref === null ? HIDDEN_ENTRY_ATOM : entryStateAtomFamily(threadKey(ref)));
}

export function useThreadOverviewGroupCollapse(
  ref: ScopedThreadRef,
): ThreadOverviewGroupCollapse | undefined {
  const preferences = useAtomValue(mobilePreferencesAtom);
  return AsyncResult.isSuccess(preferences)
    ? preferences.value.overviewCollapsedGroups?.[threadKey(ref)]
    : undefined;
}

// ponytail: entries for deleted threads stay until preferences are cleared; prune by live thread keys if it grows.
export function toggleThreadOverviewGroupCollapse(
  ref: ScopedThreadRef,
  group: ThreadOverviewGroup,
) {
  const key = threadKey(ref);
  appAtomRegistry.set(updateMobilePreferencesAtom, {
    transform: (current) => ({
      overviewCollapsedGroups: {
        ...current.overviewCollapsedGroups,
        [key]: toggleThreadOverviewGroup(current.overviewCollapsedGroups?.[key], group),
      },
    }),
  });
}
