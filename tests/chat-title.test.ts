import assert from "node:assert/strict";
import { test } from "node:test";
import { chatTitle, chatTitleLabel } from "../shared/chat-title";

test("thread titles use literal attachment names before shortening the prompt", () => {
  const id = "b0af9e03-b9b5-4bfc-97e1-ed7a0d18449b";
  const name = "Budget [draft]* & <review> ~~note~~_2026.pdf";
  const content = `Compare [document](/library/documents/${id}) with the prior year.`;
  assert.equal(
    chatTitle(content, [{ id, name }]),
    `Compare ${name} with the prior year.`,
  );
  assert.equal(
    chatTitle(`[document](/library/documents/${id})`, [{ id, name }]),
    name,
  );
  assert.equal(
    chatTitle(`${content} ${"More details ".repeat(20)}`, [{ id, name }]),
    `Compare ${name} with the prior year. More details More details `.slice(
      0,
      80,
    ),
  );
});

test("thread titles flatten formatting and decode escaped link labels", () => {
  assert.equal(
    chatTitle("## Compare **this** and *that*\n\nNext"),
    "Compare this and that Next",
  );
  assert.equal(
    chatTitle(
      "Read [Budget \\[draft\\]\\* &amp; &lt;review&gt;.pdf](/library/documents/b0af9e03-b9b5-4bfc-97e1-ed7a0d18449b)",
    ),
    "Read Budget [draft]* & <review>.pdf",
  );
  assert.equal(
    chatTitle("Review `code` [website](https://example.org)."),
    "Review code website.",
  );
});

test("existing titles hide complete and truncated document destinations", () => {
  const reference =
    "Read [Budget \\[draft\\]\\*_2026.pdf](/library/documents/b0af9e03-b9b5-4bfc-97e1-ed7a0d18449b)";
  assert.equal(chatTitleLabel(reference), "Read Budget [draft]*_2026.pdf");
  assert.equal(
    chatTitleLabel(reference.slice(0, 70)),
    "Read Budget [draft]*_2026.pdf",
  );
  assert.equal(
    chatTitleLabel("Budget [draft]*_2026.pdf"),
    "Budget [draft]*_2026.pdf",
  );
});
