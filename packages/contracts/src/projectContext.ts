import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

/** Each standing context file is capped here; the server refuses a longer write. */
export const PROJECT_CONTEXT_MAX_CHARS = 16_000;

const ProjectContextText = Schema.String.check(Schema.isMaxLength(PROJECT_CONTEXT_MAX_CHARS));

export const ProjectContextInput = Schema.Struct({ projectId: ProjectId });
export type ProjectContextInput = typeof ProjectContextInput.Type;

/** Read back in full, so a hand-edited file over the cap shows as over it. */
export const ProjectContextFiles = Schema.Struct({
  instructions: Schema.String,
  memory: Schema.String,
});
export type ProjectContextFiles = typeof ProjectContextFiles.Type;

export const ProjectContextWriteInput = Schema.Struct({
  projectId: ProjectId,
  instructions: ProjectContextText,
  memory: ProjectContextText,
});
export type ProjectContextWriteInput = typeof ProjectContextWriteInput.Type;

export const ProjectLibraryEntry = Schema.Struct({
  /** Relative to the Library, `/`-separated. */
  path: TrimmedNonEmptyString,
  kind: Schema.Literals(["file", "directory"]),
  sizeBytes: Schema.NullOr(NonNegativeInt),
  modifiedAt: Schema.NullOr(IsoDateTime),
});
export type ProjectLibraryEntry = typeof ProjectLibraryEntry.Type;

export const ProjectLibraryListing = Schema.Struct({
  /** Absolute host path of the Library folder. */
  path: TrimmedNonEmptyString,
  entries: Schema.Array(ProjectLibraryEntry),
  truncated: Schema.Boolean,
});
export type ProjectLibraryListing = typeof ProjectLibraryListing.Type;

/** A Library file or an HTML render, with the thread that produced it when that is certain. */
export const ProjectArtifact = Schema.Struct({
  id: TrimmedNonEmptyString,
  /** `upload` is a file the user added to the Library. */
  source: Schema.Literals(["library", "html_render", "upload"]),
  /** Library-relative for files, the attachment id for an HTML render. */
  path: TrimmedNonEmptyString,
  title: Schema.String,
  threadId: Schema.NullOr(ThreadId),
  sizeBytes: Schema.NullOr(NonNegativeInt),
  updatedAt: Schema.NullOr(IsoDateTime),
});
export type ProjectArtifact = typeof ProjectArtifact.Type;

export const ProjectArtifactListing = Schema.Struct({
  library: ProjectLibraryListing,
  /** Newest first. */
  artifacts: Schema.Array(ProjectArtifact),
});
export type ProjectArtifactListing = typeof ProjectArtifactListing.Type;

export class ProjectContextError extends Schema.TaggedError<ProjectContextError>()(
  "ProjectContextError",
  {
    message: Schema.String,
    projectId: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
