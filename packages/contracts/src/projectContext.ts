import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Each standing context file is capped here; the server refuses a longer write. */
export const PROJECT_CONTEXT_MAX_CHARS = 16_000;

const ProjectContextText = Schema.String.check(Schema.isMaxLength(PROJECT_CONTEXT_MAX_CHARS));

export const ProjectContextInput = Schema.Struct({ projectId: ProjectId });
export type ProjectContextInput = typeof ProjectContextInput.Type;

export const ProjectContextFiles = Schema.Struct({
  instructions: ProjectContextText,
  memory: ProjectContextText,
});
export type ProjectContextFiles = typeof ProjectContextFiles.Type;

export const ProjectContextWriteInput = Schema.Struct({
  projectId: ProjectId,
  ...ProjectContextFiles.fields,
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

export class ProjectContextError extends Schema.TaggedError<ProjectContextError>()(
  "ProjectContextError",
  {
    message: Schema.String,
    projectId: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
