/** A thread tagged this way only reads and delegates; its delegated children do the work. */
export const COORDINATOR_THREAD_TAG = "coordinator";

export function isCoordinatorThread(thread: {
  readonly tags?: ReadonlyArray<string> | undefined;
}): boolean {
  return thread.tags?.includes(COORDINATOR_THREAD_TAG) === true;
}
