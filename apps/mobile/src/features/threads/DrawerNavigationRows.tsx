import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { pinnedProjects, type PinnedProject } from "@t3tools/client-runtime/state/pinned-projects";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import { useNavigation } from "@react-navigation/native";
import { useMemo, type ReactNode } from "react";
import { Pressable, View } from "react-native";

import { ProjectFavicon } from "../../components/ProjectFavicon";
import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { Menu } from "../../components/ui/Menu";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { projectEnvironment } from "../../state/projects";
import { readEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import type { HomeProjectScope } from "../home/homeThreadList";
import { useSelectWorkspaceDetail } from "../layout/workspace/useSelectWorkspaceDetail";
import { openSettings } from "../settings/settings-navigation";

type DrawerPinnedProject = PinnedProject<HomeProjectScope>;

function DrawerRow(props: {
  readonly label: string;
  readonly icon: ReactNode;
  readonly onPress: () => void;
  readonly attention?: boolean;
  readonly accessibilityHint?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        props.attention ? `${props.label}, a thread is waiting on you` : props.label
      }
      accessibilityHint={props.accessibilityHint}
      onPress={props.onPress}
      className="min-h-12 flex-row items-center gap-3.5 rounded-xl px-3 active:bg-thread-hover"
    >
      <View className="w-6 items-center">{props.icon}</View>
      <Text className="min-w-0 flex-1 text-base text-drawer-foreground" numberOfLines={1}>
        {props.label}
      </Text>
      {props.attention ? <View className="size-2 rounded-full bg-warning-foreground" /> : null}
    </Pressable>
  );
}

const PINNED_PROJECT_ACTIONS = [{ id: "unpin", title: "Unpin project", image: "pin.slash" }];

/** Writes to every checkout of the project, stopping at the first failure, as Settings does. */
function useUnpinProject() {
  const updateProject = useAtomCommand(projectEnvironment.update, {
    label: "project update",
    reportFailure: false,
  });
  return async (scope: HomeProjectScope) => {
    for (const project of scope.projects) {
      if (project.pinnedAt === null) continue;
      if (!readEnvironmentScope(project.environmentId, AuthOrchestrationOperateScope)) {
        Dialog.alert("Failed to unpin project", "This connection cannot change it.");
        return;
      }
      const result = await updateProject({
        environmentId: project.environmentId,
        input: { projectId: project.id, pinned: false },
      });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          Dialog.alert(
            "Failed to unpin project",
            error instanceof Error ? error.message : "An error occurred.",
          );
        }
        return;
      }
    }
  };
}

const glyph = (name: AppSymbolName) => (
  <SymbolView name={name} size={20} tintColorClassName="accent-drawer-foreground" />
);

export function DrawerSectionLabel({ label }: { readonly label: string }) {
  return (
    <Text
      className="px-3 pb-1 pt-4 text-sm text-drawer-foreground-muted"
      accessibilityRole="header"
    >
      {label}
    </Text>
  );
}

/** The thread list's top rows and pinned projects; hidden while searching. */
export function DrawerNavigationHeader(props: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly projectScopes: ReadonlyArray<HomeProjectScope>;
  readonly selectedProjectScope: HomeProjectScope | null;
  readonly selectedThreadKey: string | null;
  readonly hasPinnedThreads: boolean;
  readonly searching: boolean;
  readonly onSelectProjectKey: (key: string) => void;
}) {
  const navigation = useNavigation();
  const selectDetail = useSelectWorkspaceDetail();
  const { projectScopes, threads } = props;
  const pinned = useMemo(
    () => pinnedProjects(projectScopes, (scope) => scope.projects, threads),
    [projectScopes, threads],
  );
  const unpinProject = useUnpinProject();
  if (props.searching) return null;
  const selectedThread =
    props.selectedThreadKey === null
      ? undefined
      : threads.find(
          (thread) => scopedThreadKey(thread.environmentId, thread.id) === props.selectedThreadKey,
        );
  const artifactsProject =
    (props.selectedProjectScope?.projectRefs.length === 1
      ? props.selectedProjectScope.projectRefs[0]
      : undefined) ??
    (selectedThread === undefined
      ? undefined
      : { environmentId: selectedThread.environmentId, projectId: selectedThread.projectId });
  return (
    <DrawerNavigationRows
      onOpenProjects={() => openSettings(navigation, "SettingsProjectOverview")}
      onOpenArtifacts={
        artifactsProject === undefined
          ? null
          : () =>
              navigation.navigate("ThreadOverview", {
                environmentId: String(artifactsProject.environmentId),
                projectId: String(artifactsProject.projectId),
                tab: "library",
              })
      }
      onOpenScheduled={() => openSettings(navigation, "SettingsScheduledTasks")}
      pinnedProjects={pinned}
      hasPinnedThreads={props.hasPinnedThreads}
      onSelectPinnedProject={({ group, coordinator }) => {
        if (coordinator === null) {
          props.onSelectProjectKey(group.key);
          return;
        }
        selectDetail({
          name: "Thread",
          params: {
            environmentId: String(coordinator.environmentId),
            threadId: coordinator.threadId,
          },
        });
      }}
      onUnpinProject={(entry) => void unpinProject(entry.group)}
    />
  );
}

function DrawerNavigationRows(props: {
  readonly onOpenProjects: () => void;
  readonly onOpenArtifacts: (() => void) | null;
  readonly onOpenScheduled: () => void;
  readonly pinnedProjects: ReadonlyArray<DrawerPinnedProject>;
  readonly hasPinnedThreads: boolean;
  readonly onSelectPinnedProject: (entry: DrawerPinnedProject) => void;
  readonly onUnpinProject: (entry: DrawerPinnedProject) => void;
}) {
  return (
    <View className="pb-1">
      <DrawerRow label="Projects" icon={glyph("folder")} onPress={props.onOpenProjects} />
      {props.onOpenArtifacts === null ? null : (
        <DrawerRow
          label="Artifacts"
          icon={glyph("square.on.square")}
          onPress={props.onOpenArtifacts}
        />
      )}
      <DrawerRow label="Scheduled" icon={glyph("clock")} onPress={props.onOpenScheduled} />
      {props.pinnedProjects.length === 0 && !props.hasPinnedThreads ? null : (
        <>
          <DrawerSectionLabel label="Pinned" />
          {props.pinnedProjects.map((entry) => {
            const project = entry.group.representative;
            return (
              <Menu
                key={entry.group.key}
                shouldOpenOnLongPress
                title={entry.group.title}
                actions={PINNED_PROJECT_ACTIONS}
                onPressAction={({ nativeEvent }) => {
                  if (nativeEvent.event === "unpin") props.onUnpinProject(entry);
                }}
              >
                <DrawerRow
                  label={entry.group.title}
                  attention={entry.waitingOnYou}
                  accessibilityHint="Long press to unpin."
                  icon={
                    <ProjectFavicon
                      environmentId={project.environmentId}
                      faviconPath={project.faviconPath}
                      projectIcon={project.projectIcon}
                      size={20}
                      projectTitle={entry.group.title}
                      workspaceRoot={project.workspaceRoot}
                    />
                  }
                  onPress={() => props.onSelectPinnedProject(entry)}
                />
              </Menu>
            );
          })}
        </>
      )}
    </View>
  );
}
