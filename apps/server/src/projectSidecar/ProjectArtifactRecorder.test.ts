import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { type OrchestrationV2TurnItem, RunId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { createAttachmentId } from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import { liveThreadShell } from "../mcp/McpToolAccess.testkit.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectContext from "../projectContext/ProjectContext.ts";
import * as ProjectArtifactRecorder from "./ProjectArtifactRecorder.ts";
import { runArtifacts } from "./ProjectArtifactRecorder.ts";
import * as ProjectSidecar from "./ProjectSidecar.ts";

const THREAD = "thread-writer";
const LIBRARY = "/state/projects/p1/library";
const render = createAttachmentId(THREAD) ?? "";
const otherRender = createAttachmentId("thread-forked-from") ?? "";

const item = (fields: object) =>
  ({ status: "completed", ...fields }) as unknown as OrchestrationV2TurnItem;
const written = (fileName: string, changes?: ReadonlyArray<object>) =>
  item({ type: "file_change", fileName, ...(changes === undefined ? {} : { changes }) });
const rendered = (attachmentId: string) =>
  item({
    type: "dynamic_tool",
    toolName: "mcp__t3-code__html_render",
    output: { htmlRender: { attachmentId, title: "Chart", height: 400 } },
  });

it.layer(NodePath.layer)("runArtifacts", (it) => {
  it.effect.each<
    [string, ReadonlyArray<OrchestrationV2TurnItem>, string | null, ReadonlyArray<string>]
  >([
    ["a Write into the Library", [written(`${LIBRARY}/report.md`)], null, ["file:report.md"]],
    ["a nested file", [written(`${LIBRARY}/notes/a.md`)], null, ["file:notes/a.md"]],
    ["a write outside the Library", [written("/repo/src/a.ts")], null, []],
    ["a sibling folder sharing the prefix", [written(`${LIBRARY}-old/a.md`)], null, []],
    ["an escape through ..", [written(`${LIBRARY}/../MEMORY.md`)], null, []],
    ["a relative path without a checkout", [written("report.md")], null, []],
    [
      "a relative path from the checkout",
      [written("../library/r.md")],
      "/state/projects/p1/x",
      ["file:r.md"],
    ],
    [
      "Codex changes, skipping a delete",
      [
        written(`${LIBRARY}/a.md`, [
          { operation: "add", path: `${LIBRARY}/b.md` },
          { operation: "delete", path: `${LIBRARY}/a.md` },
        ]),
      ],
      null,
      ["file:b.md"],
    ],
    [
      "a failed write",
      [item({ type: "file_change", fileName: `${LIBRARY}/x.md`, status: "failed" })],
      null,
      [],
    ],
    ["this thread's render", [rendered(render)], null, [`render:${render}`]],
    ["a render the fork copied from its source", [rendered(otherRender)], null, []],
  ])("%s", ([_label, items, cwd, ids]) =>
    Effect.gen(function* () {
      const found = runArtifacts({
        path: yield* Path.Path,
        threadId: THREAD,
        projectId: "p1",
        libraryDir: LIBRARY,
        cwd,
        items,
      });
      expect(
        found.map(
          (artifact) => `${artifact.source === "html_render" ? "render" : "file"}:${artifact.path}`,
        ),
      ).toEqual(ids);
      for (const artifact of found) expect(artifact.threadId).toBe(THREAD);
    }),
  );
});

describe("ProjectArtifactRecorder.recordRun", () => {
  const threadId = ThreadId.make("thread-recorder");
  const shell = liveThreadShell(threadId);
  type Setup = {
    readonly library: boolean;
    readonly thread?: "gone";
    readonly records?: "fail";
    readonly items?: ReadonlyArray<OrchestrationV2TurnItem>;
    readonly sidecar?: "fail";
  };
  const recordRun = (setup: Setup) =>
    Effect.gen(function* () {
      const calls: Array<string> = [];
      const projections = Layer.mock(ProjectionStore.ProjectionStoreV2)({
        getThreadShell: () => Effect.succeed(setup.thread === "gone" ? null : shell),
        getThreadRecords: () =>
          Effect.suspend(() => {
            calls.push("turnItems");
            return setup.records === "fail"
              ? Effect.fail(
                  new ProjectionStore.ProjectionStoreReadError({ threadId, cause: "unreadable" }),
                )
              : Effect.succeed({ thread: shell, turnItems: setup.items ?? [] } as never);
          }),
      });
      const sidecar = Layer.succeed(ProjectSidecar.ProjectSidecar, {
        ...ProjectSidecar.ProjectSidecar.defaultValue(),
        recordArtifacts: (artifacts) =>
          Effect.suspend(() => {
            calls.push(`record ${artifacts.length}`);
            return setup.sidecar === "fail"
              ? Effect.fail(
                  new ProjectSidecar.ProjectSidecarError({ operation: "record", cause: "locked" }),
                )
              : Effect.void;
          }),
      });
      const layer = ProjectArtifactRecorder.layer.pipe(
        Layer.provideMerge(ProjectContext.layer),
        Layer.provideMerge(projections),
        Layer.provideMerge(sidecar),
        Layer.provideMerge(
          ServerConfig.layerTest(process.cwd(), { prefix: "t3-artifact-recorder-" }),
        ),
        Layer.provideMerge(NodeServices.layer),
      );
      return yield* Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* (yield* ProjectContext.ProjectContext).directory(shell.projectId);
        const libraryDir = path.join(directory, "library");
        if (setup.library) {
          yield* fileSystem.makeDirectory(libraryDir, { recursive: true });
          yield* fileSystem.writeFileString(path.join(libraryDir, "report.md"), "# Report");
        }
        yield* (yield* ProjectArtifactRecorder.ProjectArtifactRecorder).recordRun({
          threadId,
          runId: RunId.make("run-recorder"),
        });
        return { calls, libraryExists: yield* fileSystem.exists(libraryDir) };
      }).pipe(Effect.provide(layer));
    });
  it.effect.each<[string, Setup, ReadonlyArray<string>]>([
    ["a project without a Library", { library: false }, []],
    ["a thread that is gone", { library: true, thread: "gone" }, []],
    ["unreadable turn items", { library: true, records: "fail" }, ["turnItems"]],
    [
      "a malformed turn item",
      { library: true, items: [item({ type: "file_change", fileName: 7, changes: "x" })] },
      ["turnItems"],
    ],
    [
      "a sidecar that cannot write",
      { library: true, sidecar: "fail", items: [] },
      ["turnItems", "record 0"],
    ],
  ])("finishes for %s", ([_label, setup, calls]) =>
    Effect.gen(function* () {
      const result = yield* recordRun(setup);
      expect(result.calls).toEqual(calls);
      expect(result.libraryExists).toBe(setup.library);
    }),
  );
});
