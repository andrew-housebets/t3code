import { describe, expect, it } from "vite-plus/test";

import { libraryRelativePath, safeLibraryFileName } from "./libraryFiles.ts";

describe("safeLibraryFileName", () => {
  it.each([
    ["report.pdf", "report.pdf"],
    ["../../etc/passwd", "passwd"],
    ["C:\\Users\\me\\notes.md", "notes.md"],
    ["  spaced name.txt  ", "spaced name.txt"],
    ['a<b>c:"d|e?f*.md', "a_b_c__d_e_f_.md"],
    ["bell\u0007\u0000.txt", "bell.txt"],
    ["trailing dots...", "trailing dots"],
    ["CON.txt", "_CON.txt"],
    [".env", ".env"],
    ["..", null],
    ["dir/", null],
    ["\u0000", null],
    [`${"x".repeat(300)}.md`, `${"x".repeat(197)}.md`],
  ])("%j becomes %j", (name, safe) => {
    expect(safeLibraryFileName(name)).toBe(safe);
  });
});

describe("libraryRelativePath", () => {
  it.each([
    ["notes/a.md", "notes/a.md"],
    ["../MEMORY.md", null],
    ["a//b.md", null],
    ["/abs.md", null],
    ["a\\..\\b.md", null],
  ])("%j", (path, expected) => {
    expect(libraryRelativePath(path)).toBe(expected);
  });
});
