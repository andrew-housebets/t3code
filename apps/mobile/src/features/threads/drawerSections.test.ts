import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { drawerPinnedProjects, drawerRecentsIndex } from "./drawerSections";

const environmentId = EnvironmentId.make("env");
const project = (id: string, pinnedAt: string | null) =>
  ({ environmentId, id: ProjectId.make(id), title: id, pinnedAt }) as unknown as EnvironmentProject;
const thread = (id: string, projectId: string, updatedAt: string, tags: string[] = []) => ({
  environmentId,
  id: ThreadId.make(id),
  projectId: ProjectId.make(projectId),
  updatedAt,
  source: { tags },
});

describe("drawerPinnedProjects", () => {
  it("lists pinned projects newest pin first, each opening its latest coordinator", () => {
    const pinned = drawerPinnedProjects(
      [
        project("older", "2026-11-01T00:00:00Z"),
        project("unpinned", null),
        project("newer", "2026-11-10T00:00:00Z"),
      ],
      [
        thread("plain", "older", "2026-11-14T00:00:00Z"),
        thread("first-coordinator", "older", "2026-11-12T00:00:00Z", ["coordinator"]),
        thread("latest-coordinator", "older", "2026-11-13T00:00:00Z", ["coordinator"]),
        thread("elsewhere", "unpinned", "2026-11-14T00:00:00Z", ["coordinator"]),
      ],
    );
    expect(pinned.map((entry) => [entry.project.id, entry.coordinatorThreadId])).toEqual([
      ["newer", null],
      ["older", "latest-coordinator"],
    ]);
  });
});

describe("drawerRecentsIndex", () => {
  it.each([
    { types: ["pinned", "pinned", "thread"], index: 2 },
    { types: ["thread", "thread"], index: 0 },
    { types: ["pinned", "settled-shelf"], index: 1 },
    { types: ["pinned"], index: null },
    { types: [], index: null },
  ])("puts Recents after the pinned threads in $types", ({ types, index }) => {
    const items = types.map((type) =>
      type === "pinned"
        ? { type: "v2-thread", item: { pinned: true } }
        : type === "thread"
          ? { type: "v2-thread", item: { pinned: false } }
          : { type: "v2-settled-shelf" },
    );
    expect(drawerRecentsIndex(items)).toBe(index);
  });
});
