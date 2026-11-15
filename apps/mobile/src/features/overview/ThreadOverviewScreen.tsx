import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isThreadOverviewGroupCollapsed,
  toggleThreadOverviewGroup,
  type ThreadOverviewGroupCollapse,
} from "@t3tools/client-runtime/state/coordinator-ui";
import {
  threadRuntimeIsActive,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  groupThreadOverview,
  THREAD_OVERVIEW_GROUP_PRESENTATION,
  threadOverviewArtifacts,
  threadOverviewStatusLine,
  type ThreadOverviewGroup,
} from "@t3tools/client-runtime/state/thread-overview";
import { threadFamilyRead } from "@t3tools/client-runtime/state/threads";
import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  type OrchestrationV2Subagent,
  type ProjectArtifact,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { AppBar } from "../../components/ui/AppBar";
import type { AppBarAction } from "../../components/ui/AppBar.types";
import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { Menu } from "../../components/ui/Menu";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { SheetPane } from "../../components/ui/SheetPane";
import { useNowMinuteMs } from "../../lib/clock";
import { relativeTime } from "../../lib/time";
import { projectEnvironment } from "../../state/projects";
import { useEnvironmentQuery } from "../../state/query";
import { appAtomRegistry } from "../../state/atom-registry";
import { environmentThreadDetails, threadEnvironment, threadFamilies } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useThreadListActions } from "../home/useThreadListActions";
import { useSelectWorkspaceDetail } from "../layout/workspace/useSelectWorkspaceDetail";
import { PullRequestGlyph } from "../pull-requests/pullRequestGlyphs";
import { OverviewLibraryTab, useAddLibraryFiles } from "./OverviewLibraryTab";
import { OverviewScheduledTab } from "./OverviewScheduledTab";
import {
  useMountedThreadFamily,
  useThreadOverviewChildren,
  type OverviewTab,
  type OverviewTarget,
} from "./overviewState";

const GROUP_ICONS = {
  alert: "exclamationmark.circle",
  "pull-request": PullRequestGlyph.pullRequest,
  "in-progress": "circle.dashed.inset.filled",
  idle: "circle.dashed",
  done: "checkmark.circle",
} as const satisfies Record<
  (typeof THREAD_OVERVIEW_GROUP_PRESENTATION)[ThreadOverviewGroup]["icon"],
  AppSymbolName
>;

const TONE_TINTS = {
  warning: "accent-warning-foreground",
  info: "accent-primary-text",
  success: "accent-foreground",
  muted: "accent-icon-muted",
} as const;

type RowAction = "resolve" | "reopen" | "stop";

const ROW_ACTIONS = {
  resolve: { label: "Mark resolved", failure: "Could not mark resolved" },
  reopen: { label: "Reopen", failure: "Could not reopen" },
  stop: { label: "Stop", failure: "Could not stop the thread" },
} satisfies Record<RowAction, { readonly label: string; readonly failure: string }>;

/** Settling refuses an active or blocked run, so a thread with a live run offers Stop instead. */
const rowActionsOf = (thread: EnvironmentThreadShell): ReadonlyArray<RowAction> =>
  thread.settledOverride === "settled"
    ? ["reopen"]
    : threadRuntimeIsActive(thread.runtime)
      ? ["stop"]
      : ["resolve"];

const TAB_OPTIONS = [
  { value: "threads", label: "Threads" },
  { value: "library", label: "Library" },
  { value: "scheduled", label: "Scheduled" },
] as const;

export function ThreadOverviewRouteScreen({
  route,
}: StaticScreenProps<{
  readonly environmentId: string;
  readonly projectId: string;
  readonly threadId?: string;
  readonly tab?: OverviewTab;
}>) {
  const navigation = useNavigation();
  const target = {
    environmentId: EnvironmentId.make(route.params.environmentId),
    projectId: ProjectId.make(route.params.projectId),
    threadId: route.params.threadId ? ThreadId.make(route.params.threadId) : null,
  };
  return (
    <ThreadOverview
      target={target}
      initialTab={route.params.tab}
      onBack={() => navigation.goBack()}
    />
  );
}

/** The Overview as a page (with Back) or as the thread's inspector pane (without). */
export function ThreadOverview(props: {
  readonly target: OverviewTarget;
  readonly initialTab?: OverviewTab | undefined;
  readonly onBack?: () => void;
}) {
  const { target } = props;
  const tabs = target.threadId === null ? TAB_OPTIONS.slice(1) : TAB_OPTIONS;
  const [tab, setTab] = useState<OverviewTab>(
    props.initialTab ?? (target.threadId === null ? "library" : "threads"),
  );
  const [libraryOwner, setLibraryOwner] = useState<ThreadId | null>(null);
  const listing = useEnvironmentQuery(
    projectEnvironment.listArtifacts({
      environmentId: target.environmentId,
      input: { projectId: target.projectId },
    }),
  );
  const addFiles = useAddLibraryFiles(target, listing.refresh);
  const actions: AppBarAction[] =
    tab === "library" && addFiles.allowed
      ? [
          {
            accessibilityLabel: "Add files to the Library",
            icon: "plus",
            loading: addFiles.adding,
            disabled: addFiles.adding,
            onPress: () => void addFiles.pick(),
          },
        ]
      : [];
  const openLibraryFor = (ownerThreadId: ThreadId | null) => {
    setLibraryOwner(ownerThreadId);
    setTab("library");
  };

  return (
    <SheetPane surface="screen">
      <AppBar
        title="Overview"
        onBack={props.onBack}
        onBackToList={props.onBack}
        actions={actions}
        hideBottomBorder
      />
      <ScreenContent>
        <View className="px-4 pb-3 pt-1">
          <SegmentedControl
            options={tabs}
            selected={tab}
            onSelect={(next) => {
              if (next !== "library") setLibraryOwner(null);
              setTab(next);
            }}
          />
        </View>
        {tab === "threads" && target.threadId !== null ? (
          <OverviewThreadsTab
            threadRef={scopeThreadRef(target.environmentId, target.threadId)}
            artifacts={listing.data?.artifacts ?? null}
            onRefreshArtifacts={listing.refresh}
            onOpenLibrary={openLibraryFor}
            target={target}
          />
        ) : tab === "library" ? (
          <OverviewLibraryTab
            target={target}
            listing={listing}
            ownerThreadId={libraryOwner}
            onClearOwner={() => setLibraryOwner(null)}
          />
        ) : (
          <OverviewScheduledTab target={target} />
        )}
      </ScreenContent>
    </SheetPane>
  );
}

function OverviewThreadsTab(props: {
  readonly threadRef: ScopedThreadRef;
  readonly target: OverviewTarget;
  readonly artifacts: ReadonlyArray<ProjectArtifact> | null;
  readonly onRefreshArtifacts: () => void;
  readonly onOpenLibrary: (ownerThreadId: ThreadId | null) => void;
}) {
  const { threadRef } = props;
  useMountedThreadFamily(threadRef);
  const read = threadFamilyRead(
    useAtomValue(threadFamilies.familyAtom(threadRef.environmentId, threadRef.threadId)),
  );
  const children = useThreadOverviewChildren(threadRef);
  const subagents = useAtomValue(environmentThreadDetails.quietThreadAtom(threadRef))?.projection
    .subagents;
  const [collapsed, setCollapsed] = useState<ThreadOverviewGroupCollapse>({});
  const nowMs = useNowMinuteMs();
  const selectDetail = useSelectWorkspaceDetail();
  const { settleThread, unsettleThread } = useThreadListActions();
  const interruptTurn = useAtomCommand(threadEnvironment.interruptTurn, { reportFailure: false });
  const groups = groupThreadOverview(children);
  const artifacts = threadOverviewArtifacts(props.artifacts ?? []);
  const subagentByChild = new Map(
    (subagents ?? []).flatMap((agent) =>
      agent.origin === "app_owned" && agent.childThreadId !== null
        ? [[agent.childThreadId, agent] as const]
        : [],
    ),
  );

  const openThread = (thread: EnvironmentThreadShell) =>
    selectDetail({
      name: "Thread",
      params: { environmentId: String(thread.environmentId), threadId: String(thread.id) },
    });

  const runAction = async (thread: EnvironmentThreadShell, action: RowAction) => {
    if (action === "resolve" || action === "reopen") {
      const done = await (action === "resolve" ? settleThread(thread) : unsettleThread(thread));
      if (!done) Dialog.alert(ROW_ACTIONS[action].failure);
      return;
    }
    const agent = subagentByChild.get(thread.id);
    const result: AtomCommandResult<unknown, unknown> = await interruptTurn({
      environmentId: threadRef.environmentId,
      input:
        agent === undefined
          ? { threadId: thread.id }
          : { threadId: agent.threadId, subagentId: agent.id },
    });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      Dialog.alert(ROW_ACTIONS.stop.failure, error instanceof Error ? error.message : undefined);
    }
    props.onRefreshArtifacts();
  };

  if (groups.length === 0) {
    return (
      <View className="flex-1 items-center justify-center gap-3 px-8">
        {read === "failed" ? (
          <>
            <Text className="text-center text-sm text-foreground-muted">
              Could not load delegated threads.
            </Text>
            <Button
              label="Retry"
              size="compact"
              onPress={() =>
                threadFamilies.refresh(appAtomRegistry, threadRef.environmentId, threadRef.threadId)
              }
            />
          </>
        ) : (
          <Text className="text-center text-sm text-foreground-muted">
            {read === "pending"
              ? "Loading threads…"
              : "Threads this thread starts will appear here."}
          </Text>
        )}
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerClassName="pb-8"
    >
      {artifacts.strip.length > 0 ? (
        <View className="pb-4">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open all artifacts in the Library"
            onPress={() => props.onOpenLibrary(null)}
            className="flex-row items-center gap-1 px-4 pb-2 active:opacity-70"
          >
            <Text className="text-sm text-foreground-muted">Artifacts</Text>
            <SymbolView name="chevron.right" size={11} tintColorClassName="accent-icon-muted" />
          </Pressable>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View className="flex-row gap-3 px-4">
              {artifacts.strip.map((artifact) => (
                <Pressable
                  key={artifact.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${artifact.title}`}
                  onPress={() => props.onOpenLibrary(artifact.threadId)}
                  className="w-36 gap-1.5 active:opacity-70"
                >
                  <View className="h-24 items-center justify-center rounded-xl border border-border bg-card">
                    <SymbolView
                      name={artifact.source === "html_render" ? "globe" : "square.on.square"}
                      size={22}
                      tintColorClassName="accent-icon-muted"
                    />
                  </View>
                  <Text className="text-sm text-foreground" numberOfLines={1}>
                    {artifact.title}
                  </Text>
                  {artifact.updatedAt ? (
                    <Text className="text-xs text-foreground-muted">
                      {relativeTime(artifact.updatedAt, nowMs)}
                    </Text>
                  ) : null}
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </View>
      ) : null}
      {groups.map(({ group, threads }) => {
        const folded = isThreadOverviewGroupCollapsed(collapsed, group);
        return (
          <View key={group} className="pb-2">
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: !folded }}
              onPress={() => setCollapsed((current) => toggleThreadOverviewGroup(current, group))}
              className="flex-row items-center gap-1 px-4 py-2 active:opacity-70"
            >
              <Text className="text-sm text-foreground-muted">
                {THREAD_OVERVIEW_GROUP_PRESENTATION[group].label} · {threads.length}
              </Text>
              <SymbolView
                name={folded ? "chevron.right" : "chevron.down"}
                size={11}
                tintColorClassName="accent-icon-muted"
              />
            </Pressable>
            {folded
              ? null
              : threads.map((thread) => (
                  <OverviewRow
                    key={thread.id}
                    thread={thread}
                    group={group}
                    subagent={subagentByChild.get(thread.id)}
                    nowMs={nowMs}
                    artifactCount={artifacts.countByThread.get(thread.id) ?? 0}
                    onOpen={() => openThread(thread)}
                    onOpenArtifacts={() => props.onOpenLibrary(thread.id)}
                    onAction={(action) => void runAction(thread, action)}
                  />
                ))}
          </View>
        );
      })}
    </ScrollView>
  );
}

function OverviewRow(props: {
  readonly thread: EnvironmentThreadShell;
  readonly group: ThreadOverviewGroup;
  readonly subagent: OrchestrationV2Subagent | undefined;
  readonly nowMs: number;
  readonly artifactCount: number;
  readonly onOpen: () => void;
  readonly onOpenArtifacts: () => void;
  readonly onAction: (action: RowAction) => void;
}) {
  const { thread, group } = props;
  const { label, icon, tone } = THREAD_OVERVIEW_GROUP_PRESENTATION[group];
  const line = threadOverviewStatusLine(thread, props.subagent) ?? label;
  const actions = rowActionsOf(thread);
  return (
    <Menu
      shouldOpenOnLongPress
      title={thread.title}
      actions={actions.map((action) => ({
        id: action,
        title: ROW_ACTIONS[action].label,
        ...(action === "stop" ? { attributes: { destructive: true } } : {}),
      }))}
      onPressAction={({ nativeEvent }) => {
        const action = actions.find((candidate) => candidate === nativeEvent.event);
        if (action !== undefined) props.onAction(action);
      }}
    >
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${thread.title}, ${label}`}
        accessibilityHint="Opens the thread. Long press for actions."
        onPress={props.onOpen}
        className="flex-row gap-3 px-4 py-2.5 active:bg-subtle"
      >
        <View className="pt-0.5">
          <SymbolView name={GROUP_ICONS[icon]} size={18} tintColorClassName={TONE_TINTS[tone]} />
        </View>
        <View className="min-w-0 flex-1 gap-0.5">
          <View className="flex-row items-baseline gap-2">
            <Text className="min-w-0 flex-1 text-base text-foreground" numberOfLines={1}>
              {thread.title}
            </Text>
            <Text className="text-xs tabular-nums text-foreground-muted">
              {relativeTime(thread.updatedAt, props.nowMs)}
            </Text>
          </View>
          <Text
            className={
              thread.latestRun?.status === "failed"
                ? "text-sm text-danger-foreground"
                : "text-sm text-foreground-muted"
            }
            numberOfLines={1}
          >
            {line}
          </Text>
          {props.artifactCount > 0 ? (
            <Pressable
              accessibilityRole="button"
              onPress={props.onOpenArtifacts}
              className="mt-1.5 flex-row items-center gap-1.5 self-start rounded-full bg-subtle px-3 py-1 active:opacity-70"
            >
              <SymbolView
                name="square.on.square"
                size={13}
                tintColorClassName="accent-icon-muted"
              />
              <Text className="text-sm text-foreground-secondary">
                {props.artifactCount} {props.artifactCount === 1 ? "artifact" : "artifacts"}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </Pressable>
    </Menu>
  );
}
