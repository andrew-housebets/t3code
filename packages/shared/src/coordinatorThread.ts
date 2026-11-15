/** A thread tagged this way only reads and delegates; its delegated children do the work. */
export const COORDINATOR_THREAD_TAG = "coordinator";

export function isCoordinatorThread(thread: {
  readonly tags?: ReadonlyArray<string> | undefined;
}): boolean {
  return thread.tags?.includes(COORDINATOR_THREAD_TAG) === true;
}

/** Delegated children and side chats work for their parent, so they never coordinate. */
export function canCoordinate(thread: {
  readonly lineage: {
    readonly relationshipToParent?: string | null | undefined;
    readonly sideChat?: boolean | undefined;
  };
}): boolean {
  return thread.lineage.relationshipToParent !== "subagent" && thread.lineage.sideChat !== true;
}

export function coordinatorToggleOf(
  thread: Parameters<typeof canCoordinate>[0] & Parameters<typeof isCoordinatorThread>[0],
): "make" | "stop" | undefined {
  if (isCoordinatorThread(thread)) return "stop";
  return canCoordinate(thread) ? "make" : undefined;
}
