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
import { useState } from "react";
import { Pressable, View } from "react-native";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { Menu } from "../../components/ui/Menu";
import { buildModelOptions, groupByProvider } from "../../lib/modelOptions";
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
  {
    key: "threadModelSelection",
    label: "Thread model",
    unset: "Delegated threads start on their coordinator's model.",
  },
] as const satisfies ReadonlyArray<{
  readonly key: keyof ProjectModelDefaults;
  readonly label: string;
  readonly unset: string;
}>;

const DEFAULT_MODEL_ACTION = "default";

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : undefined);

export function ProjectInstructionsRouteScreen({
  route,
}: StaticScreenProps<{ readonly environmentId: string; readonly projectId: string }>) {
  const environmentId = EnvironmentId.make(route.params.environmentId);
  const projectId = ProjectId.make(route.params.projectId);
  return (
    <SettingsScreen title="Project instructions">
      <ProjectModelDefaultRows environmentId={environmentId} projectId={projectId} />
      <ProjectContextFields
        key={`${environmentId}:${projectId}`}
        environmentId={environmentId}
        projectId={projectId}
      />
    </SettingsScreen>
  );
}

function ProjectModelDefaultRows(props: {
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
  const labelOf = (selection: ModelSelection) => {
    const option = options.find(
      (candidate) =>
        candidate.selection.instanceId === selection.instanceId &&
        candidate.selection.model === selection.model,
    );
    return option ? `${option.providerLabel} · ${option.label}` : selection.model;
  };

  return (
    <SettingsSection title="Models">
      {MODEL_ROWS.map(({ key, label, unset }, index) => {
        const selection = defaults[key];
        return (
          <Menu
            key={key}
            title={label}
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
            onPressAction={({ nativeEvent }) => {
              if (nativeEvent.event === DEFAULT_MODEL_ACTION) {
                void save({ ...defaults, [key]: null });
                return;
              }
              const option = options.find((candidate) => candidate.key === nativeEvent.event);
              if (option) void save({ ...defaults, [key]: option.selection });
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${label}, ${selection === null ? "Default" : labelOf(selection)}`}
              accessibilityHint={selection === null ? unset : undefined}
              disabled={!canWrite}
              className={
                index === 0
                  ? "flex-row items-center gap-3 px-4 py-3 active:bg-subtle"
                  : "flex-row items-center gap-3 border-t border-border-subtle px-4 py-3 active:bg-subtle"
              }
            >
              <View className="min-w-0 flex-1 gap-0.5">
                <Text className="text-base text-foreground">{label}</Text>
                <Text className="text-sm text-foreground-muted" numberOfLines={2}>
                  {selection === null ? unset : labelOf(selection)}
                </Text>
              </View>
              <SymbolView name="chevron.down" size={13} tintColorClassName="accent-icon-muted" />
            </Pressable>
          </Menu>
        );
      })}
    </SettingsSection>
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
      setDraft(null);
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
      <View className="gap-3 px-5 pb-8">
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
