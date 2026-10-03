import assert from "node:assert/strict";
import { test } from "node:test";
import { generateAnswer, availableChatModels } from "../server/ai";
import { HttpError } from "../server/db";
import { providerCatalog } from "../shared/providers";
import { textResponse } from "./model-tools";

test("provider credentials cannot be satisfied by another provider's authentication fields", async () => {
  for (const provider of providerCatalog) {
    const config =
      provider.id === "vertex"
        ? { accessKeyId: "org-access", secretAccessKey: "org-secret" }
        : {
            googleAuthOptions: {
              credentials: {
                client_email: "org@example.test",
                private_key: "org-private",
              },
            },
          };
    const settings = {
      provider: provider.id,
      model: "model",
      credentials: { [provider.id]: { config } },
    };
    assert.deepEqual(availableChatModels(settings), []);
    await assert.rejects(
      generateAnswer(
        settings,
        "",
        [{ role: "user", content: "Hello" }],
        async () =>
          assert.fail("Unconfigured provider must not send a request"),
      ),
      (error: unknown) => error instanceof HttpError && error.status === 409,
    );
  }
});

test("OpenAI uses only the organization's explicit key", async (t) => {
  t.mock.property(process, "env", {
    ...process.env,
    OPENAI_API_KEY: "host-secret",
  });
  let authorization: string | null = null;
  const settings = {
    provider: "openai",
    model: "model",
    credentials: {
      openai: {
        apiKey: "org-secret",
        config: { baseURL: "https://provider.test/v1" },
      },
    },
  };
  await generateAnswer(
    settings,
    "",
    [{ role: "user", content: "Hello" }],
    async (_input, init) => {
      authorization = new Headers(init?.headers).get("authorization");
      return textResponse(JSON.parse(String(init?.body)), "Hello");
    },
  );
  assert.equal(authorization, "Bearer org-secret");
});

test("AWS providers do not inherit host bearer or session tokens with explicit signing keys", async (t) => {
  t.mock.property(process, "env", {
    ...process.env,
    AWS_BEARER_TOKEN_BEDROCK: "host-bearer",
    ANTHROPIC_AWS_API_KEY: "host-anthropic",
    AWS_SESSION_TOKEN: "host-session",
    AWS_ACCESS_KEY_ID: "host-access",
    AWS_SECRET_ACCESS_KEY: "host-secret",
  });
  for (const provider of ["bedrock", "anthropic-aws"]) {
    let headers: Headers | undefined;
    await assert.rejects(
      generateAnswer(
        {
          provider,
          model: "model",
          credentials: {
            [provider]: {
              config: {
                region: "us-east-1",
                workspaceId: "org-workspace",
                accessKeyId: "org-access",
                secretAccessKey: "org-secret",
                baseURL: "https://provider.test",
              },
            },
          },
        },
        "",
        [{ role: "user", content: "Hello" }],
        async (_input, init) => {
          headers = new Headers(init?.headers);
          return new Response("Invalid request", { status: 400 });
        },
      ),
    );
    assert.ok(headers);
    assert.match(headers.get("authorization") ?? "", /Credential=org-access/);
    assert.ok(!JSON.stringify([...headers]).includes("host-"));
  }
});
