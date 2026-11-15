import { useAtomValue } from "@effect/atom-react";
import {
  arrayElementsEqual,
  parseThreadKey,
  threadKey,
} from "@t3tools/client-runtime/state/entities";
import {
  presentThreadShell,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import {
  isThreadOverviewChild,
  threadOverviewGroupOf,
} from "@t3tools/client-runtime/state/thread-overview";
import type { OrchestrationV2ThreadShell, ScopedThreadRef } from "@t3tools/contracts";
import { isCoordinatorThread } from "@t3tools/shared/coordinatorThread";
import { Atom } from "effect/reactivity";

import { environmentThreadDetails, environmentThreadShells } from "../../state/threads";

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
  }).pipe(Atom.withLabel(`web-thread-overview-children:${key}`));
});

/** Shell rows only; the panel mounts the thread's family so idle children join them. */
export function useThreadOverviewChildren(
  ref: ScopedThreadRef,
): ReadonlyArray<EnvironmentThreadShell> {
  return useAtomValue(childrenAtomFamily(threadKey(ref)));
}

const coordinatorAtomFamily = Atom.family((key: string) => {
  const ref = parseThreadKey(key);
  return Atom.make((get) => {
    const thread = get(environmentThreadShells.environmentThreadIndexAtom(ref.environmentId)).get(
      ref.threadId,
    );
    return thread !== undefined && isCoordinatorThread(thread);
  }).pipe(Atom.withLabel(`web-thread-coordinator:${key}`));
});

export function useIsCoordinatorThread(ref: ScopedThreadRef): boolean {
  return useAtomValue(coordinatorAtomFamily(threadKey(ref)));
}

export type ThreadOverviewHeaderState = "hidden" | "shown" | "waiting";

const headerStateAtomFamily = Atom.family((key: string) =>
  Atom.make((get): ThreadOverviewHeaderState => {
    const children = get(childrenAtomFamily(key));
    if (children.some((thread) => threadOverviewGroupOf(thread) === "waiting_on_you")) {
      return "waiting";
    }
    if (children.length > 0 || get(coordinatorAtomFamily(key))) return "shown";
    const subagents =
      get(environmentThreadDetails.quietThreadAtom(parseThreadKey(key)))?.projection.subagents ??
      [];
    return subagents.some((agent) => agent.origin === "app_owned" && agent.childThreadId !== null)
      ? "shown"
      : "hidden";
  }).pipe(Atom.withLabel(`web-thread-overview-header:${key}`)),
);

export function useThreadOverviewHeaderState(ref: ScopedThreadRef): ThreadOverviewHeaderState {
  return useAtomValue(headerStateAtomFamily(threadKey(ref)));
}
