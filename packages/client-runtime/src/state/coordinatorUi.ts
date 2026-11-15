import type { ThreadOverviewGroup } from "./threadOverview.ts";

/** Keys a client remembers, such as coordinator draft ids; an object so it persists as JSON. */
export type KeySet = Readonly<Record<string, true>>;

export const withKey = (set: KeySet, key: string, present: boolean): KeySet => {
  if (present === key in set) return set;
  if (present) return { ...set, [key]: true };
  const { [key]: _removed, ...rest } = set;
  return rest;
};

/** Stored state that is not a plain object reads as empty. */
export const persistedObjectOf = <T = KeySet>(value: unknown): T =>
  (typeof value === "object" && value !== null && !Array.isArray(value) ? value : {}) as T;

/** A draft started as a coordinator gets the coordinator tag when its thread launches. */
export const isCoordinatorDraftId = (draftIds: KeySet, draftId: string | null) =>
  draftId !== null && draftId in draftIds;

export type ThreadOverviewGroupCollapse = Readonly<Partial<Record<ThreadOverviewGroup, boolean>>>;

/** Resolved threads start folded away; every other group starts open. */
export const isThreadOverviewGroupCollapsed = (
  stored: ThreadOverviewGroupCollapse | undefined,
  group: ThreadOverviewGroup,
) => stored?.[group] ?? group === "resolved";

export const toggleThreadOverviewGroup = (
  stored: ThreadOverviewGroupCollapse | undefined,
  group: ThreadOverviewGroup,
): ThreadOverviewGroupCollapse => ({
  ...stored,
  [group]: !isThreadOverviewGroupCollapsed(stored, group),
});
