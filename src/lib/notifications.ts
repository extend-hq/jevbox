export function notifySuccess(title: string) {
  window.dispatchEvent(new CustomEvent("app-success", { detail: title }));
}
export function mutationSuccessMessage(path: string, method: string) {
  if (method === "POST" && path === "/resources/delete-batch")
    return "Selected items deleted";
  if (method === "PUT" && path === "/settings") return "Connections saved";
  if (method === "POST" && /^\/resources\/[^/]+\/move$/.test(path))
    return "Item moved";
  if (method === "POST" && path === "/folders") return "Folder created";
  if (method === "POST" && /^\/documents\/[^/]+\/retry$/.test(path))
    return "Indexing restarted";
  if (
    method === "PUT" &&
    (path === "/resources/access-batch" ||
      /^\/resources\/[^/]+\/access$/.test(path))
  )
    return "Sharing updated";
  if (method === "PATCH" && /^\/resources\/[^/]+$/.test(path))
    return "Changes saved";
  if (method === "DELETE" && /^\/resources\/[^/]+$/.test(path))
    return "Item deleted";
  if (method === "DELETE" && /^\/chats\/[^/]+$/.test(path))
    return "Conversation deleted";
}

export function notifyUploads(count: number) {
  if (count > 0)
    notifySuccess(
      count === 1 ? "Document uploaded" : `${count} documents uploaded`,
    );
}
