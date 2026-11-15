import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as ProjectContext from "./ProjectContext.ts";

const TASK = "Fix the flaky login test.";

const withContext = (files: { readonly instructions?: string; readonly memory?: string }) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const context = yield* ProjectContext.ProjectContext;
    const directory = yield* context.directory("project:mcp-1");
    yield* fileSystem.makeDirectory(directory, { recursive: true });
    if (files.instructions !== undefined) {
      yield* fileSystem.writeFileString(
        path.join(directory, "instructions.md"),
        files.instructions,
      );
    }
    if (files.memory !== undefined) {
      yield* fileSystem.writeFileString(path.join(directory, "MEMORY.md"), files.memory);
    }
    const task = yield* context.taskWithContext("project:mcp-1", TASK);
    const libraryDir = path.join(directory, "library");
    return { task, libraryDir, libraryExists: yield* fileSystem.exists(libraryDir) };
  });

const layerTest = ProjectContext.layer.pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-project-context-" })),
  Layer.provideMerge(NodeServices.layer),
);

it.layer(layerTest, { excludeTestServices: true })("ProjectContext", (it) => {
  it.effect.each([
    {
      name: "instructions and memory",
      files: { instructions: "End every file with ZEBRA-7.", memory: "- [auth](auth.md)" },
      includes: ["End every file with ZEBRA-7.", "- [auth](auth.md)"],
      excludes: [],
    },
    {
      name: "instructions only",
      files: { instructions: "End every file with ZEBRA-7.", memory: "  \n" },
      includes: ["End every file with ZEBRA-7."],
      excludes: ["## Memory index"],
    },
  ])("puts $name and the Library ahead of the task", ({ files, includes, excludes }) =>
    Effect.gen(function* () {
      const { task, libraryDir, libraryExists } = yield* withContext(files);
      for (const text of includes) assert.include(task, text);
      for (const text of excludes) assert.notInclude(task, text);
      assert.include(task, libraryDir);
      assert.isTrue(libraryExists);
      assert.isTrue(task.endsWith(`\n</project_context>\n\n---\n\n${TASK}`));
    }),
  );

  it.effect("passes a task through byte-identical when the project has no context", () =>
    Effect.gen(function* () {
      const context = yield* ProjectContext.ProjectContext;
      assert.strictEqual(yield* context.taskWithContext("project-without-context", TASK), TASK);
    }),
  );

  it.effect("caps oversize instructions", () =>
    Effect.gen(function* () {
      const instructions = `${"a".repeat(ProjectContext.PROJECT_CONTEXT_MAX_CHARS)}OVERFLOW`;
      const { task } = yield* withContext({ instructions });
      assert.include(task, "a".repeat(ProjectContext.PROJECT_CONTEXT_MAX_CHARS));
      assert.notInclude(task, "OVERFLOW");
    }),
  );

  it.effect.each(["..", ".", "a/b", "../escape", "", "a\\b", "a\u0000b"])(
    "rejects the project id %j as a path segment",
    (projectId) =>
      Effect.gen(function* () {
        const context = yield* ProjectContext.ProjectContext;
        const error = yield* context.taskWithContext(projectId, TASK).pipe(Effect.flip);
        assert.equal(error._tag, "ProjectContextPathError");
      }),
  );
});
