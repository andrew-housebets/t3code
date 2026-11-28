import type { OrchestrationV2TurnItem, RunId, ThreadId } from "@t3tools/contracts";
import { htmlRenderFromToolItem } from "@t3tools/shared/toolOutput";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { resolveAttachmentPathById, threadHtmlRenderAttachmentIds } from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectContext from "../projectContext/ProjectContext.ts";
import { isWithinRoot } from "../workspace/KnownWorkspaces.ts";
import * as ProjectSidecar from "./ProjectSidecar.ts";

/**
 * What a finished run certainly produced: files its write and edit tools reported inside the
 * project's Library, and HTML renders it published. Shell writes report no path, so those files
 * stay unattributed.
 */
export function runArtifacts(input: {
  readonly path: Path.Path;
  readonly threadId: string;
  readonly projectId: string;
  readonly libraryDir: string;
  readonly cwd: string | null;
  readonly items: ReadonlyArray<OrchestrationV2TurnItem>;
}): ReadonlyArray<Omit<ProjectSidecar.ProjectArtifactInput, "sizeBytes">> {
  const { path, libraryDir } = input;
  const byId = new Map<string, Omit<ProjectSidecar.ProjectArtifactInput, "sizeBytes">>();
  for (const item of input.items) {
    if (item.status !== "completed") continue;
    if (item.type === "file_change") {
      const targets =
        item.changes === undefined
          ? [item.fileName]
          : item.changes.flatMap((change) => (change.operation === "delete" ? [] : [change.path]));
      for (const target of targets) {
        if (!path.isAbsolute(target) && input.cwd === null) continue;
        const absolute = path.resolve(input.cwd ?? libraryDir, target);
        if (absolute === libraryDir || !isWithinRoot(path, absolute, libraryDir)) continue;
        const relative = path.relative(libraryDir, absolute).split(path.sep).join("/");
        byId.set(`file:${relative}`, {
          projectId: input.projectId,
          threadId: input.threadId,
          source: "library",
          path: relative,
          title: path.basename(relative),
        });
      }
    }
    if (item.type === "dynamic_tool") {
      const render = htmlRenderFromToolItem(item);
      if (render === undefined) continue;
      if (threadHtmlRenderAttachmentIds(input.threadId, [item]).length === 0) continue;
      byId.set(`render:${render.attachmentId}`, {
        projectId: input.projectId,
        threadId: input.threadId,
        source: "html_render",
        path: render.attachmentId,
        title: render.title,
      });
    }
  }
  return [...byId.values()];
}

/** Records a finished run's artifacts; a failure is logged and never fails the run. */
export class ProjectArtifactRecorder extends Context.Reference<{
  readonly recordRun: (input: {
    readonly threadId: ThreadId;
    readonly runId: RunId;
  }) => Effect.Effect<void>;
}>("t3/projectSidecar/ProjectArtifactRecorder", {
  defaultValue: () => ({ recordRun: () => Effect.void }),
}) {}

export const layer = Layer.effect(
  ProjectArtifactRecorder,
  Effect.gen(function* () {
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const projectContext = yield* ProjectContext.ProjectContext;
    const sidecar = yield* ProjectSidecar.ProjectSidecar;
    const config = yield* ServerConfig.ServerConfig;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const sizeOf = (filePath: string | null) =>
      filePath === null
        ? Effect.succeed(Option.none<number>())
        : fileSystem.stat(filePath).pipe(
            Effect.map((info) => Option.some(Number(info.size))),
            Effect.orElseSucceed(() => Option.none<number>()),
          );

    const recordRun = Effect.fn("ProjectArtifactRecorder.recordRun")(
      function* (input: { readonly threadId: ThreadId; readonly runId: RunId }) {
        const shell = yield* projections.getThreadShell(input.threadId);
        if (shell === null) return;
        const libraryDir = path.join(yield* projectContext.directory(shell.projectId), "library");
        if (!(yield* fileSystem.exists(libraryDir))) return;
        const { thread, turnItems } = yield* projections.getThreadRecords(
          input.threadId,
          ["turnItems"],
          { turnItemRunId: input.runId },
        );
        const found = runArtifacts({
          path,
          threadId: thread.id,
          projectId: thread.projectId,
          libraryDir,
          cwd: thread.worktreePath,
          items: turnItems,
        });
        // A file the run wrote and then removed is not an artifact.
        const present = yield* Effect.forEach(found, (artifact) =>
          sizeOf(
            artifact.source === "html_render"
              ? resolveAttachmentPathById({
                  attachmentsDir: config.attachmentsDir,
                  attachmentId: artifact.path,
                })
              : path.join(libraryDir, artifact.path),
          ).pipe(Effect.map(Option.map((sizeBytes) => ({ ...artifact, sizeBytes })))),
        );
        yield* sidecar.recordArtifacts(present.flatMap(Option.toArray));
      },
      Effect.catch((cause) =>
        Effect.logWarning("Failed to record a run's project artifacts.", { cause }),
      ),
      Effect.catchDefect((cause) =>
        Effect.logWarning("Failed to record a run's project artifacts.", { cause }),
      ),
    );

    return { recordRun };
  }),
);
