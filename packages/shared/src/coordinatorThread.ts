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

export type CoordinatorLock = "enforced" | "partial" | "unsupported";

/** How far each provider driver honours a coordinator's read-only runtime policy. */
export const COORDINATOR_LOCK_BY_DRIVER: Readonly<Record<string, CoordinatorLock>> = {
  claudeAgent: "enforced",
  // Codex's own readOnly sandbox and approval policy; not yet proven live for coordinators.
  codex: "enforced",
  // Its permission rules deny bash, but allow edits when the stored mode is auto-accept-edits.
  opencode: "partial",
  // Write and run requests the agent asks permission for are refused; it is not sandboxed.
  grok: "partial",
  fx: "partial",
  kiro: "partial",
  acpRegistry: "partial",
  // Its sandbox still allows writes inside the workspace, which is the main checkout.
  cursor: "unsupported",
  // Their modes follow the thread's stored runtime mode, not the coordinator's policy.
  antigravity: "unsupported",
  pi: "unsupported",
  muse: "unsupported",
};

export const COORDINATOR_UNLOCKED_WARNING =
  "This provider is not locked read-only as a coordinator. It can change files in the main checkout.";

/** The warning for a coordinator on a known provider that does not enforce the lock. */
export function coordinatorProviderWarning(driver: string | null | undefined): string | null {
  if (driver == null) return null;
  return (COORDINATOR_LOCK_BY_DRIVER[driver] ?? "unsupported") === "enforced"
    ? null
    : COORDINATOR_UNLOCKED_WARNING;
}
