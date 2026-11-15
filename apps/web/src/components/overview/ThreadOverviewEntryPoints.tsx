import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { BotIcon } from "lucide-react";

import { useRightPanelStore } from "../../rightPanelStore";
import { ITEM_ICON_CLASS, type CommandPaletteActionItem } from "../CommandPalette.logic";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useThreadOverviewHeaderState } from "./threadOverviewState";

const openOverview = (threadRef: ScopedThreadRef) =>
  useRightPanelStore.getState().open(threadRef, "overview");

export function threadOverviewPaletteItem(
  thread: Pick<EnvironmentThreadShell, "environmentId" | "id">,
): CommandPaletteActionItem {
  return {
    kind: "action",
    value: "action:open-thread-overview",
    searchTerms: ["overview", "threads", "delegated", "subagents", "coordinator"],
    title: "Show thread overview",
    icon: <BotIcon className={ITEM_ICON_CLASS} />,
    run: async () => openOverview(scopeThreadRef(thread.environmentId, thread.id)),
  };
}

export function ThreadOverviewHeaderButton({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const state = useThreadOverviewHeaderState(threadRef);
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
