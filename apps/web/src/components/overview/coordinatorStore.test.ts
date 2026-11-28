import { isThreadOverviewGroupCollapsed } from "@t3tools/client-runtime/state/coordinator-ui";
import { describe, expect, it } from "vite-plus/test";

import { useCoordinatorStore } from "./coordinatorStore";

describe("coordinator store", () => {
  it("remembers group toggles per thread", () => {
    const { toggleGroup } = useCoordinatorStore.getState();
    const collapsedFor = (threadKey: string) =>
      useCoordinatorStore.getState().collapsedGroups[threadKey];
    toggleGroup("a", "resolved");
    expect(isThreadOverviewGroupCollapsed(collapsedFor("a"), "resolved")).toBe(false);
    expect(isThreadOverviewGroupCollapsed(collapsedFor("b"), "resolved")).toBe(true);
  });

  it("opens a coordinator's overview on its first view only", () => {
    const { claimFirstOverview } = useCoordinatorStore.getState();
    expect(claimFirstOverview("thread")).toBe(true);
    expect(claimFirstOverview("thread")).toBe(false);
    expect(claimFirstOverview("other")).toBe(true);
  });
});
