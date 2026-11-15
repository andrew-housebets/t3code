import { describe, expect, it } from "vite-plus/test";

import { isGroupCollapsed, useCoordinatorStore } from "./coordinatorStore";

describe("coordinator store", () => {
  it("folds resolved threads until toggled, and remembers toggles per thread", () => {
    const { toggleGroup } = useCoordinatorStore.getState();
    const collapsedFor = (threadKey: string) =>
      useCoordinatorStore.getState().collapsedGroups[threadKey];
    expect(isGroupCollapsed(collapsedFor("a"), "resolved")).toBe(true);
    expect(isGroupCollapsed(collapsedFor("a"), "working")).toBe(false);
    toggleGroup("a", "resolved");
    toggleGroup("a", "working");
    expect(isGroupCollapsed(collapsedFor("a"), "resolved")).toBe(false);
    expect(isGroupCollapsed(collapsedFor("a"), "working")).toBe(true);
    expect(isGroupCollapsed(collapsedFor("b"), "resolved")).toBe(true);
  });

  it("opens a coordinator's overview on its first view only", () => {
    const { claimFirstOverview } = useCoordinatorStore.getState();
    expect(claimFirstOverview("thread")).toBe(true);
    expect(claimFirstOverview("thread")).toBe(false);
    expect(claimFirstOverview("other")).toBe(true);
  });
});
