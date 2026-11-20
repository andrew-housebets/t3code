import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_SERVER_SETTINGS,
  type ScopedProjectRef,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { COORDINATOR_THREAD_TAG } from "@t3tools/shared/coordinatorThread";
import { msg } from "gt-react";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { useRef } from "react";

import { m } from "../../i18n/messages";
import { newThreadId } from "../../lib/utils";
import { resolveProjectDefaultProviderModelSelection } from "../../providerInstances";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { readProject } from "../../state/entities";
import { environmentServerConfigsAtom } from "../../state/server";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { readCoordinatorModelDefault } from "./projectModelDefaults.logic";

/**
 * Starts a project's coordinator as an empty thread, so opening a project lands on its
 * Overview. Resolves null when no thread was made and the caller should open a draft.
 */
export function useCreateProjectCoordinator() {
  const createThread = useOrchestrationCommand(threadEnvironment.create, { reportFailure: false });
  const setThreadTag = useOrchestrationCommand(threadEnvironment.setTag, { reportFailure: false });
  const inFlight = useRef(new Map<string, Promise<ScopedThreadRef | null>>());

  const create = async (projectRef: ScopedProjectRef): Promise<ScopedThreadRef | null> => {
    const { environmentId, projectId } = projectRef;
    const config = appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId);
    const serverSettings = config?.settings ?? DEFAULT_SERVER_SETTINGS;
    const project = readProject(projectRef);
    const { settings } = resolveProjectSettings(serverSettings, projectId, project ?? undefined);
    const modelSelection =
      (await readCoordinatorModelDefault(environmentId, projectId)) ??
      settings.defaultModelSelection ??
      resolveProjectDefaultProviderModelSelection(
        config?.providers ?? [],
        serverSettings,
        projectId,
      );
    if (modelSelection === null) return null;
    const threadId = newThreadId();
    const created = await createThread({
      environmentId,
      input: {
        threadId,
        projectId,
        // oxlint-disable-next-line t3code/no-untranslated-copy -- stored on the server as the thread title, shared by every viewer
        title: "Coordinator",
        modelSelection,
        runtimeMode: settings.defaultRuntimeMode,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        branch: null,
        worktreePath: null,
      },
    });
    if (created._tag === "Failure") return null;
    const tagged = await setThreadTag({
      environmentId,
      input: { threadId, tag: COORDINATOR_THREAD_TAG, tagged: true },
    });
    if (tagged._tag === "Failure") {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: m(msg("Thread started without the coordinator role")),
          description: m(msg("Choose Make coordinator from the thread menu to try again.")),
        }),
      );
    }
    return scopeThreadRef(environmentId, threadId);
  };

  return (projectRef: ScopedProjectRef) => {
    const key = `${projectRef.environmentId}:${projectRef.projectId}`;
    const pending = inFlight.current.get(key);
    if (pending !== undefined) return pending;
    const started = create(projectRef).finally(() => inFlight.current.delete(key));
    inFlight.current.set(key, started);
    return started;
  };
}
