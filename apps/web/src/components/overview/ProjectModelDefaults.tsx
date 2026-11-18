import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  ModelSelection,
  ProjectId,
  ProjectModelDefaults,
} from "@t3tools/contracts";
import { createModelSelection, pickModelSelection } from "@t3tools/shared/model";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import { providerInstanceEntriesFor } from "../../providerInstances";
import { projectEnvironment } from "../../state/projects";
import { useEnvironmentQuery } from "../../state/query";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { SETTINGS_PICKER_TRIGGER_CLASSNAME, SettingsRow } from "../settings/settingsLayout";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";

export function CoordinatorModelSettingsRow(props: {
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
  const settings = useEnvironmentSettings(environmentId);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const entries = providerInstanceEntriesFor(providers, settings, projectId);
  const defaults = saved.data;
  if (defaults === null) return null;

  const save = async (next: ProjectModelDefaults) => {
    const result = await write({ environmentId, input: { projectId, defaults: next } });
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Default model not saved",
          description: error instanceof Error ? error.message : undefined,
        }),
      );
    }
    saved.refresh();
  };

  const selection = defaults.coordinatorModelSelection;
  const shown = selection ?? (entries[0] ? { instanceId: entries[0].instanceId, model: "" } : null);
  const activeEntry = entries.find((entry) => entry.instanceId === selection?.instanceId);
  const setSelection = (value: ModelSelection | null) =>
    void save({ coordinatorModelSelection: value });
  return (
    <SettingsRow
      title="Coordinator model"
      description={
        shown === null
          ? "No providers available."
          : selection === null
            ? "New coordinators start on the usual default model."
            : "Model this project's coordinator starts on."
      }
      control={
        shown === null ? null : (
          <div data-project-model-defaults className="flex min-w-0 flex-wrap items-center gap-1.5">
            {selection !== null && canWrite ? (
              <Button size="xs" variant="ghost-muted" onClick={() => setSelection(null)}>
                Reset
              </Button>
            ) : null}
            <ProviderModelPicker
              environmentId={environmentId}
              disabled={!canWrite}
              activeInstanceId={shown.instanceId}
              model={shown.model}
              lockedProvider={null}
              instanceEntries={entries}
              modelOptionsByInstance={getCustomModelOptionsByInstance(
                settings,
                providers,
                shown.instanceId,
                shown.model,
              )}
              isComposerOwned={false}
              triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
              {...(selection === null ? { triggerLabel: "Default" } : {})}
              onInstanceModelChange={(instanceId, model) =>
                setSelection(pickModelSelection(selection, instanceId, model))
              }
            />
            {selection !== null && activeEntry ? (
              <TraitsPicker
                provider={activeEntry.driverKind}
                models={activeEntry.models}
                model={selection.model}
                modelOptions={selection.options ?? []}
                allowPromptInjectedEffort={false}
                triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                onModelOptionsChange={(options) =>
                  setSelection(createModelSelection(selection.instanceId, selection.model, options))
                }
              />
            ) : null}
          </div>
        )
      }
    />
  );
}
