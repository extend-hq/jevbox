import { HttpError, type Resource, type Store } from "./db";

type Folder = Pick<Resource, "id" | "parent_id"> & { pinned?: boolean };

export function pinnedFolderIds(folders: readonly Folder[]) {
  const children = new Map<string, string[]>();
  for (const folder of folders) {
    if (!folder.parent_id) continue;
    const siblings = children.get(folder.parent_id) ?? [];
    siblings.push(folder.id);
    children.set(folder.parent_id, siblings);
  }
  const pending = folders.filter((folder) => folder.pinned).map(({ id }) => id);
  const pinned = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (pinned.has(id)) continue;
    pinned.add(id);
    pending.push(...(children.get(id) ?? []));
  }
  return pinned;
}

export async function requireUnpinnedFolders(
  store: Store,
  orgId: string,
  folderIds: (string | null)[],
) {
  const ids = folderIds.filter((id): id is string => id !== null);
  if (!ids.length) return;
  const pinned = await store.one(
    `WITH RECURSIVE ancestors AS (
      SELECT id,parent_id,pinned FROM resources WHERE org_id=? AND kind='folder' AND id=ANY(?::text[])
      UNION
      SELECT r.id,r.parent_id,r.pinned FROM resources r JOIN ancestors a ON r.id=a.parent_id WHERE r.org_id=? AND r.kind='folder'
    ) SELECT id FROM ancestors WHERE pinned LIMIT 1`,
    orgId,
    ids,
    orgId,
  );
  if (pinned)
    throw new HttpError(
      409,
      "Pinned folders are locked. Unpin the folder before filing documents into or out of it.",
    );
}
