import { authMailbox } from "./auth-mailbox";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../server/app";
import { planFiling, createOrganization } from "../server/organization";
import { testDatabase } from "./database";
import { textResponse, choiceResponse } from "./model-tools";

const winner = (choices: { id: string }[], id: string) =>
  Object.fromEntries(
    choices.map((choice) => [
      choice.id,
      id === "here" && !choices.some((entry) => entry.id === "here")
        ? 1 / choices.length
        : Number(choice.id === id),
    ]),
  );
const proposal = JSON.stringify({
  folders: [
    { name: "Finance", description: "Financial records and accounting." },
    { name: "Invoices", description: "Bills and payment requests." },
  ],
});

test("an uncertain subfolder choice keeps the document in its suitable parent without generation", async () => {
  let generated = false;
  let decisions = 0;
  const plan = await planFiling({
    scopeId: null,
    folders: [
      {
        id: "parent",
        name: "Finance",
        description: "Financial records",
        parent_id: null,
      },
      { id: "a", name: "Invoices", description: "Bills", parent_id: "parent" },
      {
        id: "b",
        name: "Receipts",
        description: "Payments",
        parent_id: "parent",
      },
    ],
    decide: async (choices) =>
      ++decisions === 1
        ? winner(choices, "parent")
        : { a: 0.44, b: 0.43, here: 0.1, none: 0.03 },
    propose: async () => {
      generated = true;
      return proposal;
    },
  });
  assert.equal(plan.parentId, "parent");
  assert.equal(plan.reason, "ambiguous");
  assert.equal(generated, false);
});

test("a proposal is compared to existing choices and an equivalent existing folder wins", async () => {
  let decisions = 0;
  const plan = await planFiling({
    scopeId: null,
    folders: [
      {
        id: "existing",
        name: "Finance",
        description: "Financial records",
        parent_id: null,
      },
    ],
    decide: async (choices) =>
      winner(choices, ++decisions === 1 ? "none" : "existing"),
    propose: async () => proposal,
  });
  assert.equal(plan.parentId, "existing");
  assert.deepEqual(plan.branch, []);
});

test("an empty library proposes its first branch before asking JEV to validate the placement", async () => {
  let generated = false;
  const plan = await planFiling({
    scopeId: null,
    folders: [],
    decide: async (choices) => {
      assert.equal(generated, true);
      assert.ok(choices.some(({ id }) => id === "proposed"));
      return winner(choices, "proposed");
    },
    propose: async () => {
      generated = true;
      return proposal;
    },
  });
  assert.equal(plan.reason, "new_branch");
  assert.equal(plan.branch.length, 2);
  assert.equal(plan.trace.length, 1);
});

test("an uncertain root match proposes a branch and still requires a confident validation", async () => {
  for (const initial of [
    { existing: 0.55, none: 0.45 },
    { existing: 0.4, none: 0.6 },
  ]) {
    for (const validation of ["proposed", "existing", "uncertain"]) {
      let decisions = 0;
      let proposals = 0;
      const plan = await planFiling({
        scopeId: null,
        folders: [
          {
            id: "existing",
            name: "Finance",
            description: "Financial records",
            parent_id: null,
          },
        ],
        decide: async (choices) => {
          if (++decisions === 1) return initial;
          assert.ok(choices.some(({ id }) => id === "existing"));
          assert.ok(choices.some(({ id }) => id === "proposed"));
          return validation === "uncertain"
            ? Object.fromEntries(
                choices.map(({ id }) => [id, 1 / choices.length]),
              )
            : winner(choices, validation);
        },
        propose: async (parentId) => {
          assert.equal(parentId, null);
          proposals++;
          return proposal;
        },
      });
      assert.equal(proposals, 1);
      assert.equal(decisions, 2);
      assert.equal(
        plan.reason,
        validation === "proposed"
          ? "new_branch"
          : validation === "existing"
            ? "existing"
            : "proposal_rejected",
      );
      assert.equal(
        plan.parentId,
        validation === "existing" ? "existing" : null,
      );
      assert.deepEqual(
        plan.branch,
        validation === "proposed" ? JSON.parse(proposal).folders : [],
      );
    }
  }
});

test("large folder menus retain all children in bounded routing groups", async () => {
  const folders = Array.from({ length: 300 }, (_, i) => ({
    id: `folder-${i}`,
    name: `Category ${i}`,
    description: "Topic",
    parent_id: null,
  }));
  const plan = await planFiling({
    scopeId: null,
    folders,
    decide: async (choices) => {
      assert.ok(choices.length <= 18);
      const selected = choices.find(
        (choice) =>
          choice.id === "folder-299" || choice.text.includes("Category 299"),
      );
      return winner(choices, selected?.id ?? "here");
    },
    propose: async () => {
      throw new Error("Should not generate a branch");
    },
  });
  assert.equal(plan.parentId, "folder-299");
});

test("invalid proposals cannot escape the parent or introduce malformed paths", async () => {
  for (const output of [
    "not json",
    JSON.stringify({ folders: [{ name: "../escape", description: "Topic" }] }),
    JSON.stringify({
      folders: [{ name: "Finance", description: "Topic" }],
      parentId: "elsewhere",
    }),
  ]) {
    await assert.rejects(
      planFiling({
        scopeId: null,
        folders: [],
        decide: async (choices) => winner(choices, "none"),
        propose: async () => output,
      }),
      /invalid/,
    );
  }
});

let runtime: Awaited<ReturnType<typeof createApp>>;
let database: Awaited<ReturnType<typeof testDatabase>>;
let server: ReturnType<typeof runtime.app.listen>;
let directory: string, base: string;
const origin = "http://localhost:4310";
const mailbox = authMailbox(origin);
let choose: (
  choices: { id: string; text: string }[],
  state?: any,
) => Record<string, number> = (choices) => winner(choices, "here");
let generation = proposal;
let route: (body: any) => Response = choiceResponse;
let duringGeneration: (() => Promise<void>) | undefined;
let duringPlacement: (() => Promise<void>) | undefined;
const calls: { url: string; body: any }[] = [];
const fetcher: typeof fetch = async (input, init) => {
  const url = String(input);
  const body = JSON.parse(String(init?.body));
  calls.push({ url, body });
  if (url.includes("typesafe")) {
    if (body.questions.usefulness)
      return Response.json({
        answers: { usefulness: { type: "score", score: 3 } },
      });
    if (!body.questions.placement) return route(body);
    await duringPlacement?.();
    const question = body.questions.placement;
    const choices = Object.entries(question.criteria).map(([id, text]) => ({
      id,
      text: String(text),
    }));
    return Response.json({
      answers: {
        placement: {
          type: "choice",
          probabilities: choose(choices, body.state),
        },
      },
    });
  }
  assert.ok(
    body.input[0].content.includes("You propose a reusable folder branch"),
  );
  assert.equal(body.max_output_tokens, 600);
  await duringGeneration?.();
  return textResponse(body, generation);
};
async function req(path: string, cookie = "", method = "GET", body?: unknown) {
  const response = await fetch(base + "/api" + path, {
    method,
    headers: {
      Cookie: cookie,
      Origin: origin,
      "X-Jevbox-Request": "1",
      ...(body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
    },
    body:
      body instanceof FormData
        ? body
        : body === undefined
          ? undefined
          : JSON.stringify(body),
  });
  return {
    status: response.status,
    data: await response.json(),
    cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "",
  };
}
let users = 0;
async function account() {
  const email = `organizer-${++users}@local.test`;
  const response = await req("/auth/register", "", "POST", {
    name: "Organizer",
    email,
    password: "a-secure-password-123!",
    organization: "Workspace",
  });
  assert.equal(response.status, 201);
  const cookie = await mailbox.signIn(base, email);
  assert.equal(
    (
      await req("/settings", cookie, "PUT", {
        jevKey: "key",
        provider: "openai",
        providerKey: "key",
        model: "chat-model",
        models: ["folder-model"],
        organization: {
          enabled: true,
          model: { provider: "openai", model: "folder-model" },
        },
      })
    ).status,
    200,
  );
  return cookie;
}
async function folder(
  cookie: string,
  name: string,
  parentId: string | null = null,
) {
  const response = await req("/folders", cookie, "POST", {
    name,
    description: name,
    parentId,
  });
  assert.equal(response.status, 201);
  return response.data.id as string;
}
async function disableAutomatic(cookie: string) {
  const response = await req("/settings", cookie, "PUT", {
    chatProviders: [],
    organization: { enabled: false },
  });
  assert.equal(response.status, 200);
}
async function upload(cookie: string, parentId?: string, name = "incoming.md") {
  const form = new FormData();
  form.append(
    "file",
    new Blob(["# Billing\nAn invoice requesting payment for services."]),
    name,
  );
  if (parentId) form.append("parentId", parentId);
  const response = await req("/documents", cookie, "POST", form);
  assert.equal(response.status, 201);
  return response.data.id as string;
}
const row = (id: string) =>
  runtime.store.one<any>("SELECT * FROM resources WHERE id=?", id);
const job = (id: string) =>
  runtime.store.one<any>(
    "SELECT * FROM document_filing WHERE resource_id=?",
    id,
  );
before(async () => {
  database = await testDatabase();
  directory = mkdtempSync(join(tmpdir(), "jevbox-filing-"));
  runtime = await createApp({
    directory,
    databaseUrl: database.url,
    origin,
    fetcher,
    rateLimits: false,
    sendAuthEmail: mailbox.sendAuthEmail,
  });
  server = runtime.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  await runtime.closeChats();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await database.cleanup(runtime.store);
  rmSync(directory, { recursive: true, force: true });
});

test("incoming documents reuse a nested path and never generate folder names when it fits", async () => {
  const cookie = await account();
  const parent = await folder(cookie, "Finance");
  const child = await folder(cookie, "Invoices", parent);
  choose = (choices) =>
    winner(
      choices,
      choices.find(({ id }) => id === parent || id === child)?.id ?? "here",
    );
  const id = await upload(cookie);
  calls.length = 0;
  await runtime.tick();
  assert.equal((await row(id)).parent_id, child);
  assert.equal((await row(id)).access, "restricted");
  assert.equal((await job(id)).state, "completed");
  assert.equal(
    calls.some(({ url }) => url.includes("openai")),
    false,
  );
});

test("new branches use the selected naming model, are validated, and concurrent proposals reuse folders", async () => {
  const cookie = await account();
  choose = (choices) =>
    winner(
      choices,
      choices.some(({ id }) => id === "proposed") ? "proposed" : "none",
    );
  generation = proposal;
  const a = await upload(cookie),
    b = await upload(cookie);
  await runtime.store.run(
    "UPDATE resources SET parsed=?,status='ready' WHERE id IN (?,?)",
    JSON.stringify((await runtime.providers.processDocument((await row(a))!))!),
    a,
    b,
  );
  calls.length = 0;
  await Promise.all([
    createOrganization(runtime.store, fetcher).tick(),
    createOrganization(runtime.store, fetcher).tick(),
  ]);
  const first = await row(a),
    second = await row(b);
  assert.equal((await job(a)).state, "completed");
  assert.equal(first.parent_id, second.parent_id);
  assert.equal((await row(first.parent_id)).name, "Invoices");
  assert.equal(
    (
      await runtime.store.all(
        "SELECT id FROM resources WHERE org_id=? AND kind='folder'",
        first.org_id,
      )
    ).length,
    2,
  );
  assert.equal(
    calls
      .filter(({ url }) => url.includes("openai"))
      .every(({ body }) => body.model === "folder-model"),
    true,
  );
  assert.equal((await job(a)).state, "completed");
  assert.equal((await job(b)).state, "completed");
});

test("a chosen upload folder constrains filing and inaccessible folder labels never leave the server", async () => {
  const cookie = await account();
  const email = `member-${++users}@local.test`;
  const invitation = await req("/invitations", cookie, "POST", { email });
  assert.equal(invitation.status, 201);
  const member = await req("/auth/register", "", "POST", {
    name: "Member",
    email,
    password: "a-secure-password-123!",
    invite: new URL(invitation.data.url).searchParams.get("invite"),
  });
  assert.equal(member.status, 201);
  member.cookie = await mailbox.signIn(
    base,
    email,
    "a-secure-password-123!",
    new URL(invitation.data.url).searchParams.get("invite")!,
  );
  await folder(member.cookie, "Hidden category");
  const scope = await folder(cookie, "Chosen category");
  await folder(cookie, "Outside scope");
  choose = (choices) =>
    winner(
      choices,
      choices.some(({ id }) => id === "proposed") ? "proposed" : "none",
    );
  const id = await upload(cookie, scope);
  calls.length = 0;
  await runtime.tick();
  let parent = await row((await row(id)).parent_id);
  parent = await row(parent.parent_id);
  assert.equal(parent.parent_id, scope);
  assert.equal(JSON.stringify(calls).includes("Outside scope"), false);
  assert.equal(JSON.stringify(calls).includes("Hidden category"), false);
  const rootUpload = await upload(cookie);
  calls.length = 0;
  await runtime.tick();
  assert.equal((await job(rootUpload)).state, "completed");
  assert.equal(JSON.stringify(calls).includes("Hidden category"), false);
});

test("renaming a selected folder during generation prevents committing a stale placement", async () => {
  const cookie = await account();
  const destination = await folder(cookie, "Original category");
  const id = await upload(cookie);
  choose = (choices) =>
    winner(
      choices,
      choices.some(({ id }) => id === destination) ? destination : "none",
    );
  duringGeneration = async () => {
    assert.equal(
      (
        await req(`/resources/${destination}`, cookie, "PATCH", {
          name: "Changed category",
          description: "A different subject",
        })
      ).status,
      200,
    );
  };
  try {
    await runtime.tick();
  } finally {
    duringGeneration = undefined;
  }
  assert.equal((await row(id)).parent_id, null);
  assert.equal((await row(id)).status, "ready");
  assert.equal((await job(id)).state, "failed");
  assert.equal(
    (
      await runtime.store.all(
        "SELECT id FROM resources WHERE org_id=? AND kind='folder'",
        (await row(id)).org_id,
      )
    ).length,
    1,
  );
});

test("disabled filing makes no provider calls and expired worker leases are recoverable", async () => {
  const cookie = await account();
  assert.equal(
    (
      await req("/settings", cookie, "PUT", {
        chatProviders: [],
        organization: { enabled: false },
      })
    ).status,
    200,
  );
  const id = await upload(cookie);
  calls.length = 0;
  await runtime.tick();
  assert.equal((await job(id)).state, "disabled");
  assert.equal((await row(id)).status, "ready");
  assert.equal(calls.length, 0);
  await req("/settings", cookie, "PUT", {
    chatProviders: [],
    organization: { enabled: true },
  });
  assert.equal(
    (await req(`/documents/${id}/filing/retry`, cookie, "POST")).status,
    200,
  );
  await runtime.store.run(
    "UPDATE document_filing SET state='working',lease_id='expired',lease_until=now()-interval '1 minute' WHERE resource_id=?",
    id,
  );
  choose = (choices) => winner(choices, "here");
  await runtime.tick();
  assert.equal((await job(id)).state, "completed");
  assert.equal((await job(id)).lease_id, null);
});

test("manual placement wins over an in-flight proposal and leaves no generated folders", async () => {
  const cookie = await account();
  const destination = await folder(cookie, "Manual destination");
  const id = await upload(cookie);
  choose = (choices) =>
    winner(
      choices,
      choices.some(({ id }) => id === "proposed") ? "proposed" : "none",
    );
  duringGeneration = async () => {
    assert.equal(
      (
        await req(`/resources/${id}/move`, cookie, "POST", {
          parentId: destination,
        })
      ).status,
      200,
    );
  };
  try {
    await runtime.tick();
  } finally {
    duringGeneration = undefined;
  }
  assert.equal((await row(id)).parent_id, destination);
  assert.equal((await job(id)).outcome.reason, "manual");
  assert.equal(
    (
      await runtime.store.all(
        "SELECT id FROM resources WHERE org_id=? AND kind='folder'",
        (await row(id)).org_id,
      )
    ).length,
    1,
  );
});

test("sharing changes block filing without affecting the parsed index, and retry stays permission checked", async () => {
  const cookie = await account();
  const id = await upload(cookie);
  choose = (choices) => winner(choices, "none");
  duringGeneration = async () => {
    assert.equal(
      (
        await req(`/resources/${id}/access`, cookie, "PUT", {
          access: "organization",
          grants: [],
        })
      ).status,
      200,
    );
  };
  try {
    await runtime.tick();
  } finally {
    duringGeneration = undefined;
  }
  assert.equal((await row(id)).status, "ready");
  assert.equal((await row(id)).parent_id, null);
  assert.equal((await job(id)).state, "failed");
  const other = await account();
  assert.equal(
    (await req(`/documents/${id}/filing/retry`, other, "POST")).status,
    404,
  );
  assert.equal(
    (await req(`/documents/${id}/filing/retry`, cookie, "POST")).status,
    200,
  );
});

test("rejected proposals and missing connections keep documents in place", async () => {
  const cookie = await account();
  const id = await upload(cookie);
  choose = (choices) =>
    winner(
      choices,
      choices.some(({ id }) => id === "proposed") ? "here" : "none",
    );
  await runtime.tick();
  assert.equal((await job(id)).outcome.reason, "proposal_rejected");
  assert.equal((await row(id)).parent_id, null);
  await req("/settings", cookie, "PUT", { jevKey: "", chatProviders: [] });
  const waiting = await upload(cookie);
  calls.length = 0;
  await runtime.tick();
  assert.equal((await job(waiting)).state, "awaiting_key");
  assert.equal(calls.length, 0);
  await req("/settings", cookie, "PUT", { jevKey: "key", chatProviders: [] });
  assert.equal((await job(waiting)).state, "pending");
  choose = (choices) => winner(choices, "here");
  await runtime.tick();
});

test("uploads selectively review older documents, preserve manual placements, and reuse parsed content", async () => {
  const cookie = await account();
  await folder(cookie, "General records");
  const unrelatedFolder = await folder(cookie, "Unrelated category");
  choose = (choices, state) =>
    winner(
      choices,
      state.name === "unrelated.md" &&
        choices.some(({ id }) => id === unrelatedFolder)
        ? unrelatedFolder
        : "here",
    );
  const existing = await upload(cookie, undefined, "existing.md");
  const unrelated = await upload(cookie, undefined, "unrelated.md");
  const manual = await upload(cookie, undefined, "manual.md");
  await runtime.tick();
  const parsed = (await row(existing)).parsed;
  assert.equal(
    (await req(`/resources/${manual}/move`, cookie, "POST", { parentId: null }))
      .status,
    200,
  );
  calls.length = 0;
  route = (body) =>
    Response.json({
      answers: Object.fromEntries(
        Object.entries(body.questions).map(([id, question]: [string, any]) => {
          const choices = Object.keys(question.criteria);
          const selected =
            choices.find((choice) => choice === `document:${existing}`) ??
            choices.find(
              (choice) =>
                choice !== "none" && choice !== `category:${unrelatedFolder}`,
            ) ??
            "none";
          return [
            id,
            {
              type: "choice",
              probabilities: Object.fromEntries(
                choices.map((choice) => [choice, choice === selected ? 1 : 0]),
              ),
            },
          ];
        }),
      ),
    });
  choose = (choices, state) => {
    if (choices.some(({ id }) => id === "review"))
      return winner(
        choices,
        state.document.name === "existing.md" ? "review" : "stay",
      );
    if (choices.some(({ id }) => id === "move")) return winner(choices, "move");
    if (choices.some(({ id }) => id === "proposed"))
      return winner(choices, "proposed");
    return winner(
      choices,
      choices.find(({ text }) => /^(Finance|Invoices):/.test(text))?.id ??
        (choices.some(({ id }) => id === "here") ? "here" : "none"),
    );
  };
  const incoming = await upload(cookie);
  const secondIncoming = await upload(cookie);
  await runtime.tick();
  assert.equal(
    (await row(secondIncoming)).parent_id,
    (await row(incoming)).parent_id,
  );
  assert.equal((await job(existing)).state, "pending");
  assert.equal((await job(existing)).is_review, true);
  assert.equal((await job(unrelated)).state, "completed");
  assert.equal((await job(manual)).outcome.reason, "manual");
  await runtime.tick();
  assert.equal(
    (await row(existing)).parent_id,
    (await row(incoming)).parent_id,
  );
  assert.equal((await row(existing)).parsed, parsed);
  assert.equal((await job(existing)).outcome.reviewed, true);
  assert.equal((await row(unrelated)).parent_id, unrelatedFolder);
  assert.equal((await row(manual)).parent_id, null);
  assert.equal(calls.filter(({ url }) => url.includes("openai")).length, 1);
  assert.equal(
    JSON.stringify(
      calls.filter(({ body }) => body.state?.uploadAffectedPaths),
    ).includes("manual.md"),
    false,
  );
  assert.equal(
    JSON.stringify(
      calls.filter(
        ({ body }) =>
          body.questions?.placement &&
          !body.questions.placement.criteria.review,
      ),
    ).includes("unrelated.md"),
    false,
  );
  assert.equal(
    (
      await runtime.store.all(
        "SELECT id FROM organization_reviews WHERE org_id=? AND folder_ids @> ?::jsonb",
        (await row(existing)).org_id,
        JSON.stringify([(await row(incoming)).parent_id]),
      )
    ).length,
    1,
  );
  route = choiceResponse;
});

test("a review keeps an existing placement when the proposed move is not clearly better", async () => {
  const cookie = await account();
  await folder(cookie, "General records");
  choose = (choices) => winner(choices, "here");
  const existing = await upload(cookie);
  await runtime.tick();
  choose = (choices) => {
    if (choices.some(({ id }) => id === "review"))
      return winner(choices, "review");
    if (choices.some(({ id }) => id === "move"))
      return { move: 0.6, stay: 0.4 };
    if (choices.some(({ id }) => id === "proposed"))
      return winner(choices, "proposed");
    return winner(
      choices,
      choices.find(({ text }) => /^(Finance|Invoices):/.test(text))?.id ??
        (choices.some(({ id }) => id === "here") ? "here" : "none"),
    );
  };
  await upload(cookie);
  await runtime.tick();
  await runtime.tick();
  assert.equal((await row(existing)).parent_id, null);
  assert.equal((await job(existing)).outcome.reason, "review_kept");
});

test("explicit batch organization reconsiders manual placements across paths with automatic filing off", async () => {
  const cookie = await account();
  const original = await folder(cookie, "Original category");
  const destination = await folder(cookie, "Destination category");
  choose = (choices) => winner(choices, "here");
  const a = await upload(cookie, original),
    b = await upload(cookie, original);
  await runtime.tick();
  await req(`/resources/${a}/move`, cookie, "POST", { parentId: original });
  const parsed = (await row(a)).parsed;
  await req("/settings", cookie, "PUT", {
    chatProviders: [],
    organization: { enabled: false },
  });
  choose = (choices) =>
    winner(
      choices,
      choices.some(({ id }) => id === destination) ? destination : "here",
    );
  calls.length = 0;
  const organized = await req("/documents/organize", cookie, "POST", {
    ids: [a, a, b],
  });
  assert.equal(organized.status, 200);
  assert.equal(organized.data.count, 2);
  assert.equal(organized.data.completed, 2);
  assert.deepEqual(organized.data.failed, []);
  assert.equal((await job(a)).scope_id, null);
  assert.equal((await job(a)).outcome.requested, true);
  assert.equal((await row(a)).parent_id, destination);
  assert.equal((await row(b)).parent_id, destination);
  assert.equal((await row(a)).parsed, parsed);
  assert.equal((await job(a)).state, "completed");
  assert.equal(
    calls.some(({ url }) => url.includes("openai")),
    false,
  );
});

test("explicit batch organization creates a validated branch when no existing path fits", async () => {
  const cookie = await account();
  const original = await folder(cookie, "Original category");
  choose = (choices) => winner(choices, "here");
  const id = await upload(cookie, original);
  await runtime.tick();
  choose = (choices) =>
    winner(
      choices,
      choices.some(({ id }) => id === "proposed") ? "proposed" : "none",
    );
  assert.equal(
    (await req("/documents/organize", cookie, "POST", { ids: [id] })).status,
    200,
  );
  const parent = await row((await row(id)).parent_id);
  assert.equal(parent.name, "Invoices");
  const ancestor = await row(parent.parent_id);
  assert.equal(ancestor.name, "Finance");
  assert.equal(ancestor.parent_id, null);
  assert.equal((await job(id)).outcome.reason, "new_branch");
});

test("invalid selections reject organization atomically before claiming jobs or contacting providers", async () => {
  const cookie = await account();
  const scope = await folder(cookie, "Category");
  choose = (choices) => winner(choices, "here");
  const owned = await upload(cookie, scope),
    shared = await upload(cookie, scope);
  await runtime.tick();
  await req(`/resources/${shared}/access`, cookie, "PUT", {
    access: "organization",
    grants: [],
  });
  const outsider = await account();
  const foreign = await upload(outsider);
  const unindexed = await upload(cookie);
  const before = await job(owned);
  calls.length = 0;
  for (const [ids, expected] of [
    [[owned, foreign], 404],
    [[owned, shared], 409],
    [[owned, unindexed], 409],
    [[owned, scope], 409],
    [[], 400],
  ] as const) {
    assert.equal(
      (await req("/documents/organize", cookie, "POST", { ids })).status,
      expected,
    );
    assert.deepEqual(await job(owned), before);
  }
  assert.equal(calls.length, 0);
});

test("synchronous organization waits for bounded batches without holding the database transaction", async () => {
  const cookie = await account();
  const destination = await folder(cookie, "Target");
  await disableAutomatic(cookie);
  const ids = [];
  for (let i = 0; i < 7; i++)
    ids.push(await upload(cookie, undefined, `document-${i}.md`));
  await runtime.tick();
  await runtime.tick();
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const firstBatch = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let active = 0,
    maximum = 0,
    starts = 0,
    finished = false;
  duringPlacement = async () => {
    active++;
    maximum = Math.max(maximum, active);
    if (++starts === 3) entered();
    await gate;
    active--;
  };
  choose = (choices) =>
    winner(
      choices,
      choices.some(({ id }) => id === destination) ? destination : "here",
    );
  const request = req("/documents/organize", cookie, "POST", { ids }).then(
    (response) => {
      finished = true;
      return response;
    },
  );
  try {
    await Promise.race([
      firstBatch,
      new Promise((_, reject) => {
        setTimeout(
          () =>
            reject(
              new Error(
                "Classification did not start three concurrent documents",
              ),
            ),
          10000,
        ).unref();
      }),
    ]);
    assert.equal(finished, false);
    assert.equal(starts, 3);
    await folder(cookie, "Concurrent category");
    release();
    const response = await request;
    assert.equal(response.status, 200);
    assert.equal(response.data.completed, 7);
    assert.deepEqual(response.data.failed, []);
    assert.equal(maximum, 3);
    for (const id of ids) {
      assert.equal((await row(id)).parent_id, destination);
      assert.equal((await job(id)).state, "completed");
    }
  } finally {
    release();
    duringPlacement = undefined;
    await request;
  }
});

test("synchronous organization reports individual failures and preserves successful placements", async () => {
  const cookie = await account();
  const destination = await folder(cookie, "Target");
  await disableAutomatic(cookie);
  const a = await upload(cookie, undefined, "valid.md"),
    b = await upload(cookie, undefined, "invalid.md");
  await runtime.tick();
  choose = (choices, state) =>
    JSON.stringify(state).includes("invalid.md")
      ? {}
      : winner(
          choices,
          choices.some(({ id }) => id === destination) ? destination : "here",
        );
  const response = await req("/documents/organize", cookie, "POST", {
    ids: [a, b],
  });
  assert.equal(response.status, 200);
  assert.equal(response.data.completed, 1);
  assert.equal(response.data.failed.length, 1);
  assert.equal(response.data.failed[0].id, b);
  assert.ok(response.data.failed[0].error);
  assert.equal((await row(a)).parent_id, destination);
  assert.equal((await row(b)).parent_id, null);
  assert.equal((await job(b)).state, "failed");
});

test("the root has no keep-here category and a missing fit creates a validated new branch", async () => {
  const cookie = await account();
  await folder(cookie, "Unrelated topic");
  await disableAutomatic(cookie);
  const id = await upload(cookie);
  await runtime.tick();
  choose = (choices) => {
    assert.equal(
      choices.some(({ id }) => id === "here"),
      false,
    );
    return winner(
      choices,
      choices.some(({ id }) => id === "proposed") ? "proposed" : "none",
    );
  };
  const response = await req("/documents/organize", cookie, "POST", {
    ids: [id],
  });
  assert.equal(response.data.completed, 1);
  assert.deepEqual(response.data.failed, []);
  assert.equal((await row((await row(id)).parent_id)).name, "Invoices");
});

test("an uncertain root match organizes documents into a validated new branch", async () => {
  const cookie = await account();
  const original = await folder(cookie, "Original");
  await folder(cookie, "Alternative");
  await disableAutomatic(cookie);
  const root = await upload(cookie),
    nested = await upload(cookie, original);
  await runtime.tick();
  generation = proposal;
  choose = (choices) =>
    choices.some(({ id }) => id === "proposed")
      ? winner(choices, "proposed")
      : Object.fromEntries(choices.map(({ id }) => [id, 1 / choices.length]));
  const response = await req("/documents/organize", cookie, "POST", {
    ids: [root, nested],
  });
  assert.equal(response.status, 200);
  assert.equal(response.data.completed, 2, JSON.stringify(response.data));
  assert.deepEqual(response.data.failed, []);
  const destination = (await row(root)).parent_id;
  assert.equal((await row(destination)).name, "Invoices");
  assert.equal((await row(nested)).parent_id, destination);
  for (const id of [root, nested]) {
    assert.equal((await job(id)).state, "completed");
    assert.equal((await job(id)).outcome.reason, "new_branch");
  }
});

test("unresolved root classification is not counted as organized and preserves the original placement", async () => {
  const cookie = await account();
  const original = await folder(cookie, "Original");
  await folder(cookie, "Alternative");
  await disableAutomatic(cookie);
  const root = await upload(cookie),
    nested = await upload(cookie, original);
  await runtime.tick();
  choose = (choices) =>
    Object.fromEntries(choices.map(({ id }) => [id, 1 / choices.length]));
  const response = await req("/documents/organize", cookie, "POST", {
    ids: [root, nested],
  });
  assert.equal(response.data.completed, 0, JSON.stringify(response.data));
  assert.equal(response.data.failed.length, 2);
  assert.ok(
    response.data.failed.every((failure: { error: string }) =>
      failure.error.includes("No confident folder match"),
    ),
    JSON.stringify(response.data),
  );
  assert.equal((await row(root)).parent_id, null);
  assert.equal((await row(nested)).parent_id, original);
});
