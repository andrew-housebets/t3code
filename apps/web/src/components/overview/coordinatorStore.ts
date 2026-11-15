import type { ThreadOverviewGroup } from "@t3tools/client-runtime/state/thread-overview";
import type { ThreadId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../../lib/storage";

type KeySet = Readonly<Record<string, true>>;

const withKey = (set: KeySet, key: string, present: boolean): KeySet => {
  if (present === key in set) return set;
  if (present) return { ...set, [key]: true };
  const { [key]: _removed, ...rest } = set;
  return rest;
};

const objectOf = <T = KeySet>(value: unknown): T =>
  (typeof value === "object" && value !== null && !Array.isArray(value) ? value : {}) as T;

type GroupCollapse = Readonly<Partial<Record<ThreadOverviewGroup, boolean>>>;

/** Resolved threads start folded away; every other group starts open. */
export const isGroupCollapsed = (stored: GroupCollapse | undefined, group: ThreadOverviewGroup) =>
  stored?.[group] ?? group === "resolved";

interface CoordinatorStoreState {
  /** Drafts started as coordinators; the tag goes on at launch. */
  readonly draftIds: KeySet;
  /** Coordinator threads whose Overview this browser already opened once. */
  readonly overviewShownThreadKeys: KeySet;
  readonly collapsedGroups: Readonly<Record<string, GroupCollapse>>;
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
        set((state) => {
          const stored = state.collapsedGroups[threadKey];
          return {
            collapsedGroups: {
              ...state.collapsedGroups,
              [threadKey]: { ...stored, [group]: !isGroupCollapsed(stored, group) },
            },
          };
        }),
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
        const stored = objectOf<Partial<Record<string, unknown>>>(persisted);
        return {
          ...current,
          draftIds: objectOf(stored.draftIds),
          overviewShownThreadKeys: objectOf(stored.overviewShownThreadKeys),
          collapsedGroups: objectOf<CoordinatorStoreState["collapsedGroups"]>(
            stored.collapsedGroups,
          ),
        };
      },
    },
  ),
);

export const isCoordinatorDraft = (draftId: string | null) =>
  draftId !== null && draftId in useCoordinatorStore.getState().draftIds;

export const useIsCoordinatorDraft = (draftId: string | null) =>
  useCoordinatorStore((state) => draftId !== null && draftId in state.draftIds);
