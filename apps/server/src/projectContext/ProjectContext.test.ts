import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { PROJECT_CONTEXT_MAX_CHARS } from "@t3tools/contracts";
import { splitProjectContextBlock } from "@t3tools/shared/projectContextBlock";
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
      const split = splitProjectContextBlock(task);
      assert.strictEqual(split.task, TASK);
      for (const text of includes) assert.include(split.context, text);
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
      const instructions = `${"a".repeat(PROJECT_CONTEXT_MAX_CHARS)}OVERFLOW`;
      const { task } = yield* withContext({ instructions });
      assert.include(task, "a".repeat(PROJECT_CONTEXT_MAX_CHARS));
      assert.notInclude(task, "OVERFLOW");
    }),
  );

  it.effect.each(["..", ".", "a/b", "../escape", "", "a\\b", "a\u0000b"])(
    "rejects the project id %j as a path segment",
    (projectId) =>
      Effect.gen(function* () {
        const context = yield* ProjectContext.ProjectContext;
        for (const error of [
          yield* context.taskWithContext(projectId, TASK).pipe(Effect.flip),
          yield* context.listLibrary(projectId).pipe(Effect.flip),
          yield* context.readFiles(projectId).pipe(Effect.flip),
          yield* context.writeFiles(projectId, { instructions: "", memory: "" }).pipe(Effect.flip),
        ]) {
          assert.equal(error._tag, "ProjectContextPathError");
        }
      }),
  );

  it.effect("saves instructions and memory that the next delegated task starts with", () =>
    Effect.gen(function* () {
      const context = yield* ProjectContext.ProjectContext;
      assert.deepEqual(yield* context.readFiles("project:edit"), { instructions: "", memory: "" });
      const files = { instructions: "Use pnpm.", memory: "- [auth](auth.md)" };
      assert.deepEqual(yield* context.writeFiles("project:edit", files), files);
      assert.deepEqual(yield* context.readFiles("project:edit"), files);
      const split = splitProjectContextBlock(yield* context.taskWithContext("project:edit", TASK));
      assert.include(split.context, "Use pnpm.");
      assert.strictEqual(split.task, TASK);
    }),
  );

  it.effect("refuses a save over the cap and keeps what was stored", () =>
    Effect.gen(function* () {
      const context = yield* ProjectContext.ProjectContext;
      yield* context.writeFiles("project:cap", { instructions: "Keep me.", memory: "" });
      const error = yield* context
        .writeFiles("project:cap", {
          instructions: "a".repeat(PROJECT_CONTEXT_MAX_CHARS + 1),
          memory: "",
        })
        .pipe(Effect.flip);
      assert.equal(error._tag, "ProjectContextTooLongError");
      assert.deepEqual(yield* context.readFiles("project:cap"), {
        instructions: "Keep me.",
        memory: "",
      });
    }),
  );

  it.effect("fails a read for editing that the child brief would treat as empty", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const context = yield* ProjectContext.ProjectContext;
      const directory = yield* context.directory("project:unreadable");
      yield* fileSystem.makeDirectory(path.join(directory, "instructions.md"), {
        recursive: true,
      });
      assert.deepEqual(yield* context.read("project:unreadable"), { instructions: "", memory: "" });
      const error = yield* context.readFiles("project:unreadable").pipe(Effect.flip);
      assert.equal(error._tag, "ProjectContextFileError");
    }),
  );

  it.effect("creates the Library on first listing and lists nested files without links", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const context = yield* ProjectContext.ProjectContext;
      const empty = yield* context.listLibrary("project:library");
      assert.isTrue(yield* fileSystem.exists(empty.path));
      assert.deepEqual(empty.entries, []);
      assert.strictEqual(
        empty.path,
        path.join(yield* context.directory("project:library"), "library"),
      );

      yield* fileSystem.makeDirectory(path.join(empty.path, "reports"));
      yield* fileSystem.writeFileString(path.join(empty.path, "reports", "q3.md"), "12345");
      yield* fileSystem.symlink(path.join(empty.path, "reports"), path.join(empty.path, "loop"));
      const listed = yield* context.listLibrary("project:library");
      assert.deepEqual(
        listed.entries.map(({ path, kind, sizeBytes }) => ({ path, kind, sizeBytes })),
        [
          { path: "reports", kind: "directory", sizeBytes: null },
          { path: "reports/q3.md", kind: "file", sizeBytes: 5 },
        ],
      );
      assert.isString(listed.entries[1]?.modifiedAt);
      assert.isFalse(listed.truncated);
    }),
  );
});
