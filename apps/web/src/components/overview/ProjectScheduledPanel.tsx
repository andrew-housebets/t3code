import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { ScheduledTask, ScopedThreadRef } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";

import { useClientSettings } from "../../hooks/useSettings";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useQuietThreadShell } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { scheduleLabel } from "../settings/scheduledTasksSettings.logic";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import { stackedThreadToast, toastManager } from "../ui/toast";

function PanelMessage(props: { readonly children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      {props.children}
    </div>
  );
}

function ScheduledTaskRow(props: {
  readonly threadRef: ScopedThreadRef;
  readonly task: ScheduledTask;
  readonly timeZone: string | undefined;
  readonly nowMs: number;
}) {
  const { task, threadRef } = props;
  const { environmentId } = threadRef;
  const canOperate = useAtomValue(
    serverEnvironment.setScheduledTaskEnabled.permissionAtom(environmentId),
  );
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const setEnabled = useAtomCommand(serverEnvironment.setScheduledTaskEnabled, {
    label: "scheduled task enabled",
  });
  const toggle = async () => {
    const result = await setEnabled({
      environmentId,
      input: { id: task.id, enabled: !task.enabled },
    });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not update scheduled task",
          description: error instanceof Error ? error.message : undefined,
        }),
      );
    }
  };
  const next =
    task.blockedByPolicy ??
    (!task.enabled
      ? "Paused"
      : task.schedule.type === "webhook"
        ? "Listening"
        : task.nextRunAt === null
          ? "Not scheduled"
          : `Next ${formatUpcomingTimestamp(task.nextRunAt, timestampFormat, props.nowMs, props.timeZone)}`);
  return (
    <li data-project-scheduled-row className="flex items-center gap-3 px-3 py-2">
      <span className="flex min-w-0 flex-1 flex-col">
        <Link
          to="/settings/scheduled-tasks"
          search={{ environmentId, taskId: task.id }}
          className="truncate text-sm font-medium text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          {task.title}
        </Link>
        <span className="truncate text-xs text-muted-foreground">
          {scheduleLabel(task.schedule, props.timeZone, task.nextRunAt)} · {next}
        </span>
      </span>
      <Switch
        checked={task.enabled}
        disabled={!canOperate}
        aria-label={`${task.enabled ? "Pause" : "Resume"} ${task.title}`}
        onCheckedChange={() => void toggle()}
      />
    </li>
  );
}

export function ProjectScheduledPanel({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const projectId = useQuietThreadShell(threadRef)?.projectId ?? null;
  const tasksQuery = useEnvironmentQuery(
    serverEnvironment.scheduledTasksLive({ environmentId: threadRef.environmentId, input: {} }),
  );
  const nowMs = Date.parse(`${useNowMinute()}Z`);
  const data = tasksQuery.data;

  if (data === null) {
    return (
      <PanelMessage>
        {tasksQuery.error === null ? (
          <Spinner size="sm" />
        ) : (
          <>
            <p className="text-xs text-muted-foreground">{tasksQuery.error}</p>
            <Button size="sm" variant="outline" onClick={() => tasksQuery.refresh()}>
              Retry
            </Button>
          </>
        )}
      </PanelMessage>
    );
  }
  const tasks = data.tasks.filter((task) => task.projectId === projectId);
  if (tasks.length === 0) {
    return (
      <PanelMessage>
        <p className="max-w-60 text-xs text-muted-foreground">
          Ask in the project conversation to put recurring work on a schedule.
        </p>
      </PanelMessage>
    );
  }
  return (
    <ul
      data-project-scheduled
      className="m-0 h-full min-h-0 list-none overflow-y-auto overscroll-contain p-0 py-1"
    >
      {tasks.map((task) => (
        <ScheduledTaskRow
          key={task.id}
          threadRef={threadRef}
          task={task}
          timeZone={data.timeZone}
          nowMs={nowMs}
        />
      ))}
    </ul>
  );
}
