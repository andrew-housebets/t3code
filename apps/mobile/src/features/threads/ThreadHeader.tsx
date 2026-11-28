import { useNavigation } from "@react-navigation/native";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { isCoordinatorThread } from "@t3tools/shared/coordinatorThread";
import { useGT, useMessages } from "gt-react-native";

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
  readonly draftActions?: ReadonlyArray<AppBarAction>;
}) {
  const gt = useGT();
  const m = useMessages();
  const goBack = useWorkspaceBackNavigation();
  const { toggleAuxiliaryPane, startNewTask } = useAdaptiveWorkspaceLayout();
  const { panes, fileInspector } = useWorkspacePaneState();
  const navigation = useNavigation();
  const threadRef = scopeThreadRef(
    EnvironmentId.make(String(props.gitControls.environmentId)),
    ThreadId.make(String(props.gitControls.threadId)),
  );
  const thread = useThreadShell(threadRef);
  const coordinator = thread !== null && isCoordinatorThread(thread.source);
  useMountedThreadFamily(coordinator ? threadRef : null);
  const overviewState = useThreadOverviewEntryState(props.draft ? null : threadRef);
  const overviewVisible = props.inspectorMode === "overview" && panes.auxiliaryPaneVisible;
  const overviewAction: AppBarAction | null =
    overviewState === "hidden" || thread === null || props.onOpenOverviewInspector === undefined
      ? null
      : {
          accessibilityLabel:
            overviewState === "waiting" ? gt("Overview, needs you") : gt("Overview"),
          icon: "checklist",
          selected: overviewVisible,
          attention: overviewState === "waiting",
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
  const terminalMenu = threadTerminalMenu(props.gitControls, m);
  const filesVisible = props.inspectorMode === "files" && panes.auxiliaryPaneVisible;
  const fileActions: AppBarAction[] = props.hasThreadCwd
    ? [
        {
          accessibilityLabel: filesVisible ? gt("Close files") : gt("Open files"),
          icon: "folder",
          selected: filesVisible,
          disabled: !props.gitControls.canOpenFiles,
          separateBackground: false,
          onPress: filesVisible ? toggleAuxiliaryPane : props.onOpenFilesInspector,
        },
      ]
    : [];
  const actions = [
    ...(props.draftActions ?? []),
    ...(overviewAction === null ? [] : [overviewAction]),
    ...fileActions,
  ];
  const menus = [gitMenu, terminalMenu].filter((menu): menu is AppBarMenu => menu !== null);

  return (
    <AppBar
      title={props.title}
      subtitle={
        coordinator
          ? props.subtitle
            ? gt("Coordinator · {subtitle}", { subtitle: props.subtitle })
            : gt("Coordinator", { $context: "thread that coordinates other threads" })
          : props.subtitle
      }
      onBackToList={goBack}
      onCompose={props.draft ? undefined : startNewTask}
      backInSplitView={
        props.onReturnToThread
          ? {
              accessibilityLabel: gt("Return to chat"),
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
