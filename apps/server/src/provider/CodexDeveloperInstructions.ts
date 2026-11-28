import type { AgentFeedbackMode } from "@t3tools/contracts";
import type { V2TurnStartParams__AdditionalContextEntry } from "effect-codex-app-server/schema";
import { T3_CODE_COORDINATOR_INSTRUCTIONS } from "@t3tools/provider-core/server/coordinatorInstructions";
import { buildRuntimeInstructions } from "@t3tools/provider-core/server/runtimeInstructions";

import {
  T3_CODE_BROWSER_TOOL_INSTRUCTIONS,
  T3_CODE_DEVICE_TOOL_INSTRUCTIONS,
  t3CodeOrchestrationSections,
} from "@t3tools/provider-core/server/orchestrationInstructions";

/** Codex silently truncates additionalContext values over 1,000 tokens, counted as UTF-8 bytes / 4. */
export const CODEX_ADDITIONAL_CONTEXT_VALUE_MAX_BYTES = 4_000;

export interface T3CodeToolAvailability {
  readonly browser: boolean;
  readonly device: boolean;
  readonly nativeSubagents?: boolean;
}

const normalizeAvailability = (
  availability: boolean | T3CodeToolAvailability,
): T3CodeToolAvailability =>
  typeof availability === "boolean" ? { browser: availability, device: false } : availability;

/** Instructions for unavailable tools would steer the model away from its remaining automation. */
const toolInstructions = (tools: T3CodeToolAvailability): string =>
  [
    tools.browser ? T3_CODE_BROWSER_TOOL_INSTRUCTIONS : "",
    tools.device ? T3_CODE_DEVICE_TOOL_INSTRUCTIONS : "",
  ]
    .filter(Boolean)
    .join("\n\n");

/** Line-aligned pieces within Codex's per-entry cap; a longer line splits between code points. */
function splitCodexContextValue(text: string): ReadonlyArray<string> {
  const max = CODEX_ADDITIONAL_CONTEXT_VALUE_MAX_BYTES;
  const pieces: Array<string> = [];
  let current = "";
  let currentBytes = 0;
  const flush = () => {
    if (current !== "") pieces.push(current);
    current = "";
    currentBytes = 0;
  };
  for (const line of text.split(/(?<=\n)/)) {
    const lineBytes = Buffer.byteLength(line, "utf8");
    if (currentBytes + lineBytes > max) flush();
    if (lineBytes <= max) {
      current += line;
      currentBytes += lineBytes;
      continue;
    }
    for (const char of line) {
      const charBytes = Buffer.byteLength(char, "utf8");
      if (currentBytes + charBytes > max) flush();
      current += char;
      currentBytes += charBytes;
    }
  }
  flush();
  return pieces;
}

export interface CodexRuntimeInfo {
  readonly agentFeedback?: AgentFeedbackMode;
  readonly model: string;
  readonly modelName?: string | undefined;
  readonly reasoningEffort?: string | undefined;
}

/** Keep this outside collaboration mode; model-catalog mode text overrides client developer_instructions. */
export function buildCodexAdditionalContext(
  runtime: CodexRuntimeInfo,
  toolsAvailable: boolean | T3CodeToolAvailability = true,
  coordinator = false,
  projectContext?: string,
): Record<string, V2TurnStartParams__AdditionalContextEntry> {
  const availability = normalizeAvailability(toolsAvailable);
  const tools = toolInstructions(availability);
  // Split values to fit per-entry caps; number keys because Codex emits them in key order.
  return {
    ...Object.fromEntries(
      t3CodeOrchestrationSections(availability.nativeSubagents).map((section, index) => [
        `t3_code_orchestration_${String(index + 1).padStart(2, "0")}`,
        { kind: "application" as const, value: section },
      ]),
    ),
    t3_code_runtime: {
      kind: "application",
      value: buildRuntimeInstructions({ harness: "Codex", ...runtime }),
    },
    ...(tools ? { t3_code_tools: { kind: "application", value: tools } } : {}),
    ...(coordinator
      ? {
          t3_code_coordinator: {
            kind: "application",
            value: T3_CODE_COORDINATOR_INSTRUCTIONS,
          },
        }
      : {}),
    // User- and agent-written text, so it carries a user's authority, not the application's.
    ...(coordinator && projectContext !== undefined
      ? Object.fromEntries(
          splitCodexContextValue(projectContext).map((value, index) => [
            `t3_code_project_context_${String(index + 1).padStart(2, "0")}`,
            { kind: "untrusted" as const, value },
          ]),
        )
      : {}),
  };
}
