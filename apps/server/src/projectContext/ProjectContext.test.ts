import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { PROJECT_CONTEXT_MAX_CHARS, PROJECT_LIBRARY_UPLOAD_MAX_BYTES } from "@t3tools/contracts";
import { splitProjectContextBlock } from "@t3tools/shared/projectContextBlock";
import { createPendingAttachmentId, resolveAttachmentPathById } from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import * as ProjectSidecar from "../projectSidecar/ProjectSidecar.ts";
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
  Layer.provideMerge(ProjectSidecar.layer),
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

  it.effect("gives a coordinator the same instructions, memory and Library its children get", () =>
    Effect.gen(function* () {
      const { libraryDir } = yield* withContext({
        instructions: "End every file with ZEBRA-7.",
        memory: "- [auth](auth.md)",
      });
      const context = yield* (yield* ProjectContext.ProjectContext).coordinatorContext(
        "project:mcp-1",
      );
      for (const text of ["End every file with ZEBRA-7.", "- [auth](auth.md)", libraryDir]) {
        assert.include(context, text);
      }
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

  it.effect("lists Library files with their writer, and drops a render whose file is gone", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const context = yield* ProjectContext.ProjectContext;
      const sidecar = yield* ProjectSidecar.ProjectSidecar;
      const library = yield* context.ensureLibrary("project:artifacts");
      yield* fileSystem.writeFileString(path.join(library, "by-thread.md"), "a");
      yield* fileSystem.writeFileString(path.join(library, "by-shell.md"), "b");
      yield* sidecar.recordArtifacts(
        [
          { source: "library" as const, path: "by-thread.md", title: "by-thread.md" },
          { source: "library" as const, path: "deleted.md", title: "deleted.md" },
          { source: "html_render" as const, path: "thread-1-gone", title: "Chart" },
        ].map((artifact) => ({
          ...artifact,
          projectId: "project:artifacts",
          threadId: "thread-1",
          sizeBytes: 1,
        })),
      );

      const { artifacts } = yield* context.listArtifacts("project:artifacts");
      assert.deepEqual(
        Object.fromEntries(
          artifacts.map((artifact): [string, string | null] => [artifact.id, artifact.threadId]),
        ),
        { "file:by-thread.md": "thread-1", "file:by-shell.md": null },
      );
      assert.deepEqual(
        (yield* sidecar.listArtifacts("project:artifacts")).map((row) => row.id).toSorted(),
        ["file:by-shell.md", "file:by-thread.md"],
      );
    }),
  );

  const pendingUpload = (contents: string, sizeBytes?: number) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { attachmentsDir } = yield* ServerConfig.ServerConfig;
      const attachmentId = createPendingAttachmentId("md");
      yield* fileSystem.makeDirectory(attachmentsDir, { recursive: true });
      const file = path.join(attachmentsDir, `${attachmentId}.md`);
      yield* fileSystem.writeFileString(file, contents);
      if (sizeBytes !== undefined) yield* fileSystem.truncate(file, sizeBytes);
      assert.strictEqual(resolveAttachmentPathById({ attachmentsDir, attachmentId }), file);
      return attachmentId;
    });

  it.effect("adds an upload under a safe name, owned by the user, and refuses to overwrite", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const context = yield* ProjectContext.ProjectContext;
      const projectId = "project:upload";
      const add = (attachmentId: string, replace: boolean) =>
        context.addLibraryFile({ projectId, attachmentId, name: "../brief.md", replace });

      const first = yield* pendingUpload("first");
      assert.deepEqual(yield* add(first, false), { path: "brief.md" });
      const library = yield* context.ensureLibrary(projectId);
      assert.strictEqual(yield* fileSystem.readFileString(path.join(library, "brief.md")), "first");
      const { artifacts } = yield* context.listArtifacts(projectId);
      assert.deepEqual(
        artifacts.map(({ id, source, threadId }) => ({ id, source, threadId })),
        [{ id: "file:brief.md", source: "upload", threadId: null }],
      );

      const second = yield* pendingUpload("second");
      const refused = yield* add(second, false).pipe(Effect.flip);
      assert.strictEqual(refused._tag, "ProjectLibraryFileExistsError");
      assert.strictEqual(yield* fileSystem.readFileString(path.join(library, "brief.md")), "first");
      yield* add(second, true);
      assert.strictEqual(
        yield* fileSystem.readFileString(path.join(library, "brief.md")),
        "second",
      );

      yield* context.removeLibraryFile({ projectId, path: "brief.md" });
      assert.isFalse(yield* fileSystem.exists(path.join(library, "brief.md")));
      assert.deepEqual((yield* context.listArtifacts(projectId)).artifacts, []);
    }),
  );

  it.effect("refuses an upload over the size cap and a path outside the Library", () =>
    Effect.gen(function* () {
      const context = yield* ProjectContext.ProjectContext;
      const projectId = "project:upload-refusals";
      const large = yield* pendingUpload("", PROJECT_LIBRARY_UPLOAD_MAX_BYTES + 1);
      const tooLarge = yield* context
        .addLibraryFile({ projectId, attachmentId: large, name: "big.md", replace: false })
        .pipe(Effect.flip);
      assert.deepInclude(tooLarge, { _tag: "ProjectLibraryRequestError", reason: "too_large" });

      const notPending = yield* context
        .addLibraryFile({ projectId, attachmentId: "thread-1-abc", name: "x.md", replace: false })
        .pipe(Effect.flip);
      assert.deepInclude(notPending, { reason: "missing_upload" });

      const escape = yield* context
        .removeLibraryFile({ projectId, path: "../MEMORY.md" })
        .pipe(Effect.flip);
      assert.deepInclude(escape, { _tag: "ProjectLibraryRequestError", reason: "path" });
    }),
  );
});
