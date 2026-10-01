import type { Resource } from "./api";

export async function downloadLibraryItems(items: Resource[]) {
  if (!items.length) return;
  const anchor = document.createElement("a");
  let objectUrl: string | undefined;
  if (items.length === 1 && items[0].kind === "document") {
    anchor.href = `/api/documents/${items[0].id}/content`;
    anchor.download = items[0].name;
  } else {
    const response = await fetch("/api/resources/download", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Jevbox-Request": "1" },
      body: JSON.stringify({ ids: items.map((item) => item.id) }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(error?.error || "Couldn't download the selected items.");
    }
    objectUrl = URL.createObjectURL(await response.blob());
    anchor.href = objectUrl;
    anchor.download =
      items.length === 1 ? `${items[0].name}.zip` : "Library.zip";
  }
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl!), 60000);
}
