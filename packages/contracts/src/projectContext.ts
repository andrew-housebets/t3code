import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";

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

/** A file a user adds to the Library is refused above this size. */
export const PROJECT_LIBRARY_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

export const ProjectLibraryAddInput = Schema.Struct({
  projectId: ProjectId,
  /** A pending upload minted by `attachments.createUploadUrl`; it is moved, not copied. */
  attachmentId: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  /** Without it, an existing file of the same name refuses the add. */
  replace: Schema.Boolean,
});
export type ProjectLibraryAddInput = typeof ProjectLibraryAddInput.Type;

export const ProjectLibraryAddResult = Schema.Struct({
  /** The name the file was stored under, after reducing it to one safe segment. */
  path: TrimmedNonEmptyString,
});
export type ProjectLibraryAddResult = typeof ProjectLibraryAddResult.Type;

export const ProjectLibraryRemoveInput = Schema.Struct({
  projectId: ProjectId,
  /** Library-relative, `/`-separated. */
  path: TrimmedNonEmptyString,
});
export type ProjectLibraryRemoveInput = typeof ProjectLibraryRemoveInput.Type;

/** Null leaves the usual default in place. */
export const ProjectModelDefaults = Schema.Struct({
  /** A new coordinator draft in the project starts on this model. */
  coordinatorModelSelection: Schema.NullOr(ModelSelection),
  /** A coordinator's `delegate_task` uses this model when the task names none. */
  threadModelSelection: Schema.NullOr(ModelSelection),
});
export type ProjectModelDefaults = typeof ProjectModelDefaults.Type;

export const ProjectModelDefaultsWriteInput = Schema.Struct({
  projectId: ProjectId,
  defaults: ProjectModelDefaults,
});
export type ProjectModelDefaultsWriteInput = typeof ProjectModelDefaultsWriteInput.Type;

export class ProjectLibraryFileExistsError extends Schema.TaggedError<ProjectLibraryFileExistsError>()(
  "ProjectLibraryFileExistsError",
  { projectId: Schema.String, fileName: Schema.String },
) {
  override get message(): string {
    return `The Library already has a file named ${this.fileName}.`;
  }
}

export class ProjectContextError extends Schema.TaggedError<ProjectContextError>()(
  "ProjectContextError",
  {
    message: Schema.String,
    projectId: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
