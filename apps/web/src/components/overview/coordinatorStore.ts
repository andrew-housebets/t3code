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

const keySetOf = (value: unknown): KeySet =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as KeySet) : {};

interface CoordinatorStoreState {
  /** Drafts started as coordinators; the tag goes on at launch. */
  readonly draftIds: KeySet;
  /** Coordinator threads whose Overview this browser already opened once. */
  readonly overviewShownThreadKeys: KeySet;
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
      partialize: ({ draftIds, overviewShownThreadKeys }) => ({
        draftIds,
        overviewShownThreadKeys,
      }),
      merge: (persisted, current) => {
        const stored = keySetOf(persisted) as Partial<Record<string, unknown>>;
        return {
          ...current,
          draftIds: keySetOf(stored.draftIds),
          overviewShownThreadKeys: keySetOf(stored.overviewShownThreadKeys),
        };
      },
    },
  ),
);

export const isCoordinatorDraft = (draftId: string | null) =>
  draftId !== null && draftId in useCoordinatorStore.getState().draftIds;

export const useIsCoordinatorDraft = (draftId: string | null) =>
  useCoordinatorStore((state) => draftId !== null && draftId in state.draftIds);
