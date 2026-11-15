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
  PROJECT_LIBRARY_UPLOAD_MAX_BYTES,
  ProjectLibraryFileExistsError,
  type ProjectArtifact,
  type ProjectArtifactListing,
  type ProjectLibraryEntry,
  type ProjectLibraryListing,
  ThreadId,
} from "@t3tools/contracts";
import { formatProjectContextBlock } from "@t3tools/shared/projectContextBlock";

import {
  parseThreadSegmentFromAttachmentId,
  PENDING_ATTACHMENT_THREAD_SEGMENT,
  resolveAttachmentPathById,
} from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import * as ProjectSidecar from "../projectSidecar/ProjectSidecar.ts";
import { isWithinRoot } from "../workspace/KnownWorkspaces.ts";
import { copyIntoLibrary, libraryRelativePath, safeLibraryFileName } from "./libraryFiles.ts";

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

export class ProjectContextFileError extends Schema.TaggedError<ProjectContextFileError>()(
  "ProjectContextFileError",
  { path: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `The project context file ${this.path} could not be read or written.`;
  }
}

export class ProjectContextTooLongError extends Schema.TaggedError<ProjectContextTooLongError>()(
  "ProjectContextTooLongError",
  { file: Schema.String, length: Schema.Number },
) {
  override get message(): string {
    return `${this.file} is ${this.length} characters; the limit is ${PROJECT_CONTEXT_MAX_CHARS}.`;
  }
}

const LIBRARY_REQUEST_REFUSALS = {
  name: "That file name has nothing usable left once made safe.",
  path: "That is not a file in the Library.",
  missing_upload: "The upload is gone; add the file again.",
  too_large: `Files added to the Library can be at most ${PROJECT_LIBRARY_UPLOAD_MAX_BYTES / 1024 / 1024} MB.`,
} as const;

export class ProjectLibraryRequestError extends Schema.TaggedError<ProjectLibraryRequestError>()(
  "ProjectLibraryRequestError",
  { reason: Schema.Literals(["name", "path", "missing_upload", "too_large"]) },
) {
  override get message(): string {
    return LIBRARY_REQUEST_REFUSALS[this.reason];
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
    /** The files as stored, for editing: uncapped, and a read failure fails rather than reading as empty. */
    readonly readFiles: (
      projectId: string,
    ) => Effect.Effect<ProjectContextFiles, ProjectContextPathError | ProjectContextFileError>;
    /** Replaces both files, each through a rename; refuses text over `PROJECT_CONTEXT_MAX_CHARS`. */
    readonly writeFiles: (
      projectId: string,
      files: ProjectContextFiles,
    ) => Effect.Effect<
      ProjectContextFiles,
      ProjectContextPathError | ProjectContextFileError | ProjectContextTooLongError
    >;
    readonly ensureLibrary: (
      projectId: string,
    ) => Effect.Effect<string, ProjectContextPathError | ProjectContextLibraryError>;
    /** Every file and folder in the Library, creating it first; symbolic links are left out. */
    readonly listLibrary: (
      projectId: string,
    ) => Effect.Effect<ProjectLibraryListing, ProjectContextPathError | ProjectContextLibraryError>;
    /**
     * The Library and the HTML renders of the project's threads, with each one's thread when
     * known. Reconciles the sidecar index with the disk in the same pass.
     */
    readonly listArtifacts: (
      projectId: string,
    ) => Effect.Effect<
      ProjectArtifactListing,
      ProjectContextPathError | ProjectContextLibraryError
    >;
    /**
     * Moves a pending upload into the Library under a safe name, owned by the user. Refuses an
     * existing name unless `replace`, and a file over `PROJECT_LIBRARY_UPLOAD_MAX_BYTES`.
     */
    readonly addLibraryFile: (input: {
      readonly projectId: string;
      readonly attachmentId: string;
      readonly name: string;
      readonly replace: boolean;
    }) => Effect.Effect<
      { readonly path: string },
      | ProjectContextPathError
      | ProjectContextLibraryError
      | ProjectLibraryRequestError
      | ProjectLibraryFileExistsError
    >;
    /** Deletes one Library file, never a folder or a link, and forgets its owner. */
    readonly removeLibraryFile: (input: {
      readonly projectId: string;
      readonly path: string;
    }) => Effect.Effect<
      void,
      ProjectContextPathError | ProjectContextLibraryError | ProjectLibraryRequestError
    >;
    /** The task unchanged when the project has no instructions or memory. */
    readonly taskWithContext: (
      projectId: string,
      task: string,
    ) => Effect.Effect<string, ProjectContextPathError | ProjectContextLibraryError>;
    /** What a coordinator reads beside its brief: the same instructions and memory, and the Library. */
    readonly coordinatorContext: (
      projectId: string,
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

const fileSections = (files: ProjectContextFiles) =>
  [
    files.instructions.trim() === ""
      ? undefined
      : `## Standing instructions\n\n${files.instructions.trimEnd()}`,
    files.memory.trim() === "" ? undefined : `## Memory index\n\n${files.memory.trimEnd()}`,
  ].filter((section) => section !== undefined);

function formatTaskWithContext(
  task: string,
  context: ProjectContextFiles & { readonly libraryDir: string },
): string {
  const sections = [
    ...fileSections(context),
    `Library: put non-code deliverables (reports, notes, docs) in ${context.libraryDir}, not in your worktree, which is private to this thread.`,
  ];
  return formatProjectContextBlock(
    `This project's standing context. Follow it while you do the task below.\n\n${sections.join("\n\n")}`,
    task,
  );
}

function formatCoordinatorContext(
  context: ProjectContextFiles & { readonly libraryDir: string },
): string {
  return [
    "## Project standing context\n\nEvery thread you delegate starts with these instructions and this memory. Hold delegated work to them, and answer questions about them from this text.",
    ...fileSections(context),
    `Library: the project's non-code deliverables are in ${context.libraryDir}.`,
  ].join("\n\n");
}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const sidecar = yield* ProjectSidecar.ProjectSidecar;
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

  const FILE_NAMES = { instructions: "instructions.md", memory: "MEMORY.md" } as const;

  const readStored = (filePath: string) =>
    fileSystem.readFileString(filePath).pipe(
      Effect.catchTags({
        PlatformError: (cause) =>
          cause.reason._tag === "NotFound"
            ? Effect.succeed("")
            : Effect.fail(new ProjectContextFileError({ path: filePath, cause })),
      }),
    );

  const readFiles = Effect.fn("ProjectContext.readFiles")(function* (projectId: string) {
    const root = yield* directory(projectId);
    const [instructions, memory] = yield* Effect.all(
      [
        readStored(path.join(root, FILE_NAMES.instructions)),
        readStored(path.join(root, FILE_NAMES.memory)),
      ],
      { concurrency: "unbounded" },
    );
    return { instructions, memory };
  });

  const writeFiles = Effect.fn("ProjectContext.writeFiles")(function* (
    projectId: string,
    files: ProjectContextFiles,
  ) {
    const root = yield* directory(projectId);
    for (const key of ["instructions", "memory"] as const) {
      if (files[key].length > PROJECT_CONTEXT_MAX_CHARS) {
        return yield* new ProjectContextTooLongError({
          file: FILE_NAMES[key],
          length: files[key].length,
        });
      }
    }
    for (const key of ["instructions", "memory"] as const) {
      const target = path.join(root, FILE_NAMES[key]);
      // ponytail: one staging name per file; two saves racing on one project can interleave.
      const staged = `${target}.saving`;
      yield* fileSystem.makeDirectory(root, { recursive: true }).pipe(
        Effect.andThen(fileSystem.writeFileString(staged, files[key])),
        Effect.andThen(fileSystem.rename(staged, target)),
        Effect.mapError((cause) => new ProjectContextFileError({ path: target, cause })),
      );
    }
    return files;
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

  const listArtifacts = Effect.fn("ProjectContext.listArtifacts")(function* (projectId: string) {
    const library = yield* listLibrary(projectId);
    const files = library.entries.filter((entry) => entry.kind === "file");
    const rows = yield* sidecar
      .syncLibraryFiles(
        projectId,
        files.map((file) => ({ path: file.path, sizeBytes: file.sizeBytes })),
        { complete: !library.truncated },
      )
      .pipe(
        Effect.andThen(sidecar.listArtifacts(projectId)),
        Effect.catchTags({
          ProjectSidecarError: (cause) =>
            Effect.logWarning("Project artifacts are listed without owners.", { cause }).pipe(
              Effect.as([]),
            ),
        }),
      );
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    const goneRenders = rows.filter(
      (row) =>
        row.source === "html_render" &&
        resolveAttachmentPathById({
          attachmentsDir: config.attachmentsDir,
          attachmentId: row.path,
        }) === null,
    );
    yield* sidecar
      .removeArtifacts(
        projectId,
        goneRenders.map((row) => row.id),
      )
      .pipe(Effect.ignore);
    const owner = (threadId: string | null) => (threadId === null ? null : ThreadId.make(threadId));
    const artifacts: Array<ProjectArtifact> = [
      ...files.map((file) => {
        const row = rowsById.get(`file:${file.path}`);
        return {
          id: `file:${file.path}`,
          source: row?.source ?? "library",
          path: file.path,
          title: path.basename(file.path),
          threadId: owner(row?.threadId ?? null),
          sizeBytes: file.sizeBytes,
          updatedAt: file.modifiedAt ?? row?.updatedAt ?? null,
        };
      }),
      ...rows
        .filter((row) => row.source === "html_render" && !goneRenders.includes(row))
        .map((row) => ({
          id: row.id,
          source: row.source,
          path: row.path,
          title: row.title,
          threadId: owner(row.threadId),
          sizeBytes: row.sizeBytes,
          updatedAt: row.updatedAt,
        })),
    ];
    artifacts.sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""));
    return { library, artifacts };
  });

  const addLibraryFile = Effect.fn("ProjectContext.addLibraryFile")(function* (input: {
    readonly projectId: string;
    readonly attachmentId: string;
    readonly name: string;
    readonly replace: boolean;
  }) {
    const name = safeLibraryFileName(input.name);
    if (name === null) return yield* new ProjectLibraryRequestError({ reason: "name" });
    const upload =
      parseThreadSegmentFromAttachmentId(input.attachmentId) === PENDING_ATTACHMENT_THREAD_SEGMENT
        ? resolveAttachmentPathById({
            attachmentsDir: config.attachmentsDir,
            attachmentId: input.attachmentId,
          })
        : null;
    if (upload === null) return yield* new ProjectLibraryRequestError({ reason: "missing_upload" });
    const info = yield* fileSystem.stat(upload).pipe(
      Effect.catchTags({
        PlatformError: () => new ProjectLibraryRequestError({ reason: "missing_upload" }),
      }),
    );
    const sizeBytes = Number(info.size);
    if (sizeBytes > PROJECT_LIBRARY_UPLOAD_MAX_BYTES) {
      return yield* new ProjectLibraryRequestError({ reason: "too_large" });
    }
    const libraryDir = yield* ensureLibrary(input.projectId);
    const outcome = yield* copyIntoLibrary(upload, path.join(libraryDir, name), input.replace).pipe(
      Effect.mapError((cause) => new ProjectContextLibraryError({ path: libraryDir, cause })),
    );
    if (outcome === "exists") {
      return yield* new ProjectLibraryFileExistsError({
        projectId: input.projectId,
        fileName: name,
      });
    }
    yield* fileSystem.remove(upload, { force: true }).pipe(Effect.ignore);
    yield* sidecar
      .recordArtifacts([
        {
          projectId: input.projectId,
          threadId: null,
          source: "upload",
          path: name,
          title: name,
          sizeBytes,
        },
      ])
      .pipe(
        Effect.catchTags({
          ProjectSidecarError: (cause) =>
            Effect.logWarning("A Library upload was stored without its owner.", { cause }),
        }),
      );
    return { path: name };
  });

  const removeLibraryFile = Effect.fn("ProjectContext.removeLibraryFile")(function* (input: {
    readonly projectId: string;
    readonly path: string;
  }) {
    const relative = libraryRelativePath(input.path);
    const libraryDir = path.join(yield* directory(input.projectId), "library");
    const target = relative === null ? null : path.join(libraryDir, relative);
    const info =
      target === null || !isWithinRoot(path, target, libraryDir) || target === libraryDir
        ? null
        : yield* fileSystem.lstat(target).pipe(Effect.orElseSucceed(() => null));
    if (target === null || info?.type !== "File") {
      return yield* new ProjectLibraryRequestError({ reason: "path" });
    }
    yield* fileSystem
      .remove(target)
      .pipe(
        Effect.mapError((cause) => new ProjectContextLibraryError({ path: libraryDir, cause })),
      );
    yield* sidecar.removeArtifacts(input.projectId, [`file:${relative}`]).pipe(Effect.ignore);
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

  const coordinatorContext = Effect.fn("ProjectContext.coordinatorContext")(function* (
    projectId: string,
  ) {
    const files = yield* read(projectId);
    return formatCoordinatorContext({ ...files, libraryDir: yield* ensureLibrary(projectId) });
  });

  return ProjectContext.of({
    directory,
    read,
    readFiles,
    writeFiles,
    ensureLibrary,
    listLibrary,
    listArtifacts,
    addLibraryFile,
    removeLibraryFile,
    taskWithContext,
    coordinatorContext,
  });
});

export const layer = Layer.effect(ProjectContext, make);
