/** Where the Recents label goes: before the first row that is not a pinned thread. */
export function drawerRecentsIndex(
  items: ReadonlyArray<{
    readonly type: string;
    readonly item?: { readonly pinned?: boolean };
  }>,
): number | null {
  const index = items.findIndex((item) => !(item.type === "v2-thread" && item.item?.pinned));
  return index < 0 ? null : index;
}
