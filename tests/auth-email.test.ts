import { test } from "node:test";
import assert from "node:assert/strict";
import { createAuthEmailSender } from "../server/auth-email";

test("authentication sender requires a complete single mailbox", () => {
  const keys = ["SMTP_HOST", "AUTH_EMAIL_FROM"] as const;
  const previous = keys.map((key) => process.env[key]);
  try {
    process.env.SMTP_HOST = "smtp.local.test";
    for (const from of [
      "mail.local.test",
      "Sender <mail.local.test>",
      "first@local.test, second@local.test",
      "first@local.test\r\nBcc: second@local.test",
    ]) {
      process.env.AUTH_EMAIL_FROM = from;
      assert.throws(() => createAuthEmailSender(), /AUTH_EMAIL_FROM/);
    }
    for (const from of [
      "sender@local.test",
      "Sender <sender@local.test>",
      '"Sender, Team" <sender@local.test>',
    ]) {
      process.env.AUTH_EMAIL_FROM = from;
      assert.doesNotThrow(() => createAuthEmailSender());
    }
  } finally {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  }
});
