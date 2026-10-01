import { Node, mergeAttributes, type JSONContent } from "@tiptap/react";

const documentPath =
  /^\/library\/documents\/([\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12})$/i;
function nodeText(nodes: JSONContent[]): string {
  return nodes
    .map((node) => node.text ?? nodeText(node.content ?? []))
    .join("");
}

export function promptDocumentExtension(
  isAllowed: (id: string) => boolean = () => true,
) {
  return Node.create({
    name: "promptDocument",
    priority: 1000,
    group: "inline",
    inline: true,
    atom: true,
    marks: "",
    addAttributes() {
      return {
        id: {
          default: "",
          parseHTML: (element) => element.getAttribute("data-document-id"),
          renderHTML: (attributes) => ({ "data-document-id": attributes.id }),
        },
        name: {
          default: "",
          parseHTML: (element) => element.getAttribute("data-document-name"),
          renderHTML: (attributes) => ({
            "data-document-name": attributes.name,
          }),
        },
        mime: { default: "", rendered: false },
        status: { default: "ready", rendered: false },
        error: { default: null, rendered: false },
      };
    },
    parseHTML() {
      return [
        {
          tag: "span[data-document-id]",
          getAttrs: (element) => {
            const id = element.getAttribute("data-document-id") ?? "";
            return documentPath.test(`/library/documents/${id}`) &&
              isAllowed(id)
              ? null
              : false;
          },
        },
      ];
    },
    renderHTML({ node, HTMLAttributes }) {
      return [
        "span",
        mergeAttributes(HTMLAttributes, { "data-prompt-document": "" }),
        node.attrs.name,
      ];
    },
    renderText({ node }) {
      return `@${node.attrs.name}`;
    },
    markdownTokenName: "link",
    parseMarkdown(token, helpers) {
      const id = documentPath.exec(String(token.href ?? ""))?.[1];
      if (!id || !isAllowed(id))
        return helpers.applyMark(
          "link",
          helpers.parseInline(token.tokens ?? []),
          { href: token.href, title: token.title ?? null },
        );
      return {
        type: "promptDocument",
        attrs: { id, name: nodeText(helpers.parseInline(token.tokens ?? [])) },
      };
    },
    renderMarkdown(node) {
      const name = String(node.attrs?.name ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/([\\[\]`*_~])/g, "\\$1")
        .replace(/[\r\n]/g, " ");
      return `[${name}](/library/documents/${node.attrs?.id})`;
    },
  });
}
export const PromptDocument = promptDocumentExtension();
