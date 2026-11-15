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
): ClaudeAgentSdkQueryOptions {
  if (!isCoordinatorThread(appThread)) return options;
  const locked = {
    ...options,
    disallowedTools: union(options.disallowedTools, CLAUDE_COORDINATOR_DISALLOWED_TOOLS),
  };
  const systemPrompt = options.systemPrompt;
  if (
    options.mcpServers === undefined ||
    typeof systemPrompt !== "object" ||
    Array.isArray(systemPrompt) ||
    systemPrompt.type !== "preset"
  ) {
    return locked;
  }
  return {
    ...locked,
    allowedTools: union(options.allowedTools, CLAUDE_COORDINATOR_T3_MCP_ALLOWED_TOOLS),
    systemPrompt: {
      ...systemPrompt,
      append: `${systemPrompt.append ?? ""}\n\n${T3_CODE_COORDINATOR_INSTRUCTIONS}\n`,
    },
  };
}
