import type {
  ModelCapabilities,
  ModelSelection,
  ProviderInstanceId,
  ProviderOptionDescriptor,
  ProviderOptionSelection,
  ServerProviderModel,
} from "@t3tools/contracts";
import {
  buildProviderOptionSelectionsFromDescriptors,
  createModelSelection,
  getProviderOptionDescriptors,
  withImplicitFastModeDefault,
} from "@t3tools/shared/model";

export function resolveProviderOptionDescriptors(input: {
  readonly capabilities: ModelCapabilities | null | undefined;
  readonly selections: ReadonlyArray<ProviderOptionSelection> | null | undefined;
}): ReadonlyArray<ProviderOptionDescriptor> {
  if (!input.capabilities) {
    return [];
  }
  return getProviderOptionDescriptors({
    caps: input.capabilities,
    selections: withImplicitFastModeDefault(input.capabilities, input.selections),
  });
}

/** Spells out the Fast off the picker shows, or a provider such as Cursor applies its own default. */
export function withImplicitFastModeSelection(
  selection: ModelSelection,
  providers: ReadonlyArray<{
    readonly instanceId: ProviderInstanceId;
    readonly models: ReadonlyArray<Pick<ServerProviderModel, "slug" | "capabilities">>;
  }>,
): ModelSelection {
  const capabilities = providers
    .find((provider) => provider.instanceId === selection.instanceId)
    ?.models.find((model) => model.slug === selection.model)?.capabilities;
  const options = capabilities
    ? withImplicitFastModeDefault(capabilities, selection.options)
    : selection.options;
  return options === selection.options ? selection : { ...selection, options };
}

export function applyProviderOptionSelection(
  descriptors: ReadonlyArray<ProviderOptionDescriptor>,
  change: ProviderOptionSelection,
): ReadonlyArray<ProviderOptionSelection> | null {
  const descriptor = descriptors.find((candidate) => candidate.id === change.id);
  if (!descriptor) {
    return null;
  }
  if (
    (descriptor.type === "boolean" && typeof change.value !== "boolean") ||
    (descriptor.type === "select" &&
      (typeof change.value !== "string" ||
        !descriptor.options.some((option) => option.id === change.value)))
  ) {
    return null;
  }

  const nextDescriptors = descriptors.map((candidate) =>
    candidate.id === descriptor.id
      ? {
          ...candidate,
          currentValue: change.value,
        }
      : candidate,
  ) as ReadonlyArray<ProviderOptionDescriptor>;

  return buildProviderOptionSelectionsFromDescriptors(nextDescriptors) ?? [];
}

/** Picking another model keeps the options already set that it supports, such as effort set on web. */
export function pickModelKeepingOptions(
  current: ModelSelection | null,
  picked: { readonly selection: ModelSelection; readonly capabilities: ModelCapabilities | null },
): ModelSelection {
  const descriptors = resolveProviderOptionDescriptors({
    capabilities: picked.capabilities,
    selections: null,
  });
  return createModelSelection(
    picked.selection.instanceId,
    picked.selection.model,
    (current?.options ?? []).filter(
      (option) => applyProviderOptionSelection(descriptors, option) !== null,
    ),
  );
}
