import * as NodePath from "@effect/platform-node/NodePath";
import type { OrchestrationV2TurnItem } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { createAttachmentId } from "../attachmentStore.ts";
import { runArtifacts } from "./ProjectArtifactRecorder.ts";

const THREAD = "thread-writer";
const LIBRARY = "/state/projects/p1/library";
const render = createAttachmentId(THREAD) ?? "";
const otherRender = createAttachmentId("thread-forked-from") ?? "";

const item = (fields: object) =>
  ({ status: "completed", ...fields }) as unknown as OrchestrationV2TurnItem;
const written = (fileName: string, changes?: ReadonlyArray<object>) =>
  item({ type: "file_change", fileName, ...(changes === undefined ? {} : { changes }) });
const rendered = (attachmentId: string) =>
  item({
    type: "dynamic_tool",
    toolName: "mcp__t3-code__html_render",
    output: { htmlRender: { attachmentId, title: "Chart", height: 400 } },
  });

it.layer(NodePath.layer)("runArtifacts", (it) => {
  it.effect.each<
    [string, ReadonlyArray<OrchestrationV2TurnItem>, string | null, ReadonlyArray<string>]
  >([
    ["a Write into the Library", [written(`${LIBRARY}/report.md`)], null, ["file:report.md"]],
    ["a nested file", [written(`${LIBRARY}/notes/a.md`)], null, ["file:notes/a.md"]],
    ["a write outside the Library", [written("/repo/src/a.ts")], null, []],
    ["a sibling folder sharing the prefix", [written(`${LIBRARY}-old/a.md`)], null, []],
    ["an escape through ..", [written(`${LIBRARY}/../MEMORY.md`)], null, []],
    ["a relative path without a checkout", [written("report.md")], null, []],
    [
      "a relative path from the checkout",
      [written("../library/r.md")],
      "/state/projects/p1/x",
      ["file:r.md"],
    ],
    [
      "Codex changes, skipping a delete",
      [
        written(`${LIBRARY}/a.md`, [
          { operation: "add", path: `${LIBRARY}/b.md` },
          { operation: "delete", path: `${LIBRARY}/a.md` },
        ]),
      ],
      null,
      ["file:b.md"],
    ],
    [
      "a failed write",
      [item({ type: "file_change", fileName: `${LIBRARY}/x.md`, status: "failed" })],
      null,
      [],
    ],
    ["this thread's render", [rendered(render)], null, [`render:${render}`]],
    ["a render the fork copied from its source", [rendered(otherRender)], null, []],
  ])("%s", ([_label, items, cwd, ids]) =>
    Effect.gen(function* () {
      const found = runArtifacts({
        path: yield* Path.Path,
        threadId: THREAD,
        projectId: "p1",
        libraryDir: LIBRARY,
        cwd,
        items,
      });
      expect(
        found.map(
          (artifact) => `${artifact.source === "html_render" ? "render" : "file"}:${artifact.path}`,
        ),
      ).toEqual(ids);
      for (const artifact of found) expect(artifact.threadId).toBe(THREAD);
    }),
  );
});
