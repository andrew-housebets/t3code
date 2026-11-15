import { ProviderInstanceId, type ModelCapabilities } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { pickModelKeepingOptions } from "./providerOptions";

const claude = ProviderInstanceId.make("claude");
const capabilities: ModelCapabilities = {
  optionDescriptors: [
    {
      id: "effort",
      label: "Effort",
      type: "select",
      options: [
        { id: "low", label: "Low" },
        { id: "high", label: "High", isDefault: true },
      ],
    },
    { id: "fastMode", label: "Fast", type: "boolean" },
  ],
};
const picked = (model: string, caps: ModelCapabilities | null = capabilities) => ({
  selection: { instanceId: claude, model },
  capabilities: caps,
});

describe("pickModelKeepingOptions", () => {
  const current = {
    instanceId: claude,
    model: "opus",
    options: [
      { id: "effort", value: "low" },
      { id: "fastMode", value: true },
      { id: "thinking", value: true },
    ],
  };

  it.each([
    [
      "keeps the options the new model supports and drops the rest",
      picked("sonnet"),
      [
        { id: "effort", value: "low" },
        { id: "fastMode", value: true },
      ],
    ],
    [
      "drops a value the new model does not offer",
      picked("haiku", {
        optionDescriptors: [
          {
            id: "effort",
            label: "Effort",
            type: "select",
            options: [{ id: "high", label: "High" }],
          },
        ],
      }),
      undefined,
    ],
    ["keeps nothing when the model's options are unknown", picked("custom", null), undefined],
  ])("%s", (_label, next, options) => {
    expect(pickModelKeepingOptions(current, next).options).toEqual(options);
  });

  it("starts without options when nothing was set", () => {
    expect(pickModelKeepingOptions(null, picked("sonnet"))).toEqual({
      instanceId: claude,
      model: "sonnet",
    });
  });
});
