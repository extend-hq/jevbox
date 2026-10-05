export const FINDER_DRAG_TYPE = "application/x-jevbox-items";

export function finderEntryPath(event: Event, currentPath: string) {
  for (const target of event.composedPath()) {
    if (!(target instanceof HTMLElement)) continue;
    if (target.dataset.entryPath) return target.dataset.entryPath;
    if (target.dataset.itemPath)
      return `${currentPath}${target.dataset.itemPath}`;
  }
  return null;
}
