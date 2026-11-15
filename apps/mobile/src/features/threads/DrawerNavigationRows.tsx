import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

import { ProjectFavicon } from "../../components/ProjectFavicon";
import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import type { DrawerPinnedProject } from "./drawerSections";

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

/** The drawer's top rows and pinned projects, above its thread list. */
export function DrawerNavigationRows(props: {
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
