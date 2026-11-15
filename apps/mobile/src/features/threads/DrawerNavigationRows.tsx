import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import { useNavigation } from "@react-navigation/native";
import { useMemo, type ReactNode } from "react";
import { Pressable, View } from "react-native";

import { ProjectFavicon } from "../../components/ProjectFavicon";
import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { scopedThreadKey } from "../../lib/scopedEntities";
import type { HomeProjectScope } from "../home/homeThreadList";
import { useSelectWorkspaceDetail } from "../layout/workspace/useSelectWorkspaceDetail";
import { openSettings } from "../settings/settings-navigation";
import { drawerPinnedProjects, type DrawerPinnedProject } from "./drawerSections";

function DrawerRow(props: {
  readonly label: string;
  readonly icon: ReactNode;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      onPress={props.onPress}
      className="min-h-12 flex-row items-center gap-3.5 rounded-xl px-3 active:bg-thread-hover"
    >
      <View className="w-6 items-center">{props.icon}</View>
      <Text className="min-w-0 flex-1 text-base text-drawer-foreground" numberOfLines={1}>
        {props.label}
      </Text>
    </Pressable>
  );
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
  readonly projects: ReadonlyArray<EnvironmentProject>;
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
  const { projects, threads } = props;
  const pinnedProjects = useMemo(
    () => drawerPinnedProjects(projects, threads),
    [projects, threads],
  );
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
      pinnedProjects={pinnedProjects}
      hasPinnedThreads={props.hasPinnedThreads}
      onSelectPinnedProject={({ project, coordinatorThreadId }) => {
        if (coordinatorThreadId !== null) {
          selectDetail({
            name: "Thread",
            params: { environmentId: String(project.environmentId), threadId: coordinatorThreadId },
          });
          return;
        }
        const scope = props.projectScopes.find((candidate) =>
          candidate.projectRefs.some(
            (ref) => ref.environmentId === project.environmentId && ref.projectId === project.id,
          ),
        );
        if (scope !== undefined) props.onSelectProjectKey(scope.key);
      }}
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
          {props.pinnedProjects.map((entry) => (
            <DrawerRow
              key={`${entry.project.environmentId}:${entry.project.id}`}
              label={entry.project.title}
              icon={
                <ProjectFavicon
                  environmentId={entry.project.environmentId}
                  faviconPath={entry.project.faviconPath}
                  projectIcon={entry.project.projectIcon}
                  size={20}
                  projectTitle={entry.project.title}
                  workspaceRoot={entry.project.workspaceRoot}
                />
              }
              onPress={() => props.onSelectPinnedProject(entry)}
            />
          ))}
        </>
      )}
    </View>
  );
}
