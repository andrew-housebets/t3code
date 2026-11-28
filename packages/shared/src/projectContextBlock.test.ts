import { describe, expect, it } from "vite-plus/test";

import { formatProjectContextBlock, splitProjectContextBlock } from "./projectContextBlock.ts";

describe("splitProjectContextBlock", () => {
  it.each([
    {
      name: "a formatted block",
      text: formatProjectContextBlock("## Standing instructions\n\nUse pnpm.", "Fix the test."),
      expected: { context: "## Standing instructions\n\nUse pnpm.", task: "Fix the test." },
    },
    {
      name: "a task holding its own separators",
      text: formatProjectContextBlock("Memory", "Step one\n\n---\n\nStep two"),
      expected: { context: "Memory", task: "Step one\n\n---\n\nStep two" },
    },
    {
      name: "context holding a separator before the close",
      text: formatProjectContextBlock("a\n\n---\n\nb", "Task"),
      expected: { context: "a\n\n---\n\nb", task: "Task" },
    },
    {
      name: "no block",
      text: "Fix the test.",
      expected: { context: null, task: "Fix the test." },
    },
    {
      name: "an unterminated block",
      text: "<project_context>\nInstructions\n\n---\n\nFix the test.",
      expected: {
        context: null,
        task: "<project_context>\nInstructions\n\n---\n\nFix the test.",
      },
    },
    {
      name: "a block quoted mid-message",
      text: `Look:\n${formatProjectContextBlock("x", "y")}`,
      expected: { context: null, task: `Look:\n${formatProjectContextBlock("x", "y")}` },
    },
  ])("splits $name", ({ text, expected }) => {
    expect(splitProjectContextBlock(text)).toEqual(expected);
  });
});
