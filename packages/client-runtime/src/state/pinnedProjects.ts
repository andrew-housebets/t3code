import type { ScopedThreadRef } from "@t3tools/contracts";
import { isCoordinatorThread } from "@t3tools/shared/coordinatorThread";

import type { EnvironmentProject, EnvironmentThreadShell } from "./models.ts";
import { isThreadOverviewChild, threadNeedsYou } from "./threadOverview.ts";
import { toSortableTimestamp } from "./threadSort.ts";

type PinnableProject = Pick<EnvironmentProject, "environmentId" | "id" | "pinnedAt" | "archivedAt">;

export interface PinnedProject<TGroup> {
  readonly group: TGroup;
  /** The project's most recently updated coordinator, which opening the project goes to. */
  readonly coordinator: ScopedThreadRef | null;
  /** One of the project's coordinators needs you, by `threadNeedsYou`. */
  readonly needsYou: boolean;
}

const refKey = (environmentId: string, id: string) => `${environmentId}\0${id}`;

/**
 * Pinned, unarchived project groups, newest pin first. Children absent from `threads`
 * still count through their coordinator's rolled-up request.
 */
export function pinnedProjects<TGroup>(
  groups: ReadonlyArray<TGroup>,
  membersOf: (group: TGroup) => ReadonlyArray<PinnableProject>,
  threads: ReadonlyArray<EnvironmentThreadShell>,
): ReadonlyArray<PinnedProject<TGroup>> {
  const pinned = groups.flatMap((group) => {
    const members = membersOf(group);
    if (members.every((member) => member.archivedAt !== null)) return [];
    let pinnedAt: number | null = null;
    for (const member of members) {
      const at = member.pinnedAt === null ? null : (toSortableTimestamp(member.pinnedAt) ?? 0);
      if (at !== null && (pinnedAt === null || at > pinnedAt)) pinnedAt = at;
    }
    return pinnedAt === null ? [] : [{ group, members, pinnedAt }];
  });
  if (pinned.length === 0) return [];

  const entryByProject = new Map<string, number>();
  pinned.forEach((entry, index) => {
    for (const member of entry.members) {
      entryByProject.set(refKey(member.environmentId, member.id), index);
    }
  });
  const latest: Array<EnvironmentThreadShell | undefined> = [];
  const coordinators: Array<readonly [index: number, coordinator: EnvironmentThreadShell]> = [];
  const childrenByParent = new Map<string, EnvironmentThreadShell[]>();
  for (const thread of threads) {
    const parentId = thread.source.lineage.parentThreadId;
    if (parentId !== null && isThreadOverviewChild(thread.source, parentId)) {
      const key = refKey(thread.environmentId, parentId);
      const siblings = childrenByParent.get(key);
      if (siblings === undefined) childrenByParent.set(key, [thread]);
      else siblings.push(thread);
    }
    if (thread.archivedAt !== null || !isCoordinatorThread(thread.source)) continue;
    const index = entryByProject.get(refKey(thread.environmentId, thread.projectId));
    if (index === undefined) continue;
    coordinators.push([index, thread]);
    const current = latest[index];
    if (
      current === undefined ||
      (toSortableTimestamp(thread.updatedAt) ?? 0) > (toSortableTimestamp(current.updatedAt) ?? 0)
    ) {
      latest[index] = thread;
    }
  }
  const needsYou = new Set(
    coordinators.flatMap(([index, coordinator]) =>
      threadNeedsYou(
        coordinator,
        childrenByParent.get(refKey(coordinator.environmentId, coordinator.id)) ?? [],
      )
        ? [index]
        : [],
    ),
  );

  return pinned
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => right.entry.pinnedAt - left.entry.pinnedAt)
    .map(({ entry, index }) => {
      const coordinator = latest[index];
      return {
        group: entry.group,
        coordinator:
          coordinator === undefined
            ? null
            : { environmentId: coordinator.environmentId, threadId: coordinator.id },
        needsYou: needsYou.has(index),
      };
    });
}
