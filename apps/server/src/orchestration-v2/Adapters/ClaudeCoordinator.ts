import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { OrchestrationV2AppThread } from "@t3tools/contracts";
import { T3_CODE_COORDINATOR_INSTRUCTIONS } from "@t3tools/provider-core/server/coordinatorInstructions";
import { isCoordinatorThread } from "@t3tools/shared/coordinatorThread";

import type { ClaudeAgentSdkQueryOptions } from "./ClaudeAdapterV2.ts";

// A launch argument can reopen the permission mode; these stay off regardless.
const CLAUDE_COORDINATOR_DISALLOWED_TOOLS = ["Edit", "Write", "NotebookEdit", "Bash"];

const CLAUDE_COORDINATOR_T3_MCP_ALLOWED_TOOLS = [
  "mcp__t3-code__orchestrator_capabilities",
  "mcp__t3-code__delegate_task",
  "mcp__t3-code__task_status",
  "mcp__t3-code__task_cancel",
  "mcp__t3-code__t3_thread_read",
  "mcp__t3-code__t3_thread_send",
  "mcp__t3-code__t3_pending_request",
  "mcp__t3-code__t3_thread_list",
];

const union = (left: ReadonlyArray<string> | undefined, right: ReadonlyArray<string>) =>
  Array.from(new Set([...(left ?? []), ...right]));

export function withClaudeCoordinatorOptions(
  appThread: Pick<OrchestrationV2AppThread, "tags">,
  options: ClaudeAgentSdkQueryOptions,
  projectContext?: string,
): ClaudeAgentSdkQueryOptions {
  if (!isCoordinatorThread(appThread)) return options;
  const systemPrompt = options.systemPrompt;
  const preset =
    typeof systemPrompt === "object" &&
    !Array.isArray(systemPrompt) &&
    systemPrompt.type === "preset"
      ? systemPrompt
      : undefined;
  const delegates = options.mcpServers !== undefined && preset !== undefined;
  const append = [
    ...(delegates ? [T3_CODE_COORDINATOR_INSTRUCTIONS] : []),
    ...(projectContext === undefined ? [] : [projectContext]),
  ];
  return {
    ...options,
    disallowedTools: union(options.disallowedTools, CLAUDE_COORDINATOR_DISALLOWED_TOOLS),
    ...(delegates
      ? { allowedTools: union(options.allowedTools, CLAUDE_COORDINATOR_T3_MCP_ALLOWED_TOOLS) }
      : {}),
    ...(preset === undefined || append.length === 0
      ? {}
      : {
          systemPrompt: { ...preset, append: `${preset.append ?? ""}\n\n${append.join("\n\n")}\n` },
        }),
  };
}

export const claudeProjectContextUpdate = (projectContext: string) =>
  `<project_context_update>\nThe project's current standing context. It replaces all earlier project context, including any in your system prompt.\n\n${projectContext}\n</project_context_update>`;

export const claudeCoordinatorBriefUpdate = (coordinator: boolean) =>
  coordinator
    ? `<coordinator_brief_update>\nThis thread is now a T3 Code coordinator. These rules apply from this turn on and win over anything earlier in this conversation.\n\n${T3_CODE_COORDINATOR_INSTRUCTIONS}\n</coordinator_brief_update>`
    : `<coordinator_brief_update>\nThis thread is no longer a T3 Code coordinator. The coordinator rules in your system prompt or earlier in this conversation no longer apply.\n</coordinator_brief_update>`;

// A resumed Claude session keeps the system prompt it was created with, so later changes go in the turn.
export function withClaudeTurnUpdates(
  message: SDKUserMessage,
  updates: ReadonlyArray<string>,
): SDKUserMessage {
  if (updates.length === 0) return message;
  const content = message.message.content;
  return {
    ...message,
    message: {
      ...message.message,
      content: [
        ...updates.map((text) => ({ type: "text" as const, text })),
        ...(typeof content === "string" ? [{ type: "text" as const, text: content }] : content),
      ],
    },
  };
}
