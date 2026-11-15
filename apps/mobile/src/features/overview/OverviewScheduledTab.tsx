import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { ScrollView, View } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { ThemedSwitch } from "../../components/ui/ThemedSwitch";
import { useNowMinuteMs } from "../../lib/clock";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatNextScheduledTaskRun } from "../settings/scheduledTaskPresentation";
import { describeSchedule } from "../settings/SettingsScheduledTasksRouteScreen";
import type { OverviewTarget } from "./overviewState";

export function OverviewScheduledTab({ target }: { readonly target: OverviewTarget }) {
  const { environmentId } = target;
  const tasks = useEnvironmentQuery(
    serverEnvironment.scheduledTasksLive({ environmentId, input: {} }),
  );
  const canOperate = useAtomValue(
    serverEnvironment.setScheduledTaskEnabled.permissionAtom(environmentId),
  );
  const setEnabled = useAtomCommand(serverEnvironment.setScheduledTaskEnabled, {
    reportFailure: false,
  });
  const nowMs = useNowMinuteMs();
  const projectTasks = tasks.data?.tasks.filter((task) => task.projectId === target.projectId);

  if (projectTasks === undefined) {
    return (
      <Text className="px-8 pt-10 text-center text-sm text-foreground-muted">
        {tasks.error ?? "Loading tasks…"}
      </Text>
    );
  }
  if (projectTasks.length === 0) {
    return (
      <View className="flex-1 items-center justify-center gap-3 px-10">
        <View className="size-14 items-center justify-center rounded-full bg-subtle">
          <SymbolView name="clock" size={24} tintColorClassName="accent-icon-muted" />
        </View>
        <Text className="text-center text-base text-foreground-secondary">
          No scheduled tasks yet
        </Text>
        <Text className="text-center text-sm text-foreground-muted">
          Ask in the project conversation to put recurring work on a schedule.
        </Text>
      </View>
    );
  }
  return (
    <ScrollView
      className="flex-1"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerClassName="pb-8"
    >
      {projectTasks.map((task) => (
        <View key={task.id} className="flex-row items-center gap-3 px-4 py-3">
          <View className="min-w-0 flex-1 gap-0.5">
            <Text className="text-base text-foreground" numberOfLines={1}>
              {task.title}
            </Text>
            <Text className="text-sm text-foreground-muted" numberOfLines={2}>
              {describeSchedule(task, tasks.data?.timeZone)}
              {!task.enabled
                ? " · Paused"
                : task.nextRunAt
                  ? ` · ${formatNextScheduledTaskRun(task.nextRunAt, nowMs)}`
                  : ""}
            </Text>
          </View>
          <ThemedSwitch
            accessibilityLabel={`${task.title} enabled`}
            value={task.enabled}
            disabled={!canOperate}
            onValueChange={(enabled) =>
              void setEnabled({ environmentId, input: { id: task.id, enabled } }).then((result) => {
                if (result._tag === "Failure") {
                  const error = squashAtomCommandFailure(result);
                  Dialog.alert(
                    "Could not update task",
                    error instanceof Error ? error.message : undefined,
                  );
                }
              })
            }
          />
        </View>
      ))}
    </ScrollView>
  );
}
