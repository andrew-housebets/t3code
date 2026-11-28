export interface ProjectFolder {
  readonly path: string;
  readonly note: string;
}

/** One folder per non-blank line: a path, then an optional ` # note`. */
export function parseProjectFolders(text: string): ReadonlyArray<ProjectFolder> {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => {
      const noteAt = line.indexOf(" # ");
      return noteAt < 0
        ? { path: line, note: "" }
        : { path: line.slice(0, noteAt).trimEnd(), note: line.slice(noteAt + 3).trim() };
    });
}
