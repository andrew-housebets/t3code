import { describe, expect, it } from "vite-plus/test";

import { drawerRecentsIndex } from "./drawerSections";

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
