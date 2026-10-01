import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import type { JSONContent } from "@tiptap/react";
import Papa from "papaparse";
import { PromptDocument } from "./chat-document-extension";

export const promptLimit = 4000;
export function promptExtensions(documentExtension = PromptDocument) {
  return [
    documentExtension,
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: false,
        autolink: true,
        protocols: ["http", "https", "mailto"],
      },
    }),
    TableKit.configure({ table: { resizable: false } }),
    Markdown.configure({ markedOptions: { gfm: true } }),
  ];
}
export function pastedSpreadsheet(text: string): JSONContent | null {
  if (!text.includes("\t")) return null;
  const result = Papa.parse<string[]>(
    text.replace(/\r\n/g, "\n").replace(/\n$/, ""),
    { delimiter: "\t", skipEmptyLines: false },
  );
  const rows = result.data;
  const columns = rows[0]?.length ?? 0;
  if (
    result.errors.length ||
    rows.length < 2 ||
    columns < 2 ||
    rows.some((row) => row.length !== columns)
  )
    return null;
  return {
    type: "table",
    content: rows.map((row, index) => ({
      type: "tableRow",
      content: row.map((value) => ({
        type: index === 0 ? "tableHeader" : "tableCell",
        content: [
          {
            type: "paragraph",
            ...(value ? { content: [{ type: "text", text: value }] } : {}),
          },
        ],
      })),
    })),
  };
}
export function isMarkdownTable(text: string) {
  return /^\s*\|?\s*:?-{3,}:?\s*\|\s*:?-{3,}:?(?:\s*\|\s*:?-{3,}:?)*\s*\|?\s*$/m.test(
    text,
  );
}
export function promptLink(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(
      /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`,
    );
    return ["http:", "https:", "mailto:"].includes(url.protocol)
      ? url.href
      : null;
  } catch {
    return null;
  }
}
