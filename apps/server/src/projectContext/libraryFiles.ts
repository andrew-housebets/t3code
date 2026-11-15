// @effect-diagnostics nodeBuiltinImport:off -- an exclusive copy is a filesystem flag Effect's FileSystem does not expose.
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

class LibraryCopyError extends Schema.TaggedError<LibraryCopyError>()("LibraryCopyError", {
  cause: Schema.Defect(),
}) {}

const MAX_NAME_LENGTH = 200;
const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;

/** One safe path segment for a file a user adds to the Library, or null when nothing usable is left. */
export function safeLibraryFileName(name: string): string | null {
  const cleaned = (name.split(/[/\\]/).at(-1) ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>:"|?*]/g, "_")
    .trim()
    .replace(/[. ]+$/, "");
  if (cleaned === "" || cleaned === "." || cleaned === "..") return null;
  const named = WINDOWS_DEVICE_NAME.test(cleaned) ? `_${cleaned}` : cleaned;
  if (named.length <= MAX_NAME_LENGTH) return named;
  const dot = named.lastIndexOf(".");
  const extension = dot > 0 && named.length - dot <= 20 ? named.slice(dot) : "";
  return `${named.slice(0, MAX_NAME_LENGTH - extension.length)}${extension}`;
}

/** A Library-relative file path whose segments are all plain names, or null. */
export function libraryRelativePath(path: string): string | null {
  const segments = path.split("/");
  return segments.every(
    (segment) =>
      segment !== "" &&
      segment !== "." &&
      segment !== ".." &&
      !segment.includes("\\") &&
      !segment.includes("\0"),
  )
    ? path
    : null;
}

/** Copies without replacing unless asked: "exists" when the target is already there. */
export const copyIntoLibrary = (source: string, target: string, replace: boolean) =>
  Effect.tryPromise({
    try: () =>
      NodeFSP.copyFile(source, target, replace ? 0 : NodeFS.constants.COPYFILE_EXCL).then(
        () => "copied" as const,
        (cause: unknown) => {
          if ((cause as { readonly code?: unknown } | null)?.code === "EEXIST") {
            return "exists" as const;
          }
          throw cause;
        },
      ),
    catch: (cause) => new LibraryCopyError({ cause }),
  });
