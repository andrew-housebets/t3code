import type { EnvironmentId, ModelSelection, ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";

import { appAtomRegistry } from "../../rpc/atomRegistry";
import { projectEnvironment } from "../../state/projects";

/** The coordinator model a new coordinator draft in the project starts on, when one is set. */
export function readCoordinatorModelDefault(
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
