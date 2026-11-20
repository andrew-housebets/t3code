import {
  isCoordinatorDraftId,
  type KeySet,
  persistedObjectOf,
  type ThreadOverviewGroupCollapse,
  toggleThreadOverviewGroup,
  withKey,
} from "@t3tools/client-runtime/state/coordinator-ui";
import type { ThreadOverviewGroup } from "@t3tools/client-runtime/state/thread-overview";
import type { ThreadId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../../lib/storage";

interface CoordinatorStoreState {
  /** Drafts started as coordinators; the tag goes on at launch. */
  readonly draftIds: KeySet;
  /** Coordinator threads whose Overview this browser already opened once. */
  readonly overviewShownThreadKeys: KeySet;
  readonly collapsedGroups: Readonly<Record<string, ThreadOverviewGroupCollapse>>;
  /** The thread whose artifacts a coordinator's Library shows; not persisted. */
  readonly libraryFilters: Readonly<Record<string, ThreadId>>;
  readonly setLibraryFilter: (threadKey: string, threadId: ThreadId | null) => void;
  readonly toggleGroup: (threadKey: string, group: ThreadOverviewGroup) => void;
  readonly markDraft: (draftId: string, coordinator: boolean) => void;
  /** True the first time it is asked for a thread, false after. */
  readonly claimFirstOverview: (threadKey: string) => boolean;
}

// ponytail: entries for discarded drafts stay until storage is cleared; prune by live draft ids if it grows.
export const useCoordinatorStore = create<CoordinatorStoreState>()(
  persist(
    (set, get) => ({
      draftIds: {},
      overviewShownThreadKeys: {},
      collapsedGroups: {},
      libraryFilters: {},
      setLibraryFilter: (threadKey, threadId) =>
        set((state) => {
          const { [threadKey]: _previous, ...rest } = state.libraryFilters;
          return { libraryFilters: threadId === null ? rest : { ...rest, [threadKey]: threadId } };
        }),
      toggleGroup: (threadKey, group) =>
        set((state) => ({
          collapsedGroups: {
            ...state.collapsedGroups,
            [threadKey]: toggleThreadOverviewGroup(state.collapsedGroups[threadKey], group),
          },
        })),
      markDraft: (draftId, coordinator) =>
        set((state) => ({ draftIds: withKey(state.draftIds, draftId, coordinator) })),
      claimFirstOverview: (threadKey) => {
        if (threadKey in get().overviewShownThreadKeys) return false;
        set((state) => ({
          overviewShownThreadKeys: withKey(state.overviewShownThreadKeys, threadKey, true),
        }));
        return true;
      },
    }),
    {
      name: "t3code:coordinator:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: ({ draftIds, overviewShownThreadKeys, collapsedGroups }) => ({
        draftIds,
        overviewShownThreadKeys,
        collapsedGroups,
      }),
      merge: (persisted, current) => {
        const stored = persistedObjectOf<Partial<Record<string, unknown>>>(persisted);
        return {
          ...current,
          draftIds: persistedObjectOf(stored.draftIds),
          overviewShownThreadKeys: persistedObjectOf(stored.overviewShownThreadKeys),
          collapsedGroups: persistedObjectOf<CoordinatorStoreState["collapsedGroups"]>(
            stored.collapsedGroups,
          ),
        };
      },
    },
  ),
);

export const isCoordinatorDraft = (draftId: string | null) =>
  isCoordinatorDraftId(useCoordinatorStore.getState().draftIds, draftId);

export const useIsCoordinatorDraft = (draftId: string | null) =>
  useCoordinatorStore((state) => isCoordinatorDraftId(state.draftIds, draftId));
