export type ChatModel = { provider: string; model: string };
export type ChatSummary = {
  id: string;
  title: string;
  updated?: string;
  blocked: boolean;
  working: boolean;
};
export type ChatTurn = {
  id: string;
  content: string;
  status:
    | "queued"
    | "retrieving"
    | "generating"
    | "cancelling"
    | "failed"
    | "cancelled";
  partialText: string;
  attachments: { id: string; name: string }[];
  selectedModel: ChatModel | null;
  error: string | null;
  regenerating: boolean;
};
export function isChatWorking(status?: ChatTurn["status"] | null) {
  return (
    !!status &&
    ["queued", "retrieving", "generating", "cancelling"].includes(status)
  );
}
