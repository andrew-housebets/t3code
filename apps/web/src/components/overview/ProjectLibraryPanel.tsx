import type { ScopedThreadRef } from "@t3tools/contracts";
import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import { useClientSettings } from "../../hooks/useSettings";
import { formatBytes } from "../../lib/formatBytes";
import { cn } from "../../lib/utils";
import { useRightPanelStore } from "../../rightPanelStore";
import { useQuietThreadShell } from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
import { useEnvironmentQuery } from "../../state/query";
import { formatDayAwareTimestamp } from "../../timestampFormat";
import { joinHostPath } from "../files/filePath";
import { PierreEntryIcon } from "../chat/PierreEntryIcon";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { useTheme } from "../../hooks/useTheme";
import { visibleLibraryRows } from "./projectLibrary.logic";

function PanelMessage(props: { readonly children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      {props.children}
    </div>
  );
}

export function ProjectLibraryPanel({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const projectId = useQuietThreadShell(threadRef)?.projectId ?? null;
  const library = useEnvironmentQuery(
    projectId === null
      ? null
      : projectEnvironment.listLibrary({
          environmentId: threadRef.environmentId,
          input: { projectId },
        }),
  );
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const { resolvedTheme } = useTheme();
  const listing = library.data;

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
  if (listing.entries.length === 0) {
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
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Date modified</TableHead>
              <TableHead>Size</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleLibraryRows(listing.entries, expanded).map(({ entry, name, depth }) => {
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
                    <span className="text-muted-foreground">
                      {entry.modifiedAt === null
                        ? ""
                        : formatDayAwareTimestamp(entry.modifiedAt, timestampFormat)}
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
