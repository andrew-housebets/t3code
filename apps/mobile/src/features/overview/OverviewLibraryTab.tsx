import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { visibleLibraryRows } from "@t3tools/client-runtime/state/project-library";
import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  PROJECT_LIBRARY_UPLOAD_MAX_BYTES,
  type ProjectArtifact,
  type ProjectArtifactListing,
  type ThreadId,
} from "@t3tools/contracts";
import { htmlRenderFileName } from "@t3tools/shared/htmlRender";
import { useNavigation } from "@react-navigation/native";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { Menu } from "../../components/ui/Menu";
import { prepareTurnAttachments } from "../../lib/attachmentUpload";
import { useNowMinuteMs } from "../../lib/clock";
import { pickComposerFiles, type DraftComposerAttachment } from "../../lib/composerImages";
import { relativeTime } from "../../lib/time";
import { useThreadShell } from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
import type { EnvironmentQueryView } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import type { OverviewTarget } from "./overviewState";

const errorTag = (error: unknown) =>
  typeof error === "object" && error !== null && "_tag" in error ? error._tag : null;
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : undefined);
const confirm = (request: Omit<Dialog.ConfirmDialogRequest, "onConfirm" | "onCancel">) =>
  new Promise<boolean>((resolve) =>
    Dialog.confirm({ ...request, onConfirm: () => resolve(true), onCancel: () => resolve(false) }),
  );

type AddLibraryFile = (
  attachmentId: string,
  name: string,
  replace: boolean,
) => Promise<AtomCommandResult<unknown, unknown>>;

/** Uploads the file, then moves it into the Library; a taken name asks to replace it. */
async function addLibraryFile(
  environmentId: OverviewTarget["environmentId"],
  file: DraftComposerAttachment,
  add: AddLibraryFile,
) {
  const fail = (detail?: string) => Dialog.alert(`Could not add ${file.name}`, detail);
  try {
    const prepared = await prepareTurnAttachments({
      environmentId,
      attachments: [file],
      supportsImageUploads: true,
    });
    const attachmentId = prepared.status === "ready" ? prepared.pendingAttachmentIds[0] : undefined;
    if (attachmentId === undefined) return;
    let result = await add(attachmentId, file.name, false);
    if (
      result._tag === "Failure" &&
      errorTag(squashAtomCommandFailure(result)) === "ProjectLibraryFileExistsError" &&
      (await confirm({
        title: `Replace ${file.name}?`,
        message: "A file with this name is already in the Library.",
        confirmText: "Replace",
        destructive: true,
      }))
    ) {
      result = await add(attachmentId, file.name, true);
    }
    if (result._tag === "Failure") fail(errorMessage(squashAtomCommandFailure(result)));
  } catch (error) {
    fail(errorMessage(error));
  }
}

export function useAddLibraryFiles(target: OverviewTarget, onAdded: () => void) {
  const allowed = useAtomValue(
    projectEnvironment.addLibraryFile.permissionAtom(target.environmentId),
  );
  const add = useAtomCommand(projectEnvironment.addLibraryFile, { reportFailure: false });
  const [adding, setAdding] = useState(false);
  const pick = async () => {
    const picked = await pickComposerFiles({
      existingCount: 0,
      maxBytes: PROJECT_LIBRARY_UPLOAD_MAX_BYTES,
    });
    if (picked.error !== null) Dialog.alert("Could not add files", picked.error);
    if (picked.files.length === 0) return;
    setAdding(true);
    for (const file of picked.files) {
      await addLibraryFile(target.environmentId, file, (attachmentId, name, replace) =>
        add({
          environmentId: target.environmentId,
          input: { projectId: target.projectId, attachmentId, name, replace },
        }),
      );
    }
    setAdding(false);
    onAdded();
  };
  return { allowed, adding, pick };
}

export function OverviewLibraryTab(props: {
  readonly target: OverviewTarget;
  readonly listing: EnvironmentQueryView<ProjectArtifactListing>;
  readonly ownerThreadId: ThreadId | null;
  readonly onClearOwner: () => void;
}) {
  const { target, listing } = props;
  const navigation = useNavigation();
  const nowMs = useNowMinuteMs();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const canRemove = useAtomValue(
    projectEnvironment.removeLibraryFile.permissionAtom(target.environmentId),
  );
  const removeFile = useAtomCommand(projectEnvironment.removeLibraryFile, { reportFailure: false });
  const ownerTitle = useThreadShell(
    props.ownerThreadId === null ? null : scopeThreadRef(target.environmentId, props.ownerThreadId),
  )?.title;
  const library = listing.data?.library ?? null;

  if (library === null) {
    return (
      <View className="flex-1 items-center justify-center gap-3 px-8">
        <Text className="text-center text-sm text-foreground-muted">
          {listing.error ?? "Loading the Library…"}
        </Text>
        {listing.error === null ? null : (
          <Button label="Retry" size="compact" onPress={listing.refresh} />
        )}
      </View>
    );
  }

  const artifacts = listing.data?.artifacts ?? [];
  const artifactById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const renders = artifacts.filter((artifact) => artifact.source === "html_render");
  const shown =
    props.ownerThreadId === null
      ? null
      : artifacts.filter((artifact) => artifact.threadId === props.ownerThreadId);

  const openFile = (path: string) =>
    navigation.navigate("ThreadFile", {
      environmentId: String(target.environmentId),
      ...(target.threadId === null ? {} : { threadId: String(target.threadId) }),
      cwd: library.path,
      path: path.split("/"),
    });
  const openArtifact = (artifact: ProjectArtifact) => {
    if (artifact.source !== "html_render") return openFile(artifact.path);
    const threadId = artifact.threadId ?? target.threadId;
    if (threadId === null) return;
    navigation.navigate("ThreadAttachment", {
      environmentId: String(target.environmentId),
      threadId: String(threadId),
      attachmentId: artifact.path,
      name: htmlRenderFileName(artifact.title),
      mimeType: "text/html",
      sizeBytes: String(Math.max(1, artifact.sizeBytes ?? 1)),
    });
  };
  const confirmRemove = (path: string) =>
    Dialog.confirm({
      title: `Remove ${path}?`,
      message: "The file is deleted from the Library.",
      confirmText: "Remove",
      destructive: true,
      onConfirm: () =>
        void removeFile({
          environmentId: target.environmentId,
          input: { projectId: target.projectId, path },
        }).then((result) => {
          if (result._tag === "Failure") {
            Dialog.alert(
              `Could not remove ${path}`,
              errorMessage(squashAtomCommandFailure(result)),
            );
          }
          listing.refresh();
        }),
    });
  const toggle = (path: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  const artifactRow = (artifact: ProjectArtifact) => (
    <LibraryRow
      key={artifact.id}
      target={target}
      icon={artifact.source === "html_render" ? "globe" : "doc"}
      name={artifact.source === "html_render" ? artifact.title : artifact.path}
      depth={0}
      artifact={artifact}
      age={artifact.updatedAt === null ? null : relativeTime(artifact.updatedAt, nowMs)}
      onPress={() => openArtifact(artifact)}
      onRemove={
        artifact.source !== "html_render" && canRemove
          ? () => confirmRemove(artifact.path)
          : undefined
      }
    />
  );

  const empty = shown === null && library.entries.length === 0 && renders.length === 0;
  return (
    <ScrollView
      className="flex-1"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerClassName="pb-8"
    >
      {shown === null ? null : (
        <View className="flex-row items-center gap-2 px-4 pb-2">
          <Text className="min-w-0 flex-1 text-sm text-foreground-muted" numberOfLines={1}>
            From {ownerTitle ?? "one thread"}: {shown.length}{" "}
            {shown.length === 1 ? "artifact" : "artifacts"}
          </Text>
          <Button label="Show all" size="compact" onPress={props.onClearOwner} />
        </View>
      )}
      {empty ? (
        <Text className="px-8 pt-10 text-center text-sm text-foreground-muted">
          Files and docs this project's threads produce appear here. Add your own with +.
        </Text>
      ) : null}
      {shown?.map(artifactRow)}
      {shown !== null
        ? null
        : visibleLibraryRows(library.entries, expanded).map(({ entry, name, depth }) => {
            const folder = entry.kind === "directory";
            return (
              <LibraryRow
                key={entry.path}
                target={target}
                icon={folder ? "folder" : "doc"}
                name={name}
                depth={depth}
                folder={folder ? { open: expanded.has(entry.path) } : undefined}
                artifact={folder ? undefined : artifactById.get(`file:${entry.path}`)}
                age={entry.modifiedAt === null ? null : relativeTime(entry.modifiedAt, nowMs)}
                onPress={() => (folder ? toggle(entry.path) : openFile(entry.path))}
                onRemove={!folder && canRemove ? () => confirmRemove(entry.path) : undefined}
              />
            );
          })}
      {shown === null ? renders.map(artifactRow) : null}
      {library.truncated ? (
        <Text className="px-4 pt-3 text-xs text-foreground-muted">More files not shown.</Text>
      ) : null}
    </ScrollView>
  );
}

function LibraryRow(props: {
  readonly target: OverviewTarget;
  readonly icon: "folder" | "doc" | "globe";
  readonly name: string;
  readonly depth: number;
  readonly folder?: { readonly open: boolean } | undefined;
  readonly artifact: ProjectArtifact | undefined;
  readonly age: string | null;
  readonly onPress: () => void;
  readonly onRemove: (() => void) | undefined;
}) {
  const owner = useThreadShell(
    props.artifact?.threadId == null
      ? null
      : scopeThreadRef(props.target.environmentId, props.artifact.threadId),
  );
  const ownerLabel = props.artifact?.source === "upload" ? "You" : (owner?.title ?? null);
  const detail = [ownerLabel, props.age].filter(Boolean).join(" · ");
  const row = (
    <Pressable
      accessibilityRole="button"
      accessibilityState={props.folder ? { expanded: props.folder.open } : undefined}
      onPress={props.onPress}
      className="flex-row items-center gap-3 py-2.5 pr-4 active:bg-subtle"
      style={{ paddingLeft: 16 + props.depth * 20 }}
    >
      <View className="w-3 items-center">
        {props.folder ? (
          <SymbolView
            name={props.folder.open ? "chevron.down" : "chevron.right"}
            size={11}
            tintColorClassName="accent-icon-muted"
          />
        ) : null}
      </View>
      <SymbolView name={props.icon} size={18} tintColorClassName="accent-icon-muted" />
      <View className="min-w-0 flex-1">
        <Text className="text-base text-foreground" numberOfLines={1}>
          {props.name}
        </Text>
        {detail === "" ? null : (
          <Text className="text-xs text-foreground-muted" numberOfLines={1}>
            {detail}
          </Text>
        )}
      </View>
    </Pressable>
  );
  if (props.onRemove === undefined) return row;
  const onRemove = props.onRemove;
  return (
    <Menu
      shouldOpenOnLongPress
      title={props.name}
      actions={[{ id: "remove", title: "Remove from Library", attributes: { destructive: true } }]}
      onPressAction={({ nativeEvent }) => {
        if (nativeEvent.event === "remove") onRemove();
      }}
    >
      {row}
    </Menu>
  );
}
