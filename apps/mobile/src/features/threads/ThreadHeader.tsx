import { useNavigation } from "@react-navigation/native";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { isCoordinatorThread } from "@t3tools/shared/coordinatorThread";

import { AppBar } from "../../components/ui/AppBar";
import type { AppBarAction, AppBarMenu } from "../../components/ui/AppBar.types";
import {
  useAdaptiveWorkspaceLayout,
  useWorkspacePaneState,
} from "../layout/AdaptiveWorkspaceLayout";
import type { ThreadInspectorMode } from "./thread-inspector-navigation";
import { useWorkspaceBackNavigation } from "../layout/workspace/useAndroidWorkspaceNavigation";
import {
  threadTerminalMenu,
  useThreadGitMenuDefinition,
  type ThreadGitControlsProps,
} from "./ThreadGitControls";
import { useThreadShell } from "../../state/entities";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { useMountedThreadFamily, useThreadOverviewEntryState } from "../overview/overviewState";

export function ThreadHeader(props: {
  readonly title: string;
  readonly subtitle: string;
  readonly gitControls: ThreadGitControlsProps;
  readonly onReturnToThread?: () => void;
  readonly draft?: boolean;
  readonly hasThreadCwd: boolean;
  readonly inspectorMode: ThreadInspectorMode | null;
  readonly onOpenFilesInspector: () => void;
  readonly onOpenOverviewInspector?: () => void;
}) {
  const goBack = useWorkspaceBackNavigation();
  const { toggleAuxiliaryPane, startNewTask } = useAdaptiveWorkspaceLayout();
  const { panes, fileInspector } = useWorkspacePaneState();
  const navigation = useNavigation();
  const { themeVariables } = useAppearancePreferences();
  const threadRef = scopeThreadRef(
    EnvironmentId.make(String(props.gitControls.environmentId)),
    ThreadId.make(String(props.gitControls.threadId)),
  );
  const thread = useThreadShell(threadRef);
  const coordinator = thread !== null && isCoordinatorThread(thread.source);
  useMountedThreadFamily(coordinator ? threadRef : null);
  const overviewState = useThreadOverviewEntryState(threadRef);
  const overviewVisible = props.inspectorMode === "overview" && panes.auxiliaryPaneVisible;
  const overviewAction: AppBarAction | null =
    overviewState === "hidden" || thread === null || props.onOpenOverviewInspector === undefined
      ? null
      : {
          accessibilityLabel:
            overviewState === "waiting" ? "Overview, a thread is waiting on you" : "Overview",
          icon: "checklist",
          selected: overviewVisible,
          tintColor:
            overviewState === "waiting" ? themeVariables["--color-warning-foreground"] : undefined,
          onPress: overviewVisible
            ? toggleAuxiliaryPane
            : fileInspector.supported
              ? props.onOpenOverviewInspector
              : () =>
                  navigation.navigate("ThreadOverview", {
                    environmentId: String(thread.environmentId),
                    projectId: String(thread.projectId),
                    threadId: String(thread.id),
                  }),
        };
  const gitMenu = useThreadGitMenuDefinition(props.gitControls);
  const terminalMenu = threadTerminalMenu(props.gitControls);
  const filesVisible = props.inspectorMode === "files" && panes.auxiliaryPaneVisible;
  const fileActions: AppBarAction[] = props.hasThreadCwd
    ? [
        {
          accessibilityLabel: filesVisible ? "Close files" : "Open files",
          icon: "folder",
          selected: filesVisible,
          disabled: !props.gitControls.canOpenFiles,
          separateBackground: false,
          onPress: filesVisible ? toggleAuxiliaryPane : props.onOpenFilesInspector,
        },
      ]
    : [];
  const actions = overviewAction === null ? fileActions : [overviewAction, ...fileActions];
  const menus = [gitMenu, terminalMenu].filter((menu): menu is AppBarMenu => menu !== null);

  return (
    <AppBar
      title={props.title}
      subtitle={coordinator ? `Coordinator · ${props.subtitle}` : props.subtitle}
      onBackToList={goBack}
      onCompose={props.draft ? undefined : startNewTask}
      backInSplitView={
        props.onReturnToThread
          ? {
              accessibilityLabel: "Return to chat",
              icon: "chevron.left",
              onPress: props.onReturnToThread,
            }
          : undefined
      }
      actions={actions}
      menus={menus}
      hideBottomBorder
    />
  );
}
