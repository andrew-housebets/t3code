import { describe, expect, it } from "vite-plus/test";

import { isThreadOverviewGroupCollapsed, toggleThreadOverviewGroup } from "./coordinatorUi.ts";

describe("toggleThreadOverviewGroup", () => {
  it("folds resolved threads until toggled, and opens every other group", () => {
    const toggled = toggleThreadOverviewGroup(
      toggleThreadOverviewGroup(undefined, "resolved"),
      "working",
    );
    expect(isThreadOverviewGroupCollapsed(undefined, "resolved")).toBe(true);
    expect(isThreadOverviewGroupCollapsed(undefined, "working")).toBe(false);
    expect(isThreadOverviewGroupCollapsed(toggled, "resolved")).toBe(false);
    expect(isThreadOverviewGroupCollapsed(toggled, "working")).toBe(true);
  });
});
