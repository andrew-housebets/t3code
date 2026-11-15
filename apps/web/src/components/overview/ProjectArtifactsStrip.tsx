import type { ProjectArtifact } from "@t3tools/contracts";
import { FileTextIcon, GlobeIcon } from "lucide-react";

import { formatRelativeTime } from "../../timestampFormat";

const TILE =
  "flex h-20 min-w-0 flex-col justify-between rounded-md border bg-card p-2 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring";

export function ProjectArtifactsStrip(props: {
  readonly artifacts: ReadonlyArray<ProjectArtifact>;
  readonly nowMs: number;
  readonly onOpen: (artifact: ProjectArtifact) => void;
  readonly onViewAll: () => void;
}) {
  return (
    <section aria-labelledby="thread-overview-artifacts" className="px-3 pt-1 pb-2">
      <h3
        id="thread-overview-artifacts"
        className="m-0 py-1.5 text-xs font-medium text-muted-foreground"
      >
        Artifacts
      </h3>
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2 p-0">
        {props.artifacts.map((artifact) => {
          const Glyph = artifact.source === "html_render" ? GlobeIcon : FileTextIcon;
          const age =
            artifact.updatedAt === null
              ? null
              : formatRelativeTime(artifact.updatedAt, props.nowMs)?.value;
          return (
            <li key={artifact.id} className="min-w-0">
              <button
                type="button"
                data-thread-overview-artifact={artifact.source}
                onClick={() => props.onOpen(artifact)}
                className={`${TILE} w-full`}
              >
                <Glyph aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span className="flex min-w-0 items-end gap-1">
                  <span className="line-clamp-2 min-w-0 flex-1 text-xs text-foreground [overflow-wrap:anywhere]">
                    {artifact.title}
                  </span>
                  {age ? (
                    <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
                      {age}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
        <li className="min-w-0">
          <button
            type="button"
            data-thread-overview-artifact="view-all"
            onClick={props.onViewAll}
            className={`${TILE} w-full items-center justify-center text-xs text-muted-foreground`}
          >
            View all
          </button>
        </li>
      </ul>
    </section>
  );
}
