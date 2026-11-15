import type { ProjectLibraryEntry } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { visibleLibraryRows } from "./projectLibrary.logic";

const file = (path: string): ProjectLibraryEntry => ({
  path,
  kind: "file",
  sizeBytes: 1,
  modifiedAt: null,
});
const folder = (path: string): ProjectLibraryEntry => ({
  path,
  kind: "directory",
  sizeBytes: null,
  modifiedAt: null,
});

describe("visibleLibraryRows", () => {
  const entries = [
    file("notes 10.md"),
    folder("reports"),
    file("reports/q3.md"),
    folder("reports/drafts"),
    file("reports/drafts/q4.md"),
    file("notes 2.md"),
  ];
  const view = (expanded: ReadonlyArray<string>) =>
    visibleLibraryRows(entries, new Set(expanded)).map(
      ({ name, depth }) => `${"  ".repeat(depth)}${name}`,
    );

  it("lists folders first and hides what collapsed folders hold", () => {
    expect(view([])).toEqual(["reports", "notes 2.md", "notes 10.md"]);
  });

  it("shows an expanded folder's contents under it, and only expanded descendants", () => {
    expect(view(["reports"])).toEqual([
      "reports",
      "  drafts",
      "  q3.md",
      "notes 2.md",
      "notes 10.md",
    ]);
    expect(view(["reports/drafts"])).toEqual(["reports", "notes 2.md", "notes 10.md"]);
    expect(view(["reports", "reports/drafts"])).toContain("    q4.md");
  });
});
