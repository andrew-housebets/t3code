import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import type { ThreadId } from "@t3tools/contracts";
import { isCoordinatorThread } from "@t3tools/shared/coordinatorThread";

interface DrawerThread {
  readonly environmentId: EnvironmentProject["environmentId"];
  readonly id: ThreadId;
  readonly projectId: EnvironmentProject["id"];
  readonly updatedAt: string;
  readonly source: { readonly tags?: ReadonlyArray<string> | undefined };
}

export interface DrawerPinnedProject {
  readonly project: EnvironmentProject;
  /** The project's most recently updated coordinator, which tapping the project opens. */
  readonly coordinatorThreadId: ThreadId | null;
}

/** Pinned projects, most recently pinned first, each with the coordinator it opens to. */
export function drawerPinnedProjects(
  projects: ReadonlyArray<EnvironmentProject>,
  threads: ReadonlyArray<DrawerThread>,
): ReadonlyArray<DrawerPinnedProject> {
  const latestCoordinator = new Map<string, DrawerThread>();
  for (const thread of threads) {
    if (!isCoordinatorThread(thread.source)) continue;
    const key = `${thread.environmentId}:${thread.projectId}`;
    const current = latestCoordinator.get(key);
    if (current === undefined || Date.parse(thread.updatedAt) > Date.parse(current.updatedAt)) {
      latestCoordinator.set(key, thread);
    }
  }
  return projects
    .flatMap((project) =>
      project.pinnedAt == null ? [] : [{ project, pinnedAt: Date.parse(project.pinnedAt) }],
    )
    .sort((left, right) => right.pinnedAt - left.pinnedAt)
    .map(({ project }) => ({
      project,
      coordinatorThreadId:
        latestCoordinator.get(`${project.environmentId}:${project.id}`)?.id ?? null,
    }));
}

/** Where the Recents label goes: before the first row that is not a pinned thread. */
export function drawerRecentsIndex(
  items: ReadonlyArray<{
    readonly type: string;
    readonly item?: { readonly pinned?: boolean };
  }>,
): number | null {
  const index = items.findIndex((item) => !(item.type === "v2-thread" && item.item?.pinned));
  return index < 0 ? null : index;
}
