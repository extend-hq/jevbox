import { MarkdownManager } from "@tiptap/markdown";

const markdown = new MarkdownManager({ extensions: [] }).instance;
type Token = {
  type: string;
  text?: string;
  href?: string;
  tokens?: Token[];
  items?: Token[];
  header?: { tokens: Token[] }[];
  rows?: { tokens: Token[] }[][];
};
function decodeEntities(value: string) {
  const entities: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return value.replace(
    /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
    (match, entity: string) => {
      if (!entity.startsWith("#"))
        return entities[entity.toLowerCase()] ?? match;
      const point =
        entity[1].toLowerCase() === "x"
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
      return point > 0 &&
        point <= 0x10ffff &&
        !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(point)
        : "\ufffd";
    },
  );
}

export function chatTitle(
  content: string,
  attachments: readonly { id: string; name: string }[] = [],
) {
  const names = new Map(
    attachments.map(({ id, name }) => [`/library/documents/${id}`, name]),
  );
  const text = (tokens: Token[], separator = ""): string =>
    tokens
      .map((token) => {
        if (token.type === "link" && names.has(token.href ?? ""))
          return names.get(token.href!)!;
        if (token.tokens) return text(token.tokens);
        if (token.items) return text(token.items, " ");
        if (token.type === "table")
          return [...(token.header ?? []), ...(token.rows ?? []).flat()]
            .map((cell) => text(cell.tokens))
            .join(" ");
        if (["space", "br", "hr"].includes(token.type)) return " ";
        return decodeEntities(
          token.type === "html"
            ? (token.text ?? "").replace(/<[^>]*>/g, "")
            : (token.text ?? ""),
        );
      })
      .join(separator);
  return [
    ...text(markdown.lexer(content) as Token[], " ")
      .replace(/\s+/g, " ")
      .trim(),
  ]
    .slice(0, 80)
    .join("");
}

export function chatTitleLabel(title: string) {
  const content = title.replace(
    /\[((?:\\.|[^\]\\])*)\]\(\/library\/documents\/[\da-f-]*(?:\))?/gi,
    "$1",
  );
  return content === title ? title : chatTitle(content);
}
