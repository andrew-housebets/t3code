import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
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

import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ThreadId,
  type EnvironmentId,
  type ModelSelection,
  type ProjectId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";

import * as Dialog from "../../components/ui/Dialog";
import { uuidv4 } from "../../lib/uuid";
import { scheduledTaskDefaultModel } from "../settings/scheduledTaskDraft";
import { appAtomRegistry } from "../../state/atom-registry";
import { isCoordinatorDraft, setCoordinatorDraft } from "../../state/coordinator-drafts";
import { projectEnvironment } from "../../state/projects";
import { environmentServerConfigsAtom } from "../../state/server";
import { threadEnvironment } from "../../state/threads";
import { updateComposerDraftSettings } from "../../state/use-composer-drafts";

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

function readCoordinatorModelDefault(
  environmentId: EnvironmentId,
  projectId: ProjectId,
): Promise<ModelSelection | null> {
  return Effect.runPromise(
    AtomRegistry.getResult(
      appAtomRegistry,
      projectEnvironment.readModelDefaults({ environmentId, input: { projectId } }),
      { suspendOnWaiting: true },
    ).pipe(
      Effect.map((defaults) => defaults.coordinatorModelSelection),
      Effect.timeout("5 seconds"),
      Effect.orElseSucceed(() => null),
    ),
  );
}

/**
 * A draft turned into a coordinator moves to the project's coordinator model, then warns,
 * without blocking, when the provider it ends on does not enforce the read-only lock.
 */
export async function startCoordinatorDraft(input: {
  readonly draftKey: string;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly driver: string | null;
}) {
  setCoordinatorDraft(input.draftKey, true);
  const selection = await readCoordinatorModelDefault(input.environmentId, input.projectId);
  if (!isCoordinatorDraft(input.draftKey)) return;
  if (selection !== null) {
    updateComposerDraftSettings(input.draftKey, { modelSelection: selection });
  }
  const driver =
    selection === null
      ? input.driver
      : (appAtomRegistry
          .get(environmentServerConfigsAtom)
          .get(input.environmentId)
          ?.providers.find((provider) => provider.instanceId === selection.instanceId)?.driver ??
        input.driver);
  const warning = coordinatorProviderWarning(driver);
  if (warning !== null) Dialog.alert("Not read-only", warning);
}

const coordinatorsStarting = new Map<string, Promise<ScopedThreadRef | null>>();

async function createProjectCoordinator(
  project: EnvironmentProject,
): Promise<ScopedThreadRef | null> {
  const { environmentId, id: projectId } = project;
  const serverConfig = appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId);
  if (serverConfig === undefined) return null;
  const { settings } = resolveProjectSettings(serverConfig.settings, projectId, project);
  const modelSelection =
    (await readCoordinatorModelDefault(environmentId, projectId)) ??
    scheduledTaskDefaultModel(serverConfig, project);
  if (modelSelection === null) return null;
  const threadId = ThreadId.make(uuidv4());
  const created = await runAtomCommand(
    appAtomRegistry,
    threadEnvironment.create,
    {
      environmentId,
      input: {
        creationSource: "mobile",
        threadId,
        projectId,
        title: "Coordinator",
        modelSelection,
        runtimeMode: settings.defaultRuntimeMode,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        branch: null,
        worktreePath: null,
      },
    },
    { reportFailure: false },
  );
  if (created._tag === "Failure") return null;
  const tagged = await runAtomCommand(
    appAtomRegistry,
    threadEnvironment.setTag,
    { environmentId, input: { threadId, tag: COORDINATOR_THREAD_TAG, tagged: true } },
    { reportFailure: false },
  );
  if (tagged._tag === "Failure" && !isAtomCommandInterrupted(tagged)) {
    Dialog.alert(
      "Thread started without the coordinator role",
      "Choose Make coordinator from the thread menu to try again.",
    );
  }
  return { environmentId, threadId };
}

/**
 * Starts a project's coordinator as an empty thread, once per project at a time. Resolves
 * null when no thread was made, so the caller can fall back.
 */
export function startProjectCoordinator(
  project: EnvironmentProject,
): Promise<ScopedThreadRef | null> {
  const key = `${project.environmentId}:${project.id}`;
  const pending = coordinatorsStarting.get(key);
  if (pending !== undefined) return pending;
  const started = createProjectCoordinator(project).finally(() => coordinatorsStarting.delete(key));
  coordinatorsStarting.set(key, started);
  return started;
}
