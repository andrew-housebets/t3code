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

export type ThreadOverviewHeaderState = "hidden" | "children" | "waiting";

const headerStateAtomFamily = Atom.family((key: string) =>
  Atom.make((get): ThreadOverviewHeaderState => {
    const children = get(childrenAtomFamily(key));
    if (children.some((thread) => threadOverviewGroupOf(thread) === "waiting_on_you")) {
      return "waiting";
    }
    if (children.length > 0) return "children";
    const subagents =
      get(environmentThreadDetails.quietThreadAtom(parseThreadKey(key)))?.projection.subagents ??
      [];
    return subagents.some((agent) => agent.origin === "app_owned" && agent.childThreadId !== null)
      ? "children"
      : "hidden";
  }).pipe(Atom.withLabel(`web-thread-overview-header:${key}`)),
);

export function useThreadOverviewHeaderState(ref: ScopedThreadRef): ThreadOverviewHeaderState {
  return useAtomValue(headerStateAtomFamily(threadKey(ref)));
}
