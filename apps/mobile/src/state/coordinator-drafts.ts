import { useAtomValue } from "@effect/atom-react";
import {
  isCoordinatorDraftId,
  persistedObjectOf,
  withKey,
  type KeySet,
} from "@t3tools/client-runtime/state/coordinator-ui";
import { AsyncResult } from "effect/reactivity";

import { appAtomRegistry } from "./atom-registry";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "./preferences";

export const COORDINATOR_DRAFT_PLACEHOLDER =
  "Describe the work. Threads will be started for each task.";

const storedDraftKeys = (
  result: AsyncResult.AsyncResult<{ readonly coordinatorDraftKeys?: KeySet }, unknown>,
): KeySet => (AsyncResult.isSuccess(result) ? (result.value.coordinatorDraftKeys ?? {}) : {});

export function useIsCoordinatorDraft(draftKey: string | null): boolean {
  return isCoordinatorDraftId(storedDraftKeys(useAtomValue(mobilePreferencesAtom)), draftKey);
}

export function isCoordinatorDraft(draftKey: string | null): boolean {
  return isCoordinatorDraftId(
    storedDraftKeys(appAtomRegistry.get(mobilePreferencesAtom)),
    draftKey,
  );
}

// ponytail: keys of sent or discarded drafts stay until preferences are cleared; prune by live draft keys if it grows.
export function setCoordinatorDraft(draftKey: string, coordinator: boolean) {
  if (isCoordinatorDraft(draftKey) === coordinator) return;
  appAtomRegistry.set(updateMobilePreferencesAtom, {
    transform: (current) => ({
      coordinatorDraftKeys: withKey(
        persistedObjectOf(current.coordinatorDraftKeys),
        draftKey,
        coordinator,
      ),
    }),
  });
}
