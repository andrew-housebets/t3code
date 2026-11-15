import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  PROJECT_CONTEXT_MAX_CHARS,
  type EnvironmentId,
  type ProjectContextFiles,
  type ProjectId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { useId, useState } from "react";

import { cn } from "../../lib/utils";
import { useQuietThreadShell } from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";
import { ProjectModelDefaultsFields } from "./ProjectModelDefaults";
import { stackedThreadToast, toastManager } from "../ui/toast";

const FIELDS = [
  {
    key: "instructions",
    label: "Instructions",
    placeholder: "How work in this project should be done: conventions, commands, review rules.",
  },
  {
    key: "memory",
    label: "Memory",
    placeholder: "What threads should know going in: decisions, links, where things live.",
  },
] as const satisfies ReadonlyArray<{
  readonly key: keyof ProjectContextFiles;
  readonly label: string;
  readonly placeholder: string;
}>;

/** Edits the standing context every delegated thread in the project starts with. */
export function ProjectInstructionsEditor(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}) {
  const { environmentId, projectId } = props;
  const saved = useEnvironmentQuery(
    projectEnvironment.readContext({ environmentId, input: { projectId } }),
  );
  const canWrite = useAtomValue(projectEnvironment.writeContext.permissionAtom(environmentId));
  const write = useAtomCommand(projectEnvironment.writeContext, { reportFailure: false });
  const [draft, setDraft] = useState<ProjectContextFiles | null>(null);
  const [saving, setSaving] = useState(false);
  const idPrefix = useId();

  if (saved.data === null) {
    return (
      <div className="flex justify-center p-6">
        {saved.error === null ? (
          <Spinner size="sm" />
        ) : (
          <p className="text-xs text-muted-foreground">{saved.error}</p>
        )}
      </div>
    );
  }
  const shown = draft ?? saved.data;
  const dirty =
    draft !== null &&
    (draft.instructions !== saved.data.instructions || draft.memory !== saved.data.memory);
  const overLimit = FIELDS.some(({ key }) => shown[key].length > PROJECT_CONTEXT_MAX_CHARS);

  const save = async () => {
    if (draft === null || overLimit) return;
    setSaving(true);
    const result = await write({ environmentId, input: { projectId, ...draft } });
    setSaving(false);
    if (result._tag === "Success") {
      saved.refresh();
      return;
    }
    if (isAtomCommandInterrupted(result)) return;
    const error = squashAtomCommandFailure(result);
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: "Could not save project instructions",
        description: error instanceof Error ? error.message : undefined,
      }),
    );
  };

  return (
    <div data-project-instructions className="flex flex-col gap-4">
      <ProjectModelDefaultsFields environmentId={environmentId} projectId={projectId} />
      {FIELDS.map(({ key, label, placeholder }) => {
        const length = shown[key].length;
        return (
          <div key={key} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <Label htmlFor={`${idPrefix}-${key}`}>{label}</Label>
              <span
                className={cn(
                  "text-xs tabular-nums",
                  length > PROJECT_CONTEXT_MAX_CHARS ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {length.toLocaleString()} / {PROJECT_CONTEXT_MAX_CHARS.toLocaleString()}
              </span>
            </div>
            <Textarea
              id={`${idPrefix}-${key}`}
              rows={8}
              value={shown[key]}
              placeholder={placeholder}
              disabled={!canWrite || saving}
              onChange={(event) => setDraft({ ...shown, [key]: event.target.value })}
            />
          </div>
        );
      })}
      <div className="flex items-center justify-between gap-2">
        <p className="m-0 text-xs text-muted-foreground">
          Changes apply to threads started afterwards.
        </p>
        {dirty ? (
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="outline" disabled={saving} onClick={() => setDraft(null)}>
              Discard
            </Button>
            <Button size="sm" disabled={saving || overLimit} onClick={() => void save()}>
              Save
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ProjectInstructionsPanel({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const projectId = useQuietThreadShell(threadRef)?.projectId ?? null;
  if (projectId === null) return null;
  return (
    <div className="h-full min-h-0 overflow-y-auto overscroll-contain p-3">
      <ProjectInstructionsEditor
        key={`${threadRef.environmentId}:${projectId}`}
        environmentId={threadRef.environmentId}
        projectId={projectId}
      />
    </div>
  );
}
