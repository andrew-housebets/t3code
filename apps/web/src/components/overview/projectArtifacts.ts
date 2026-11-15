import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ProjectArtifact, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { htmlRenderFileName } from "@t3tools/shared/htmlRender";

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
