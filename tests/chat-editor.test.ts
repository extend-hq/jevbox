import assert from "node:assert/strict";
import { after, test } from "node:test";
import { JSDOM } from "jsdom";
import { Editor } from "@tiptap/react";
import {
  promptExtensions,
  pastedSpreadsheet,
  isMarkdownTable,
  promptLink,
} from "../src/lib/chat-editor";
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
});
for (const key of [
  "window",
  "document",
  "navigator",
  "Node",
  "HTMLElement",
  "Element",
  "MutationObserver",
  "DOMParser",
] as const)
  Object.defineProperty(globalThis, key, {
    value: dom.window[key],
    configurable: true,
  });
Object.assign(globalThis, {
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
});
after(() => dom.window.close());
function withEditor(
  content: string,
  run: (editor: Editor) => void,
  markdown = false,
) {
  const editor = new Editor({
    extensions: promptExtensions(),
    content,
    ...(markdown ? { contentType: "markdown" as const } : {}),
  });
  try {
    run(editor);
  } finally {
    editor.destroy();
  }
}
test("pasted HTML tables serialize all rows and inline formatting into Markdown", () => {
  withEditor(
    "<table><tbody><tr><th>Item</th><th>Count</th></tr><tr><td><strong>First</strong></td><td>2</td></tr><tr><td>Second</td><td>3</td></tr></tbody></table>",
    (editor) => {
      const markdown = editor.getMarkdown();
      assert.match(markdown, /\| Item\s*\| Count\s*\|/);
      assert.match(markdown, /\*\*First\*\*/);
      assert.match(markdown, /Second/);
      assert.equal(editor.getJSON().content?.[0].content?.length, 3);
      editor.commands.setContent(markdown, { contentType: "markdown" });
      assert.equal(editor.getJSON().content?.[0].type, "table");
      assert.equal(editor.getJSON().content?.[0].content?.length, 3);
    },
  );
});
test("spreadsheet paste preserves empty cells, quoted values, pipes, and row order", () => {
  const table = pastedSpreadsheet('Name\tValue\r\n"A | B"\t2\r\nLast\t\r\n');
  assert.ok(table);
  assert.equal(table.content?.length, 3);
  assert.equal(table.content?.[2].content?.length, 2);
  withEditor("", (editor) => {
    editor.commands.setContent(table);
    const markdown = editor.getMarkdown();
    assert.match(markdown, /A \\?\| B/);
    editor.commands.setContent(markdown, { contentType: "markdown" });
    const rows = editor.getJSON().content?.[0].content!;
    assert.equal(rows.length, 3);
    assert.ok("content" in rows[1]);
    assert.equal(rows[1].content?.length, 2);
  });
  assert.equal(pastedSpreadsheet("one\ntwo"), null);
  assert.equal(pastedSpreadsheet("a\tb\nc"), null);
});
test("headings, lists, links and marks survive the prompt Markdown round trip", () => {
  const markdown =
    "# Title\n\n**Bold** and *italic* [link](https://example.org)\n\n## Details\n\n- First\n- Second\n\n### Steps\n\n1. One\n2. Two";
  withEditor(
    markdown,
    (editor) => {
      const output = editor.getMarkdown();
      for (const part of [
        "# Title",
        "## Details",
        "### Steps",
        "**Bold**",
        "*italic*",
        "[link](https://example.org)",
        "1. One",
      ])
        assert.ok(output.includes(part), part);
      editor.commands.clearContent();
      assert.ok(editor.isEmpty);
    },
    true,
  );
  assert.ok(isMarkdownTable("| A | B |\n| --- | --- |\n| 1 | 2 |"));
  assert.equal(isMarkdownTable("ordinary | words"), false);
  assert.equal(promptLink("javascript:alert(1)"), null);
  assert.equal(promptLink("example.org"), "https://example.org/");
});
