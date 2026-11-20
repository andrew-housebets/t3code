import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { PinnedProject } from "@t3tools/client-runtime/state/pinned-projects";
import { useGT } from "gt-react";
import { CalendarClockIcon, LibraryIcon, type LucideIcon } from "lucide-react";

import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { ProjectFavicon } from "../ProjectFavicon";

const ROW_CLASS_NAME =
  "flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm font-medium outline-hidden hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

function NavRow(props: { row: string; label: string; Icon: LucideIcon; onClick: () => void }) {
  return (
    <button
      type="button"
      data-sidebar-nav-row={props.row}
      onClick={props.onClick}
      className={`${ROW_CLASS_NAME} text-sidebar-muted-foreground`}
    >
      <props.Icon aria-hidden className="size-4 shrink-0 text-(--sidebar-icon-color)" />
      {props.label}
    </button>
  );
}

/** Artifacts opens the current thread's project Library; it hides when no thread is open. */
export function SidebarNavRows(props: {
  onOpenArtifacts: (() => void) | null;
  onOpenScheduled: () => void;
}) {
  const gt = useGT();
  return (
    <nav data-sidebar-nav aria-label={gt("Project pages")} className="mt-1 flex flex-col gap-px">
      {props.onOpenArtifacts === null ? null : (
        <NavRow
          row="artifacts"
          label={gt("Artifacts")}
          Icon={LibraryIcon}
          onClick={props.onOpenArtifacts}
        />
      )}
      <NavRow
        row="scheduled"
        label={gt("Scheduled", { $context: "sidebar link to scheduled tasks" })}
        Icon={CalendarClockIcon}
        onClick={props.onOpenScheduled}
      />
    </nav>
  );
}

export function SidebarPinnedProjects(props: {
  entries: ReadonlyArray<PinnedProject<SidebarProjectSnapshot>>;
  activeThreadKey: string | null;
  onOpen: (entry: PinnedProject<SidebarProjectSnapshot>) => void;
  onContextMenu: (group: SidebarProjectSnapshot, position: { x: number; y: number }) => void;
}) {
  const gt = useGT();
  if (props.entries.length === 0) return null;
  return (
    <section
      data-sidebar-pinned-projects
      aria-labelledby="sidebar-pinned-projects-label"
      className="mb-2 flex flex-col gap-px"
    >
      <h2
        id="sidebar-pinned-projects-label"
        data-sidebar-pinned-projects-label
        className="px-2 pt-1 pb-1 text-xs font-medium text-sidebar-muted-foreground"
      >
        {gt("Pinned", { $context: "sidebar section" })}
      </h2>
      {props.entries.map((entry) => {
        const { group, coordinator, needsYou } = entry;
        const active =
          coordinator !== null && props.activeThreadKey === scopedThreadKey(coordinator);
        return (
          <button
            key={group.projectKey}
            type="button"
            data-sidebar-pinned-project={group.projectKey}
            data-needs-you={needsYou || undefined}
            aria-current={active ? "page" : undefined}
            onClick={() => props.onOpen(entry)}
            onContextMenu={(event) => {
              event.preventDefault();
              props.onContextMenu(group, { x: event.clientX, y: event.clientY });
            }}
            className={`${ROW_CLASS_NAME} text-sidebar-foreground/90 aria-[current=page]:bg-sidebar-row-active`}
          >
            <ProjectFavicon project={group} className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{group.displayName}</span>
            {needsYou ? (
              <span className="size-1.5 shrink-0 rounded-full bg-warning">
                <span className="sr-only">
                  {gt(", needs you", { $context: "screen reader suffix after a project name" })}
                </span>
              </span>
            ) : null}
          </button>
        );
      })}
    </section>
  );
}
