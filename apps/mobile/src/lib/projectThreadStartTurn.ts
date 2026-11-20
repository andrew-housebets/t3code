import {
  CommandId,
  MessageId,
  ThreadId,
  type ChatAttachment,
  type ModelSelection,
  type OrchestrationMessageContext,
  type ProjectId,
  type ProviderInteractionMode,
  type RuntimeMode,
} from "@t3tools/contracts";
import {
  deriveThreadTitleSeed,
  threadTitleTextFromPrompt,
} from "@t3tools/client-runtime/operations";
import { msg } from "gt-react-native";

import { COORDINATOR_THREAD_TAG, isCoordinatorThread } from "@t3tools/shared/coordinatorThread";

import { m } from "../i18n/messages";
import type { UploadedMobileAttachment } from "./attachmentUpload";

export interface ProjectThreadStartTurnSpec {
  readonly projectId: ProjectId;
  readonly projectCwd: string;
  readonly threadId: string;
  readonly commandId: string;
  readonly messageId: string;
  readonly createdAt: string;
  readonly text: string;
  readonly titleText?: string;
  readonly context?: OrchestrationMessageContext;
  readonly uploadedAttachments: ReadonlyArray<UploadedMobileAttachment | ChatAttachment>;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly workspaceMode: "local" | "worktree";
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly startFromOrigin: boolean;
  readonly worktreeBranchName: string;
  readonly tags?: ReadonlyArray<string> | undefined;
}

/** A server that predates launch tags starts the thread untagged; the client then tags it itself. */
export function launchDroppedCoordinatorTag(
  requestedTags: ReadonlyArray<string> | undefined,
  launched:
    | { readonly sequence: number }
    | { readonly projection: { readonly thread: { readonly tags?: ReadonlyArray<string> } } },
): boolean {
  return (
    requestedTags?.includes(COORDINATOR_THREAD_TAG) === true &&
    !("projection" in launched && isCoordinatorThread(launched.projection.thread))
  );
}

export function buildProjectThreadStartTurnInput(spec: ProjectThreadStartTurnSpec) {
  const title = deriveThreadTitleSeed(
    { text: spec.titleText ?? spec.text, attachments: spec.uploadedAttachments },
    m,
  );
  const isWorktree = spec.workspaceMode === "worktree";
  return {
    commandId: CommandId.make(spec.commandId),
    creationSource: "mobile" as const,
    threadId: ThreadId.make(spec.threadId),
    message: {
      messageId: MessageId.make(spec.messageId),
      role: "user" as const,
      text: spec.text,
      ...(spec.context ? { context: spec.context } : {}),
      attachments: spec.uploadedAttachments,
    },
    modelSelection: spec.modelSelection,
    titleSeed: title,
    runtimeMode: spec.runtimeMode,
    interactionMode: spec.interactionMode,
    bootstrap: {
      ...(spec.tags !== undefined && spec.tags.length > 0 ? { tags: [...spec.tags] } : {}),
      createThread: {
        projectId: spec.projectId,
        title,
        modelSelection: spec.modelSelection,
        runtimeMode: spec.runtimeMode,
        interactionMode: spec.interactionMode,
        branch: spec.branch,
        worktreePath: isWorktree ? null : spec.worktreePath,
        createdAt: spec.createdAt,
      },
      ...(isWorktree
        ? {
            prepareWorktree: {
              projectCwd: spec.projectCwd,
              baseBranch: spec.branch!,
              branch: spec.worktreeBranchName,
              ...(spec.startFromOrigin ? { startFromOrigin: true } : {}),
            },
            runSetupScript: true,
          }
        : {}),
    },
    createdAt: spec.createdAt,
  };
}

export function deriveThreadTitleFromPrompt(value: string): string {
  const title = threadTitleTextFromPrompt(value, m) || m(msg("New thread"));
  return title.length <= 72 ? title : `${title.slice(0, 69).trimEnd()}...`;
}
