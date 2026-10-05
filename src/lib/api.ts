import type { ParsedBlock } from "../../shared/parsed-blocks";
import type { RetrievalStep } from "../../shared/retrieval";
import type { Thumbnail } from "../../shared/thumbnails";
import { mutationSuccessMessage, notifySuccess } from "./notifications";
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T = any>(
  path: string,
  options: RequestInit & { notify?: boolean } = {},
): Promise<T> {
  const { notify = true, ...requestOptions } = options;
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    cache: "no-store",
    ...requestOptions,
    headers: {
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      "X-Jevbox-Request": "1",
      ...options.headers,
    },
  });
  const retryAfter = Number(response.headers.get("Retry-After")) || undefined;
  let data;
  try {
    data = await response.json();
  } catch {
    throw new ApiError(
      response.status === 429
        ? "Too many requests. Wait a moment and try again."
        : "The server returned an unexpected response. Try again.",
      response.status,
      undefined,
      retryAfter,
    );
  }
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/auth/"))
      window.dispatchEvent(new Event("session-expired"));
    throw new ApiError(
      data.error || data.message || "Request failed",
      response.status,
      data.code,
      retryAfter,
    );
  }
  const message = mutationSuccessMessage(
    path,
    (options.method ?? "GET").toUpperCase(),
  );
  if (notify && message) notifySuccess(message);
  return data;
}
export type Resource = {
  id: string;
  owner_id: string;
  parent_id: string | null;
  kind: "folder" | "document";
  pinned: boolean;
  name: string;
  description: string;
  access: "restricted" | "organization" | "inherit" | "link";
  status: string;
  error?: string;
  filing?: { state: string; error: string | null; reason?: string | null };
  mime: string;
  size: number;
  pages: number;
  created: string;
  canWrite: boolean;
  canShare: boolean;
  parsed?: Parsed;
  thumbnail?: Thumbnail | null;
  thumbnail_status?: string;
};
export type IndexNode = {
  id: string;
  title: string;
  summary: string;
  page: number;
  endPage: number;
  content: string;
  links: {
    label: string;
    url: string;
  }[];
  blocks: ParsedBlock[];
  children: IndexNode[];
};
export type Parsed = {
  source: string;
  pages: number;
  markdown: string;
  nodes: IndexNode[];
  blocks?: ParsedBlock[];
  indexedAt: string;
};
export type Me = {
  user: {
    id: string;
    name: string;
    email: string;
  };
  organization: {
    id: string;
    name: string;
  };
  role: string;
  isOwner: boolean;
  organizations: {
    id: string;
    name: string;
  }[];
  chatEnabled: boolean;
  chatModels: { provider: string; providerLabel: string; model: string }[];
  defaultChatModel: { provider: string; model: string };
  semanticEnabled: boolean;
  extendEnabled: boolean;
};
export type Member = {
  membershipId: string;
  id: string;
  name: string;
  email: string;
  role: string;
};
export type Source = {
  documentId: string;
  name: string;
  nodeId: string;
  title: string;
  page: number;
  endPage?: number;
  passageId?: string;
  routeScore?: number;
  content?: string;
  blockIds?: string[];
  sectionPath?: string[];
  citationBlocks?: { id: string; page: number; type: string }[];
};
export type Message = {
  position?: number;
  selectedModel?: { provider: string; model: string };
  turnId?: string;
  role: string;
  content: string;
  sources?: Source[];
  attachments?: { id: string; name: string }[];
  trace?: RetrievalStep[];
  retrievalDurationMs?: number;
};
export const flatten = (nodes: IndexNode[]): IndexNode[] =>
  nodes.flatMap((n) => [n, ...flatten(n.children)]);
