import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { runAttachmentUploadCycle } from "@t3tools/client-runtime/state/attachments";
import { runAtomCommand, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  PROJECT_LIBRARY_UPLOAD_MAX_BYTES,
  type EnvironmentId,
  type ProjectArtifact,
  type ProjectId,
  type ScopedThreadRef,
  type ThreadId,
} from "@t3tools/contracts";
import { htmlRenderFileName } from "@t3tools/shared/htmlRender";

import { requestConfirmDialog } from "../../confirmDialog";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { attachmentEnvironment } from "../../state/attachments";
import { readPreparedConnection } from "../../state/session";
import { stackedThreadToast, toastManager } from "../ui/toast";

import { useRightPanelStore } from "../../rightPanelStore";
import { useQuietThreadShell } from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
import { useEnvironmentQuery } from "../../state/query";
import { joinHostPath } from "../files/filePath";
import { useCoordinatorStore } from "./coordinatorStore";

/** One listing per project, shared by the Threads strip and the Library. */
export function useProjectArtifacts(threadRef: ScopedThreadRef) {
  const projectId = useQuietThreadShell(threadRef)?.projectId ?? null;
  return useEnvironmentQuery(
    projectId === null
      ? null
      : projectEnvironment.listArtifacts({
          environmentId: threadRef.environmentId,
          input: { projectId },
        }),
  );
}

export function openProjectArtifact(
  threadRef: ScopedThreadRef,
  libraryPath: string,
  artifact: ProjectArtifact,
) {
  const panels = useRightPanelStore.getState();
  if (artifact.source !== "html_render") {
    panels.openFile(threadRef, joinHostPath(libraryPath, artifact.path));
    return;
  }
  panels.openAttachment(threadRef, {
    type: "file",
    id: artifact.path,
    name: htmlRenderFileName(artifact.title),
    mimeType: "text/html",
    sizeBytes: Math.max(1, artifact.sizeBytes ?? 1),
  });
}

export function openProjectLibrary(threadRef: ScopedThreadRef, ownerThreadId: ThreadId | null) {
  useCoordinatorStore.getState().setLibraryFilter(scopedThreadKey(threadRef), ownerThreadId);
  useRightPanelStore.getState().open(threadRef, "library");
}

const confirm = async (message: string) =>
  (await requestConfirmDialog(message, { variant: "destructive" })) ?? window.confirm(message);

const failureMessage = (error: unknown) => (error instanceof Error ? error.message : undefined);

const uploadBytes = (url: string, file: File) => {
  const controller = new AbortController();
  return {
    done: fetch(url, {
      method: "POST",
      body: file,
      headers: { "Content-Type": file.type || "application/octet-stream" },
      signal: controller.signal,
    }).then((response) => {
      if (!response.ok) throw new Error(`Upload rejected (${response.status})`);
    }),
    abort: () => controller.abort(),
  };
};

/** Uploads each file, then moves it into the Library; a name already there asks to replace it. */
export async function addFilesToLibrary(
  environmentId: EnvironmentId,
  projectId: ProjectId,
  files: ReadonlyArray<File>,
): Promise<void> {
  for (const file of files) {
    const fail = (description?: string) =>
      toastManager.add(
        stackedThreadToast({ type: "error", title: `Could not add ${file.name}`, description }),
      );
    if (file.size === 0) {
      fail("The file is empty.");
      continue;
    }
    if (file.size > PROJECT_LIBRARY_UPLOAD_MAX_BYTES) {
      fail(
        `Files added to the Library can be at most ${PROJECT_LIBRARY_UPLOAD_MAX_BYTES / 1024 / 1024} MB.`,
      );
      continue;
    }
    const mimeType = file.type || "application/octet-stream";
    const uploaded = await runAttachmentUploadCycle({
      registry: appAtomRegistry,
      createUploadUrl: attachmentEnvironment.createUploadUrl,
      remove: attachmentEnvironment.remove,
      environmentId,
      upload: { type: "file", name: file.name, mimeType, sizeBytes: file.size },
      resolveUploadUrl: (relativeUrl) => {
        const connection = readPreparedConnection(environmentId);
        return connection ? resolveAssetUrl(connection.httpBaseUrl, relativeUrl) : null;
      },
      transport: (url) => uploadBytes(url, file),
    });
    if (uploaded.status !== "uploaded") {
      if (uploaded.status === "failed") fail(failureMessage(uploaded.error));
      continue;
    }
    const add = (replace: boolean) =>
      runAtomCommand(
        appAtomRegistry,
        projectEnvironment.addLibraryFile,
        {
          environmentId,
          input: { projectId, attachmentId: uploaded.attachmentId, name: file.name, replace },
        },
        { reportFailure: false },
      );
    let result = await add(false);
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      const exists =
        typeof error === "object" &&
        error !== null &&
        "_tag" in error &&
        error._tag === "ProjectLibraryFileExistsError";
      if (exists && (await confirm(`Replace ${file.name} in the Library?`)))
        result = await add(true);
    }
    if (result._tag === "Failure") fail(failureMessage(squashAtomCommandFailure(result)));
  }
}

export async function removeFromLibrary(
  environmentId: EnvironmentId,
  projectId: ProjectId,
  path: string,
): Promise<boolean> {
  if (!(await confirm(`Remove ${path} from the Library?\nThe file is deleted.`))) return false;
  const result = await runAtomCommand(
    appAtomRegistry,
    projectEnvironment.removeLibraryFile,
    { environmentId, input: { projectId, path } },
    { reportFailure: false },
  );
  if (result._tag === "Success") return true;
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title: `Could not remove ${path}`,
      description: failureMessage(squashAtomCommandFailure(result)),
    }),
  );
  return false;
}
