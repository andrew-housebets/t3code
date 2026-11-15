import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  COORDINATOR_THREAD_TAG,
  coordinatorProviderWarning,
  coordinatorToggleOf,
} from "@t3tools/shared/coordinatorThread";

import * as Dialog from "../../components/ui/Dialog";
import { appAtomRegistry } from "../../state/atom-registry";
import { threadEnvironment } from "../../state/threads";

const MAKE_COORDINATOR_ITEM = {
  id: "make-coordinator",
  title: "Make coordinator",
  image: "checklist",
};
const STOP_COORDINATING_ITEM = {
  id: "stop-coordinating",
  title: "Stop coordinating",
  image: "checklist",
};

/** The thread-menu item that makes a thread a coordinator or stops it; none for delegated children and side chats. */
export function coordinatorMenuItem(thread: EnvironmentThreadShell) {
  const toggle = coordinatorToggleOf(thread.source);
  if (toggle === undefined) return null;
  return toggle === "make" ? MAKE_COORDINATOR_ITEM : STOP_COORDINATING_ITEM;
}

async function setCoordinatorTag(thread: EnvironmentThreadShell, tagged: boolean) {
  const result = await runAtomCommand(
    appAtomRegistry,
    threadEnvironment.setTag,
    {
      environmentId: thread.environmentId,
      input: { threadId: thread.id, tag: COORDINATOR_THREAD_TAG, tagged },
    },
    { reportFailure: false },
  );
  if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
    const error = squashAtomCommandFailure(result);
    Dialog.alert(
      tagged ? "Could not make a coordinator" : "Could not stop coordinating",
      error instanceof Error ? error.message : undefined,
    );
  }
}

/** Stopping is immediate; making one first warns when the provider does not enforce the read-only lock. */
export function runCoordinatorMenuAction(
  thread: EnvironmentThreadShell,
  event: string,
  driver: string | null,
) {
  if (event === "stop-coordinating") return void setCoordinatorTag(thread, false);
  if (event !== "make-coordinator") return;
  const warning = coordinatorProviderWarning(driver);
  if (warning === null) return void setCoordinatorTag(thread, true);
  Dialog.confirm({
    title: "Make coordinator?",
    message: warning,
    confirmText: "Make coordinator",
    destructive: true,
    onConfirm: () => void setCoordinatorTag(thread, true),
  });
}
