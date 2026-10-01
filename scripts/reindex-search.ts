import { resolve } from "node:path";
import { createStore } from "../server/db";
import type { ParsedDocument } from "../server/indexing";
import { buildSearchProfile } from "../server/search-metadata";

const argument = (name: string) =>
  process.argv
    .find((value) => value.startsWith(`--${name}=`))
    ?.slice(name.length + 3);
const orgId = argument("org");
if (!orgId) throw new Error("An explicit --org organization ID is required");
const schema = argument("schema");
if (schema && !/^[a-z_][a-z0-9_]*$/.test(schema))
  throw new Error("Invalid database schema");
const url = new URL(process.env.DATABASE_URL!);
if (schema) url.searchParams.set("options", `-c search_path=${schema}`);
const store = await createStore(
  resolve(argument("data-dir") ?? process.env.DATA_DIR ?? ".data"),
  url.toString(),
);
try {
  const admin = await store.one<{ user_id: string }>(
    "SELECT user_id FROM members WHERE org_id=? AND role='admin' LIMIT 1",
    orgId,
  );
  if (
    !admin ||
    !(await store.permission(
      { orgId, userId: admin.user_id, role: "admin", token: "" },
      "organization",
      orgId,
      "active_member",
    ))
  )
    throw new Error("Organization administrator access is required");
  let cursor = "";
  let inspected = 0;
  let updated = 0;
  let conflicts = 0;
  while (true) {
    const resources = await store.all<{ id: string; parsed: string }>(
      "SELECT id,parsed FROM resources WHERE org_id=? AND kind='document' AND status='ready' AND parsed IS NOT NULL AND id>? ORDER BY id LIMIT 12",
      orgId,
      cursor,
    );
    if (!resources.length) break;
    for (const resource of resources) {
      cursor = resource.id;
      inspected++;
      const parsed = JSON.parse(resource.parsed) as ParsedDocument;
      if (parsed.searchProfileVersion === 1) continue;
      const next = {
        ...parsed,
        searchProfile: buildSearchProfile(parsed),
        searchProfileVersion: 1,
      };
      const result = await store.run(
        "UPDATE resources SET parsed=? WHERE id=? AND org_id=? AND status='ready' AND parsed=?",
        JSON.stringify(next),
        resource.id,
        orgId,
        resource.parsed,
      );
      updated += result.changes;
      conflicts += Number(result.changes === 0);
    }
  }
  console.log(JSON.stringify({ inspected, updated, conflicts }));
  if (conflicts) process.exitCode = 1;
} finally {
  await store.close();
}
