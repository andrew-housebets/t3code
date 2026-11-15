import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ProjectArtifact, ScopedThreadRef } from "@t3tools/contracts";
import { ChevronRightIcon, GlobeIcon } from "lucide-react";
import { useState } from "react";

import { useClientSettings } from "../../hooks/useSettings";
import { formatBytes } from "../../lib/formatBytes";
import { cn } from "../../lib/utils";
import { useRightPanelStore } from "../../rightPanelStore";
import { useQuietThreadShell } from "../../state/entities";
import { formatDayAwareTimestamp } from "../../timestampFormat";
import { joinHostPath } from "../files/filePath";
import { PierreEntryIcon } from "../chat/PierreEntryIcon";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { useTheme } from "../../hooks/useTheme";
import { useCoordinatorStore } from "./coordinatorStore";
import { openProjectArtifact, useProjectArtifacts } from "./projectArtifacts";
import { visibleLibraryRows } from "./projectLibrary.logic";

function ArtifactOwner(props: {
  readonly threadRef: ScopedThreadRef;
  readonly artifact: ProjectArtifact | undefined;
}) {
  const { artifact } = props;
  const owner = useQuietThreadShell(
    artifact?.threadId == null
      ? null
      : scopeThreadRef(props.threadRef.environmentId, artifact.threadId),
  );
  const label = artifact?.source === "upload" ? "You" : (owner?.title ?? "");
  return <span className="block max-w-40 truncate text-muted-foreground">{label}</span>;
}

function PanelMessage(props: { readonly children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      {props.children}
    </div>
  );
}

export function ProjectLibraryPanel({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const library = useProjectArtifacts(threadRef);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const { resolvedTheme } = useTheme();
  const threadKey = scopedThreadKey(threadRef);
  const filterThreadId = useCoordinatorStore((state) => state.libraryFilters[threadKey] ?? null);
  const filterTitle = useQuietThreadShell(
    filterThreadId === null ? null : scopeThreadRef(threadRef.environmentId, filterThreadId),
  )?.title;
  const setLibraryFilter = useCoordinatorStore((state) => state.setLibraryFilter);
  const listing = library.data?.library ?? null;
  const artifacts = library.data?.artifacts ?? [];

  if (listing === null) {
    return (
      <PanelMessage>
        {library.error === null ? (
          <Spinner size="sm" />
        ) : (
          <>
            <p className="text-xs text-muted-foreground">{library.error}</p>
            <Button size="sm" variant="outline" onClick={() => library.refresh()}>
              Retry
            </Button>
          </>
        )}
      </PanelMessage>
    );
  }
  const artifactById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const renders = artifacts.filter((artifact) => artifact.source === "html_render");
  const shown =
    filterThreadId === null
      ? null
      : artifacts.filter((artifact) => artifact.threadId === filterThreadId);
  const formatDate = (value: string | null) =>
    value === null ? "" : formatDayAwareTimestamp(value, timestampFormat);
  const artifactRow = (artifact: ProjectArtifact) => (
    <TableRow key={artifact.id} data-project-library-row data-kind={artifact.source}>
      <TableCell>
        <button
          type="button"
          onClick={() => openProjectArtifact(threadRef, listing.path, artifact)}
          className="flex min-w-0 max-w-full items-center gap-1.5 text-left text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          {artifact.source === "html_render" ? (
            <GlobeIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <PierreEntryIcon pathValue={artifact.title} kind="file" theme={resolvedTheme} />
          )}
          <span className="truncate">
            {artifact.source === "html_render" ? artifact.title : artifact.path}
          </span>
        </button>
      </TableCell>
      <TableCell>
        <ArtifactOwner threadRef={threadRef} artifact={artifact} />
      </TableCell>
      <TableCell>
        <span className="text-muted-foreground">{formatDate(artifact.updatedAt)}</span>
      </TableCell>
      <TableCell>
        <span className="tabular-nums text-muted-foreground">
          {artifact.sizeBytes === null ? "" : formatBytes(artifact.sizeBytes)}
        </span>
      </TableCell>
    </TableRow>
  );

  if (shown === null && listing.entries.length === 0 && renders.length === 0) {
    return (
      <PanelMessage>
        <p className="max-w-60 text-xs text-muted-foreground">
          Files and docs this project's threads produce appear here.
        </p>
      </PanelMessage>
    );
  }

  const fileCount = listing.entries.filter((entry) => entry.kind === "file").length;
  const toggle = (path: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  return (
    <div data-project-library className="flex h-full min-h-0 flex-col">
      {shown === null ? null : (
        <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">
            From {filterTitle ?? "one thread"}: {shown.length}{" "}
            {shown.length === 1 ? "artifact" : "artifacts"}
          </span>
          <Button size="xs" variant="ghost-muted" onClick={() => setLibraryFilter(threadKey, null)}>
            Show all
          </Button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Date modified</TableHead>
              <TableHead>Size</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown?.map(artifactRow)}
            {shown !== null
              ? null
              : visibleLibraryRows(listing.entries, expanded).map(({ entry, name, depth }) => {
                  const folder = entry.kind === "directory";
                  const open = folder && expanded.has(entry.path);
                  return (
                    <TableRow key={entry.path} data-project-library-row data-kind={entry.kind}>
                      <TableCell>
                        <button
                          type="button"
                          aria-expanded={folder ? open : undefined}
                          onClick={() =>
                            folder
                              ? toggle(entry.path)
                              : useRightPanelStore
                                  .getState()
                                  .openFile(threadRef, joinHostPath(listing.path, entry.path))
                          }
                          style={{ paddingInlineStart: `${depth * 1}rem` }}
                          className="flex min-w-0 max-w-full items-center gap-1.5 text-left text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                        >
                          <ChevronRightIcon
                            aria-hidden
                            className={cn(
                              "size-3 shrink-0 text-muted-foreground transition-transform",
                              !folder && "invisible",
                              open && "rotate-90",
                            )}
                          />
                          <PierreEntryIcon
                            pathValue={name}
                            kind={folder ? "directory" : "file"}
                            theme={resolvedTheme}
                          />
                          <span className="truncate">{name}</span>
                        </button>
                      </TableCell>
                      <TableCell>
                        {folder ? null : (
                          <ArtifactOwner
                            threadRef={threadRef}
                            artifact={artifactById.get(`file:${entry.path}`)}
                          />
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="text-muted-foreground">
                          {formatDate(entry.modifiedAt)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="tabular-nums text-muted-foreground">
                          {entry.sizeBytes === null ? "" : formatBytes(entry.sizeBytes)}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
            {shown === null ? renders.map(artifactRow) : null}
          </TableBody>
        </Table>
      </div>
      <p className="m-0 border-t px-3 py-2 text-xs text-muted-foreground">
        {fileCount} {fileCount === 1 ? "file" : "files"}
        {listing.truncated ? ", more not shown" : ""}
      </p>
    </div>
  );
}
