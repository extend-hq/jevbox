import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { strFromU8, unzipSync } from "fflate";
import { createApp } from "../server/app";
import { hashPassword } from "../server/auth-passwords";
import { archiveEntries } from "../server/downloads";
import type { Resource } from "../server/db";
import { testDatabase } from "./database";

const origin = "http://localhost:4310";
const ownerId = randomUUID(),
  readerId = randomUUID(),
  orgId = randomUUID();
let runtime: Awaited<ReturnType<typeof createApp>>;
let database: Awaited<ReturnType<typeof testDatabase>>;
let server: ReturnType<typeof runtime.app.listen>;
let base: string, owner: string, reader: string;
const directory = mkdtempSync(join(tmpdir(), "jevbox-downloads-"));
let folder: string,
  nested: string,
  empty: string,
  first: string,
  second: string,
  hidden: string;

async function request(path: string, cookie: string, body?: unknown) {
  return fetch(`${base}/api${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Cookie: cookie,
      Origin: origin,
      "X-Jevbox-Request": "1",
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function resource(
  name: string,
  parentId: string | null,
  content?: string,
  access = "restricted",
) {
  const id = randomUUID();
  await runtime.store.run(
    "INSERT INTO resources(id,org_id,owner_id,parent_id,kind,name,mime,status,access,created) VALUES(?,?,?,?,?,?,?,'stored',?,?)",
    id,
    orgId,
    ownerId,
    parentId,
    content === undefined ? "folder" : "document",
    name,
    content === undefined ? null : "text/plain",
    access,
    new Date().toISOString(),
  );
  if (content !== undefined)
    await runtime.store.run(
      "INSERT INTO blobs VALUES(?,?)",
      id,
      Buffer.from(content),
    );
  return id;
}
before(async () => {
  database = await testDatabase();
  runtime = await createApp({
    directory,
    databaseUrl: database.url,
    origin,
    workers: [],
    rateLimits: false,
  });
  await runtime.store.run(
    "INSERT INTO orgs(id,name) VALUES(?,?)",
    orgId,
    "Test workspace",
  );
  for (const [id, email, role] of [
    [ownerId, "owner@download.test", "admin"],
    [readerId, "reader@download.test", "member"],
  ]) {
    await runtime.store.run(
      "INSERT INTO users(id,email,name,email_verified) VALUES(?,?,?,true)",
      id,
      email,
      "Test user",
    );
    await runtime.store.run(
      "INSERT INTO auth_accounts(id,account_id,provider_id,user_id,password) VALUES(?,?,'credential',?,?)",
      randomUUID(),
      id,
      id,
      await hashPassword("Download-test-password!"),
    );
    await runtime.store.run(
      "INSERT INTO members(org_id,user_id,role) VALUES(?,?,?)",
      orgId,
      id,
      role,
    );
  }
  server = runtime.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}`;
  for (const email of ["owner@download.test", "reader@download.test"]) {
    const response = await request("/auth/sign-in/email", "", {
      email,
      password: "Download-test-password!",
    });
    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie")!.split(";")[0];
    if (email.startsWith("owner")) owner = cookie;
    else reader = cookie;
  }
  folder = await resource("Collection", null, undefined, "organization");
  nested = await resource("Nested", folder, undefined, "inherit");
  empty = await resource("Empty", folder, undefined, "inherit");
  first = await resource("First.txt", folder, "First original", "inherit");
  second = await resource("Second.txt", nested, "Second original", "inherit");
  hidden = await resource("Private.txt", folder, "Restricted original");
});
after(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  if (runtime) {
    await runtime.closeChats();
    await runtime.workers.close();
  }
  await database?.cleanup(runtime?.store);
  rmSync(directory, { recursive: true, force: true });
});
async function archive(ids: string[], cookie = owner) {
  const response = await request("/resources/download", cookie, { ids });
  assert.equal(
    response.status,
    200,
    await (response.ok ? Promise.resolve("") : response.text()),
  );
  assert.equal(response.headers.get("content-type"), "application/zip");
  return {
    files: unzipSync(new Uint8Array(await response.arrayBuffer())),
    response,
  };
}
test("multiple documents download as one ZIP with original bytes", async () => {
  const { files, response } = await archive([first, second]);
  assert.match(
    response.headers.get("content-disposition") ?? "",
    /Library.zip/,
  );
  assert.deepEqual(Object.keys(files).sort(), ["First.txt", "Second.txt"]);
  assert.equal(strFromU8(files["First.txt"]), "First original");
  assert.equal(strFromU8(files["Second.txt"]), "Second original");
});
test("folder ZIP preserves nested and empty folders without duplicating overlapping selections", async () => {
  const { files, response } = await archive([
    folder,
    nested,
    second,
    empty,
    folder,
  ]);
  assert.match(
    response.headers.get("content-disposition") ?? "",
    /Library.zip/,
  );
  assert.deepEqual(Object.keys(files).sort(), [
    "Collection/",
    "Collection/Empty/",
    "Collection/First.txt",
    "Collection/Nested/",
    "Collection/Nested/Second.txt",
    "Collection/Private.txt",
  ]);
  const single = await archive([folder]);
  assert.match(
    single.response.headers.get("content-disposition") ?? "",
    /Collection.zip/,
  );
});
test("folder ZIP omits unreadable descendants and rejects explicitly selected restricted resources", async () => {
  const { files } = await archive([folder], reader);
  assert.ok(files["Collection/First.txt"]);
  assert.ok(files["Collection/Nested/Second.txt"]);
  assert.equal(files["Collection/Private.txt"], undefined);
  assert.equal(
    (await request("/resources/download", reader, { ids: [folder, hidden] }))
      .status,
    404,
  );
  assert.equal(
    (await request("/resources/download", owner, { ids: [randomUUID()] }))
      .status,
    404,
  );
  assert.equal(
    (await request("/resources/download", "", { ids: [folder] })).status,
    401,
  );
});
test("archive paths avoid traversal and preserve duplicate filenames", () => {
  const resources = [
    { id: "a", name: "../A.txt", parent_id: null, kind: "document" },
    { id: "b", name: "../A.txt", parent_id: null, kind: "document" },
    { id: "c", name: "..", parent_id: null, kind: "folder" },
  ] as Resource[];
  assert.deepEqual(
    archiveEntries(resources, ["a", "b", "c"]).map(({ path }) => path),
    [".._A.txt", ".._A (2).txt", "untitled/"],
  );
});
