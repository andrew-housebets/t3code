import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Option from "effect/Option";
import type * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import {
  PROJECT_CONTEXT_MAX_CHARS,
  type ProjectLibraryEntry,
  type ProjectLibraryListing,
} from "@t3tools/contracts";
import { formatProjectContextBlock } from "@t3tools/shared/projectContextBlock";

import * as ServerConfig from "../config.ts";

// ponytail: a flat listing capped here; page it if Libraries grow past a few thousand files.
const LIBRARY_LISTING_LIMIT = 2_000;

const PATH_SEPARATOR_OR_NUL = /[/\\\0]/;

export class ProjectContextPathError extends Schema.TaggedError<ProjectContextPathError>()(
  "ProjectContextPathError",
  { projectId: Schema.String },
) {
  override get message(): string {
    return `Project id ${JSON.stringify(this.projectId)} is not a single safe path segment.`;
  }
}

export class ProjectContextLibraryError extends Schema.TaggedError<ProjectContextLibraryError>()(
  "ProjectContextLibraryError",
  { path: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `The project Library at ${this.path} could not be created or read.`;
  }
}

export interface ProjectContextFiles {
  readonly instructions: string;
  readonly memory: string;
}

export class ProjectContext extends Context.Service<
  ProjectContext,
  {
    /** `<stateDir>/projects/<projectId>`, the id URI-encoded. */
    readonly directory: (projectId: string) => Effect.Effect<string, ProjectContextPathError>;
    /** A missing or unreadable file reads as empty; each is capped at `PROJECT_CONTEXT_MAX_CHARS`. */
    readonly read: (
      projectId: string,
    ) => Effect.Effect<ProjectContextFiles, ProjectContextPathError>;
    readonly ensureLibrary: (
      projectId: string,
    ) => Effect.Effect<string, ProjectContextPathError | ProjectContextLibraryError>;
    /** Every file and folder in the Library, creating it first; symbolic links are left out. */
    readonly listLibrary: (
      projectId: string,
    ) => Effect.Effect<ProjectLibraryListing, ProjectContextPathError | ProjectContextLibraryError>;
    /** The task unchanged when the project has no instructions or memory. */
    readonly taskWithContext: (
      projectId: string,
      task: string,
    ) => Effect.Effect<string, ProjectContextPathError | ProjectContextLibraryError>;
  }
>()("t3/projectContext/ProjectContext") {}

const capped = (text: string) => {
  if (text.length <= PROJECT_CONTEXT_MAX_CHARS) return text;
  const code = text.charCodeAt(PROJECT_CONTEXT_MAX_CHARS - 1);
  const end =
    code >= 0xd800 && code <= 0xdbff ? PROJECT_CONTEXT_MAX_CHARS - 1 : PROJECT_CONTEXT_MAX_CHARS;
  return `${text.slice(0, end)}\n[Cut at ${PROJECT_CONTEXT_MAX_CHARS} characters.]`;
};

function formatTaskWithContext(
  task: string,
  context: ProjectContextFiles & { readonly libraryDir: string },
): string {
  const sections = [
    context.instructions.trim() === ""
      ? undefined
      : `## Standing instructions\n\n${context.instructions.trimEnd()}`,
    context.memory.trim() === "" ? undefined : `## Memory index\n\n${context.memory.trimEnd()}`,
    `Library: put non-code deliverables (reports, notes, docs) in ${context.libraryDir}, not in your worktree, which is private to this thread.`,
  ].filter((section) => section !== undefined);
  return formatProjectContextBlock(
    `This project's standing context. Follow it while you do the task below.\n\n${sections.join("\n\n")}`,
    task,
  );
}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const directory = Effect.fn("ProjectContext.directory")(function* (projectId: string) {
    if (
      projectId === "" ||
      projectId === "." ||
      projectId === ".." ||
      PATH_SEPARATOR_OR_NUL.test(projectId)
    ) {
      return yield* new ProjectContextPathError({ projectId });
    }
    // Ids minted by MCP contain ":", which Windows does not allow in a file name.
    return path.join(config.stateDir, "projects", encodeURIComponent(projectId));
  });

  const readOrEmpty = (filePath: string) =>
    fileSystem.readFileString(filePath).pipe(
      Effect.map(capped),
      Effect.catchTags({
        PlatformError: (error) =>
          error.reason._tag === "NotFound"
            ? Effect.succeed("")
            : Effect.logWarning("Project context file could not be read.").pipe(
                Effect.annotateLogs({ path: filePath }),
                Effect.as(""),
              ),
      }),
    );

  const read = Effect.fn("ProjectContext.read")(function* (projectId: string) {
    const root = yield* directory(projectId);
    const [instructions, memory] = yield* Effect.all(
      [readOrEmpty(path.join(root, "instructions.md")), readOrEmpty(path.join(root, "MEMORY.md"))],
      { concurrency: "unbounded" },
    );
    return { instructions, memory };
  });

  const ensureLibrary = Effect.fn("ProjectContext.ensureLibrary")(function* (projectId: string) {
    const libraryDir = path.join(yield* directory(projectId), "library");
    yield* fileSystem
      .makeDirectory(libraryDir, { recursive: true })
      .pipe(
        Effect.mapError((cause) => new ProjectContextLibraryError({ path: libraryDir, cause })),
      );
    return libraryDir;
  });

  const listLibrary = Effect.fn("ProjectContext.listLibrary")(function* (projectId: string) {
    const root = yield* ensureLibrary(projectId);
    const entries: Array<ProjectLibraryEntry> = [];
    let truncated = false;
    const walk: (relative: string) => Effect.Effect<void, PlatformError.PlatformError> = Effect.fn(
      "ProjectContext.walkLibrary",
    )(function* (relative: string) {
      const children = yield* fileSystem.readDirectoryEntries(path.join(root, relative));
      for (const child of children) {
        if (child.type !== "File" && child.type !== "Directory") continue;
        if (entries.length >= LIBRARY_LISTING_LIMIT) {
          truncated = true;
          return;
        }
        const entryPath = relative === "" ? child.name : `${relative}/${child.name}`;
        const info = yield* fileSystem
          .stat(path.join(root, entryPath))
          .pipe(Effect.option, Effect.map(Option.getOrUndefined));
        entries.push({
          path: entryPath,
          kind: child.type === "File" ? "file" : "directory",
          sizeBytes: child.type === "File" && info !== undefined ? Number(info.size) : null,
          modifiedAt:
            info === undefined
              ? null
              : Option.match(info.mtime, {
                  onNone: () => null,
                  onSome: (date) => date.toISOString(),
                }),
        });
        if (child.type === "Directory") yield* walk(entryPath);
      }
    });
    yield* walk("").pipe(
      Effect.mapError((cause) => new ProjectContextLibraryError({ path: root, cause })),
    );
    return { path: root, entries, truncated };
  });

  const taskWithContext = Effect.fn("ProjectContext.taskWithContext")(function* (
    projectId: string,
    task: string,
  ) {
    const files = yield* read(projectId);
    if (files.instructions.trim() === "" && files.memory.trim() === "") return task;
    return formatTaskWithContext(task, {
      ...files,
      libraryDir: yield* ensureLibrary(projectId),
    });
  });

  return ProjectContext.of({ directory, read, ensureLibrary, listLibrary, taskWithContext });
});

export const layer = Layer.effect(ProjectContext, make);
