import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import * as ProjectSidecar from "./ProjectSidecar.ts";

const layerTest = ProjectSidecar.layer.pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-project-sidecar-" })),
  Layer.provideMerge(NodeServices.layer),
);

const owners = (rows: ReadonlyArray<ProjectSidecar.ProjectArtifactRow>) =>
  Object.fromEntries(rows.map((row) => [row.id, row.threadId]));

it.layer(layerTest, { excludeTestServices: true })("ProjectSidecar", (it) => {
  it.effect("keeps a finished turn's owner whether the listing saw the file first or after", () =>
    Effect.gen(function* () {
      const sidecar = yield* ProjectSidecar.ProjectSidecar;
      const written = (path: string) => ({
        projectId: "project-order",
        threadId: "thread-writer",
        source: "library" as const,
        path,
        title: path,
        sizeBytes: 10,
      });
      const listed = [{ path: "seen-first.md", sizeBytes: 10 }];

      yield* sidecar.syncLibraryFiles("project-order", listed, { complete: true });
      yield* sidecar.recordArtifacts([written("seen-first.md"), written("turn-first.md")]);
      yield* sidecar.syncLibraryFiles(
        "project-order",
        [...listed, { path: "turn-first.md", sizeBytes: 10 }, { path: "shell.md", sizeBytes: 3 }],
        { complete: true },
      );

      assert.deepEqual(owners(yield* sidecar.listArtifacts("project-order")), {
        "file:seen-first.md": "thread-writer",
        "file:turn-first.md": "thread-writer",
        "file:shell.md": null,
      });
    }),
  );

  it.effect("drops rows of deleted files only when the listing was complete", () =>
    Effect.gen(function* () {
      const sidecar = yield* ProjectSidecar.ProjectSidecar;
      yield* sidecar.recordArtifacts([
        {
          projectId: "project-gone",
          threadId: null,
          source: "upload",
          path: "upload.pdf",
          title: "upload.pdf",
          sizeBytes: 1,
        },
        {
          projectId: "project-gone",
          threadId: "thread-render",
          source: "html_render",
          path: "thread-render-0000",
          title: "Chart",
          sizeBytes: null,
        },
      ]);

      yield* sidecar.syncLibraryFiles("project-gone", [], { complete: false });
      assert.lengthOf(yield* sidecar.listArtifacts("project-gone"), 2);

      yield* sidecar.syncLibraryFiles("project-gone", [], { complete: true });
      assert.deepEqual(owners(yield* sidecar.listArtifacts("project-gone")), {
        "render:thread-render-0000": "thread-render",
      });
    }),
  );

  it.effect("prunes rows of missing projects and threads, but not rows written since", () =>
    Effect.gen(function* () {
      const sidecar = yield* ProjectSidecar.ProjectSidecar;
      const artifact = (projectId: string, threadId: string | null, path: string) => ({
        projectId,
        threadId,
        source: "library" as const,
        path,
        title: path,
        sizeBytes: null,
      });
      yield* sidecar.recordArtifacts([
        artifact("project-live", "thread-live", "kept.md"),
        artifact("project-live", null, "unowned.md"),
        artifact("project-live", "thread-deleted", "orphan.md"),
        artifact("project-deleted", "thread-live", "gone.md"),
      ]);

      const removedBefore = yield* sidecar.prune({
        projectIds: ["project-live"],
        threadIds: ["thread-live"],
        before: "1970-01-01T00:00:00.000Z",
      });
      assert.strictEqual(removedBefore, 0);

      yield* sidecar.prune({
        projectIds: ["project-live"],
        threadIds: ["thread-live"],
        before: "9999-01-01T00:00:00.000Z",
      });
      assert.deepEqual(owners(yield* sidecar.listArtifacts("project-live")), {
        "file:kept.md": "thread-live",
        "file:unowned.md": null,
      });
      assert.lengthOf(yield* sidecar.listArtifacts("project-deleted"), 0);
    }),
  );
});
