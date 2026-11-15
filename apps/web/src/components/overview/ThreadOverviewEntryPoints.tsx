import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { coordinatorToggleOf } from "@t3tools/shared/coordinatorThread";
import { BotIcon, NetworkIcon } from "lucide-react";
import { useEffect, type ReactNode } from "react";

import { useRightPanelStore } from "../../rightPanelStore";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { threadFamilies } from "../../state/threads";
import { ITEM_ICON_CLASS, type CommandPaletteActionItem } from "../CommandPalette.logic";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useCoordinatorStore } from "./coordinatorStore";
import { useIsCoordinatorThread, useThreadOverviewHeaderState } from "./threadOverviewState";

const openOverview = (threadRef: ScopedThreadRef) =>
  useRightPanelStore.getState().open(threadRef, "overview");

export function threadOverviewPaletteItem(
  thread: Pick<EnvironmentThreadShell, "environmentId" | "id">,
): CommandPaletteActionItem {
  return {
    kind: "action",
    value: "action:open-thread-overview",
    searchTerms: ["overview", "threads", "delegated", "subagents", "coordinator"],
    title: "Show threads",
    icon: <BotIcon className={ITEM_ICON_CLASS} />,
    run: async () => openOverview(scopeThreadRef(thread.environmentId, thread.id)),
  };
}

export function newCoordinatorPaletteItem(
  projectTitle: ReactNode,
  searchTitle: string,
  run: () => Promise<void>,
): CommandPaletteActionItem {
  return {
    kind: "action",
    value: "action:new-coordinator",
    searchTerms: ["new coordinator", "coordinate", "delegate", "orchestrate", "project"],
    title: <>New coordinator in {projectTitle}</>,
    searchTitle: `New coordinator in ${searchTitle}`,
    icon: <NetworkIcon className={ITEM_ICON_CLASS} />,
    run,
  };
}

export function coordinatorTogglePaletteItem(
  thread: Pick<EnvironmentThreadShell, "environmentId" | "id" | "source">,
  setCoordinator: (
    ref: ScopedThreadRef,
    coordinator: boolean,
  ) => Promise<AtomCommandResult<unknown, unknown>>,
): CommandPaletteActionItem | null {
  const toggle = coordinatorToggleOf(thread.source);
  if (toggle === undefined) return null;
  const make = toggle === "make";
  return {
    kind: "action",
    value: make ? "action:make-coordinator" : "action:stop-coordinating",
    searchTerms: ["coordinator", "coordinate", "delegate", "orchestrate"],
    title: make ? "Make coordinator" : "Stop coordinating",
    icon: <NetworkIcon className={ITEM_ICON_CLASS} />,
    run: async () => {
      const result = await setCoordinator(scopeThreadRef(thread.environmentId, thread.id), make);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to change coordinator",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    },
  };
}

export function ThreadOverviewHeaderButton({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const state = useThreadOverviewHeaderState(threadRef);
  const coordinator = useIsCoordinatorThread(threadRef);
  const { environmentId, threadId } = threadRef;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps a coordinator's whole thread family in the shell rows while it is open, so the list and dot are complete after a reload
  useEffect(() => {
    if (!coordinator) return;
    const ref = scopeThreadRef(environmentId, threadId);
    if (useCoordinatorStore.getState().claimFirstOverview(scopedThreadKey(ref))) {
      useRightPanelStore.getState().open(ref, "overview", true);
    }
    return threadFamilies.mount(appAtomRegistry, environmentId, threadId);
  }, [coordinator, environmentId, threadId]);
  if (state === "hidden") return null;
  const waiting = state === "waiting";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="xs"
            variant="ghost-muted"
            aria-label={waiting ? "Threads, some waiting on you" : "Threads"}
            onClick={() => openOverview(threadRef)}
          />
        }
      >
        <BotIcon aria-hidden />
        Threads
        {waiting ? <span aria-hidden className="size-1.5 rounded-full bg-warning" /> : null}
      </TooltipTrigger>
      <TooltipPopup side="top">
        {waiting ? "A thread this one started is waiting on you" : "Threads this thread started"}
      </TooltipPopup>
    </Tooltip>
  );
}
