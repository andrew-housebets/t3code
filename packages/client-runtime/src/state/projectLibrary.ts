import type { ProjectLibraryEntry } from "@t3tools/contracts";
import { groupBy } from "effect/Array";

export interface ProjectLibraryRow {
  readonly entry: ProjectLibraryEntry;
  readonly name: string;
  readonly depth: number;
}

const parentOf = (path: string) => {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
};

/** Folders before files, by name; an expanded folder's contents follow it, one level deeper. */
export function visibleLibraryRows(
  entries: ReadonlyArray<ProjectLibraryEntry>,
  expanded: ReadonlySet<string>,
): ReadonlyArray<ProjectLibraryRow> {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const childrenOf: Partial<Record<string, ReadonlyArray<ProjectLibraryEntry>>> = groupBy(
    entries,
    (entry) => parentOf(entry.path),
  );
  const rows: Array<ProjectLibraryRow> = [];
  const walk = (folder: string, depth: number) => {
    const children = [...(childrenOf[folder] ?? [])].sort(
      (left, right) =>
        Number(left.kind === "file") - Number(right.kind === "file") ||
        collator.compare(left.path, right.path),
    );
    for (const entry of children) {
      rows.push({ entry, name: entry.path.slice(folder === "" ? 0 : folder.length + 1), depth });
      if (entry.kind === "directory" && expanded.has(entry.path)) walk(entry.path, depth + 1);
    }
  };
  walk("", 0);
  return rows;
}
