import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  EnvironmentId,
  PROJECT_CONTEXT_MAX_CHARS,
  ProjectId,
  type ModelSelection,
  type ProjectContextFiles,
  type ProjectModelDefaults,
} from "@t3tools/contracts";
import type { StaticScreenProps } from "@react-navigation/native";
import { isReasoningSelect } from "@t3tools/client-runtime/model-traits";
import { createModelSelection } from "@t3tools/shared/model";
import { useState, type ComponentProps } from "react";
import { Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { Menu } from "../../components/ui/Menu";
import { buildModelOptions, groupByProvider } from "../../lib/modelOptions";
import {
  pickModelKeepingOptions,
  resolveProviderOptionDescriptors,
} from "../../lib/providerOptions";
import { useEnvironmentServerConfig } from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { SettingsSection } from "../settings/components/SettingsSection";

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
  {
    key: "folders",
    label: "Supplementary folders",
    placeholder:
      "Other folders or repositories threads may read, one absolute path per line.\n/home/me/code/api # the backend this app calls",
  },
] as const satisfies ReadonlyArray<{
  readonly key: keyof ProjectContextFiles;
  readonly label: string;
  readonly placeholder: string;
}>;

const MODEL_ROWS = [
  {
    key: "coordinatorModelSelection",
    label: "Coordinator model",
    unset: "New coordinators start on the usual default model.",
  },
] as const satisfies ReadonlyArray<{
  readonly key: keyof ProjectModelDefaults;
  readonly label: string;
  readonly unset: string;
}>;

const DEFAULT_MODEL_ACTION = "default";
// Outside any provider's option ids, which could include "default".
const DEFAULT_EFFORT_ACTION = "t3:default";

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : undefined);

export function ProjectInstructionsRouteScreen({
  route,
}: StaticScreenProps<{ readonly environmentId: string; readonly projectId: string }>) {
  const environmentId = EnvironmentId.make(route.params.environmentId);
  const projectId = ProjectId.make(route.params.projectId);
  const insets = useSafeAreaInsets();
  return (
    <SettingsScreen title="Project instructions">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <ProjectContextFields
          key={`${environmentId}:${projectId}`}
          environmentId={environmentId}
          projectId={projectId}
        />
      </ScrollView>
    </SettingsScreen>
  );
}

export function ProjectModelDefaultRows(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}) {
  const { environmentId, projectId } = props;
  const saved = useEnvironmentQuery(
    projectEnvironment.readModelDefaults({ environmentId, input: { projectId } }),
  );
  const canWrite = useAtomValue(
    projectEnvironment.writeModelDefaults.permissionAtom(environmentId),
  );
  const write = useAtomCommand(projectEnvironment.writeModelDefaults, { reportFailure: false });
  const config = useEnvironmentServerConfig(environmentId);
  const options = buildModelOptions(config, null, undefined, projectId);
  const defaults = saved.data;
  if (defaults === null) return null;

  const save = async (next: ProjectModelDefaults) => {
    const result = await write({ environmentId, input: { projectId, defaults: next } });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      Dialog.alert("Default model not saved", errorMessage(squashAtomCommandFailure(result)));
    }
    saved.refresh();
  };
  const optionOf = (selection: ModelSelection) =>
    options.find(
      (candidate) =>
        candidate.selection.instanceId === selection.instanceId &&
        candidate.selection.model === selection.model,
    );
  const labelOf = (selection: ModelSelection) => {
    const option = optionOf(selection);
    return option ? `${option.providerLabel} · ${option.label}` : selection.model;
  };

  return (
    <SettingsSection title="Coordinator">
      {MODEL_ROWS.flatMap(({ key, label, unset }, index) => {
        const selection = defaults[key];
        const modelRow = (
          <MenuRow
            key={key}
            label={label}
            value={selection === null ? "Default" : labelOf(selection)}
            detail={selection === null ? unset : labelOf(selection)}
            canWrite={canWrite}
            first={index === 0}
            actions={[
              {
                id: DEFAULT_MODEL_ACTION,
                title: "Default",
                state: selection === null ? "on" : "off",
              },
              ...groupByProvider(options).map((group) => ({
                id: `provider:${group.providerKey}`,
                title: group.providerLabel,
                subactions: group.models.map((option) => ({
                  id: option.key,
                  title: option.label,
                  state:
                    selection?.instanceId === option.selection.instanceId &&
                    selection.model === option.selection.model
                      ? ("on" as const)
                      : ("off" as const),
                })),
              })),
            ]}
            onAction={(id) => {
              if (id === DEFAULT_MODEL_ACTION) {
                void save({ ...defaults, [key]: null });
                return;
              }
              const option = options.find((candidate) => candidate.key === id);
              if (option)
                void save({ ...defaults, [key]: pickModelKeepingOptions(selection, option) });
            }}
          />
        );
        const effort =
          selection === null
            ? undefined
            : resolveProviderOptionDescriptors({
                capabilities: optionOf(selection)?.capabilities,
                selections: selection.options,
              }).find(isReasoningSelect);
        if (selection === null || effort === undefined) return [modelRow];
        const chosen = selection.options?.find((option) => option.id === effort.id)?.value;
        const choices = effort.options.filter(
          (choice) => !effort.promptInjectedValues?.includes(choice.id),
        );
        const chosenChoice = choices.find((choice) => choice.id === chosen);
        const chosenLabel = chosenChoice?.label ?? "Default";
        return [
          modelRow,
          <MenuRow
            key={`${key}:effort`}
            label={effort.label}
            value={chosenLabel}
            detail={chosenLabel}
            canWrite={canWrite}
            first={false}
            actions={[
              {
                id: DEFAULT_EFFORT_ACTION,
                title: "Default",
                state: chosenChoice === undefined ? "on" : "off",
              },
              ...choices.map((choice) => ({
                id: choice.id,
                title: choice.label,
                state: choice === chosenChoice ? ("on" as const) : ("off" as const),
              })),
            ]}
            onAction={(id) => {
              const others = (selection.options ?? []).filter((option) => option.id !== effort.id);
              void save({
                ...defaults,
                [key]: createModelSelection(
                  selection.instanceId,
                  selection.model,
                  id === DEFAULT_EFFORT_ACTION ? others : [...others, { id: effort.id, value: id }],
                ),
              });
            }}
          />,
        ];
      })}
    </SettingsSection>
  );
}

function MenuRow(props: {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly canWrite: boolean;
  readonly first: boolean;
  readonly actions: ComponentProps<typeof Menu>["actions"];
  readonly onAction: (id: string) => void;
}) {
  const row = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${props.label}, ${props.value}`}
      accessibilityHint={props.detail === props.value ? undefined : props.detail}
      accessibilityState={{ disabled: !props.canWrite }}
      className={
        props.first
          ? "flex-row items-center gap-3 px-4 py-3 active:bg-subtle"
          : "flex-row items-center gap-3 border-t border-border-subtle px-4 py-3 active:bg-subtle"
      }
    >
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="text-base text-foreground">{props.label}</Text>
        <Text className="text-sm text-foreground-muted" numberOfLines={2}>
          {props.detail}
        </Text>
      </View>
      {props.canWrite ? (
        <SymbolView name="chevron.down" size={13} tintColorClassName="accent-icon-muted" />
      ) : null}
    </Pressable>
  );
  if (!props.canWrite) return row;
  return (
    <Menu
      title={props.label}
      actions={props.actions}
      onPressAction={({ nativeEvent }) => props.onAction(nativeEvent.event)}
    >
      {row}
    </Menu>
  );
}

function ProjectContextFields(props: {
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

  if (saved.data === null) {
    return (
      <View className="items-center p-6">
        {saved.error === null ? (
          <AppActivityIndicator />
        ) : (
          <Text className="text-sm text-foreground-muted">{saved.error}</Text>
        )}
      </View>
    );
  }
  const shown = draft ?? saved.data;
  const stored = saved.data;
  const dirty = draft !== null && FIELDS.some(({ key }) => draft[key] !== stored[key]);
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
    if (!isAtomCommandInterrupted(result)) {
      Dialog.alert(
        "Could not save project instructions",
        errorMessage(squashAtomCommandFailure(result)),
      );
    }
  };

  return (
    <>
      {FIELDS.map(({ key, label, placeholder }) => {
        const length = shown[key].length;
        return (
          <SettingsSection key={key} title={label}>
            <View className="gap-2 px-4 py-3">
              <AppTextInput
                accessibilityLabel={label}
                value={shown[key]}
                onChangeText={(text) => setDraft({ ...shown, [key]: text })}
                placeholder={placeholder}
                placeholderTextColorClassName="accent-foreground-muted"
                editable={canWrite && !saving}
                autoCapitalize={key === "folders" ? "none" : undefined}
                autoCorrect={key !== "folders"}
                multiline
                scrollEnabled
                textAlignVertical="top"
                className="max-h-72 min-h-32 font-sans text-base text-foreground"
              />
              <Text
                className={
                  length > PROJECT_CONTEXT_MAX_CHARS
                    ? "self-end text-xs tabular-nums text-danger-foreground"
                    : "self-end text-xs tabular-nums text-foreground-muted"
                }
              >
                {length.toLocaleString()} / {PROJECT_CONTEXT_MAX_CHARS.toLocaleString()}
              </Text>
            </View>
          </SettingsSection>
        );
      })}
      <View className="gap-3 px-2">
        <Text className="text-sm text-foreground-muted">
          Changes apply to threads started afterwards.
        </Text>
        {dirty ? (
          <View className="flex-row justify-end gap-2">
            <Button
              label="Discard"
              tone="secondary"
              disabled={saving}
              onPress={() => setDraft(null)}
            />
            <Button
              label="Save"
              disabled={saving || overLimit}
              loading={saving}
              onPress={() => void save()}
            />
          </View>
        ) : null}
      </View>
    </>
  );
}
