export type ChatModel = { provider: string; model: string };
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
