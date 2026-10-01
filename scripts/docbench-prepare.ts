import { Pool } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createStore, type Resource } from "../server/db";
import { getSettings } from "../server/providers";
import { enqueueIndex } from "../server/indexing-jobs";
import { createWorkers } from "../server/workers";
import { queues } from "../server/jobs";

const directory = resolve(process.env.DOCBENCH_DIR ?? ".data/docbench");
const configPath = resolve(directory, "benchmark.json");
const main = await createStore(resolve(process.env.DATA_DIR ?? ".data"));
let benchmark: Awaited<ReturnType<typeof createStore>> | undefined;
let workers: ReturnType<typeof createWorkers> | undefined;
const admin = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const members = await main.all<{ org_id: string; user_id: string }>(
    "SELECT org_id,user_id FROM members WHERE role='admin'",
  );
  const member = members.find(
    (m) =>
      !process.env.DOCBENCH_ORG_ID || m.org_id === process.env.DOCBENCH_ORG_ID,
  );
  if (!member)
    throw new Error("A benchmark organization administrator is required");
  const actor = {
    orgId: member.org_id,
    userId: member.user_id,
    role: "admin",
    token: "",
  };
  if (
    !(await main.permission(
      actor,
      "organization",
      actor.orgId,
      "active_member",
    ))
  )
    throw new Error("Organization access is unavailable");
  const settings = await getSettings(main, actor.orgId);
  if (!settings.extendKey || !settings.jevKey)
    throw new Error(
      "Configure parsing and retrieval before preparing the benchmark",
    );
  let config: {
    schema: string;
    orgId: string;
    userId: string;
    sourceOrgId: string;
  };
  try {
    config = JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    config = {
      schema: `docbench_${randomUUID().replaceAll("-", "")}`,
      orgId: randomUUID(),
      userId: randomUUID(),
      sourceOrgId: actor.orgId,
    };
    await admin.query(`CREATE SCHEMA "${config.schema}"`);
    await writeFile(configPath, JSON.stringify(config, null, 2));
  }
  if (
    !/^docbench_[a-f0-9]{32}$/.test(config.schema) ||
    config.sourceOrgId !== actor.orgId
  )
    throw new Error("The benchmark database does not match this workspace");
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set("options", `-c search_path=${config.schema}`);
  benchmark = await createStore(resolve(directory, "store"), url.toString());
  const store = benchmark;
  const manifest = JSON.parse(
    await readFile(resolve(directory, "manifest.json"), "utf8"),
  ) as {
    benchmarkId: number;
    domain: string;
    path: string;
    qaPath: string;
    originalName: string;
    sha256: string;
    size: number;
  }[];
  const originals = await main.all<Resource & { body: Buffer }>(
    "SELECT r.*,b.body FROM resources r JOIN blobs b ON b.resource_id=r.id WHERE r.org_id=? AND r.kind='document' AND r.status='ready'",
    actor.orgId,
  );
  const byHash = new Map(
    originals.map((r) => [
      createHash("sha256").update(r.body).digest("hex"),
      r,
    ]),
  );
  await store.transaction(async () => {
    await store.run(
      "INSERT INTO users(id,email,name,email_verified) VALUES(?,?,?,true) ON CONFLICT DO NOTHING",
      config.userId,
      `${config.userId}@benchmark.local`,
      "Benchmark",
    );
    await store.run(
      "INSERT INTO orgs(id,name,settings) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET settings=EXCLUDED.settings",
      config.orgId,
      "Benchmark",
      store.encrypt(
        JSON.stringify({ ...settings, organization: { enabled: false } }),
      ),
    );
    await store.run(
      "INSERT INTO members(org_id,user_id,role) VALUES(?,?,'admin') ON CONFLICT DO NOTHING",
      config.orgId,
      config.userId,
    );
    for (const domain of [...new Set(manifest.map((m) => m.domain))]) {
      await store.run(
        "INSERT INTO resources(id,org_id,owner_id,kind,name,description,created) VALUES(?,?,?,'folder',?,?,?) ON CONFLICT DO NOTHING",
        `domain-${domain}`,
        config.orgId,
        config.userId,
        domain,
        `Public ${domain.toLowerCase()} documents.`,
        new Date().toISOString(),
      );
    }
  });
  await mkdir(resolve(directory, "parsed"), { recursive: true });
  let reused = 0;
  for (const item of manifest) {
    const id = `document-${item.benchmarkId}`;
    if (await store.one("SELECT id FROM resources WHERE id=?", id)) continue;
    const body = await readFile(item.path);
    if (
      body.length !== item.size ||
      createHash("sha256").update(body).digest("hex") !== item.sha256
    )
      throw new Error("Benchmark source integrity check failed");
    const existing = byHash.get(item.sha256);
    let parsed = existing?.parsed;
    if (!parsed) {
      try {
        parsed = await readFile(
          resolve(directory, "parsed", `${item.benchmarkId}.json`),
          "utf8",
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    if (parsed) reused++;
    await store.transaction(async () => {
      await store.run(
        "INSERT INTO resources(id,org_id,owner_id,parent_id,kind,name,mime,size,status,parsed,created) VALUES(?,?,?,?,'document',?,'application/pdf',?,?,?,?)",
        id,
        config.orgId,
        config.userId,
        `domain-${item.domain}`,
        item.originalName,
        body.length,
        parsed ? "ready" : "queued",
        parsed ?? null,
        new Date().toISOString(),
      );
      await store.files.write("document", id, body, "application/pdf");
      if (!parsed) await enqueueIndex(store, id);
    });
  }
  console.log(
    JSON.stringify({
      schema: config.schema,
      documents: manifest.length,
      reusedIndexes: reused,
    }),
  );
  workers = createWorkers(store, { origin: "http://localhost:4310" });
  await workers.start([queues.index, queues.failed]);
  const started = Date.now();
  const saved = new Set<string>();
  while (true) {
    const rows = await store.all<{
      id: string;
      status: string;
      parsed: string | null;
      error: string | null;
    }>("SELECT id,status,parsed,error FROM resources WHERE kind='document'");
    for (const row of rows) {
      if (row.parsed && !saved.has(row.id)) {
        await writeFile(
          resolve(
            directory,
            "parsed",
            `${row.id.replace("document-", "")}.json`,
          ),
          row.parsed,
        );
        saved.add(row.id);
      }
    }
    const statuses = rows.reduce<Record<string, number>>(
      (counts, r) => ((counts[r.status] = (counts[r.status] ?? 0) + 1), counts),
      {},
    );
    console.log(
      JSON.stringify({
        seconds: Math.round((Date.now() - started) / 1000),
        statuses,
      }),
    );
    if (!rows.some((r) => ["queued", "processing"].includes(r.status))) {
      await writeFile(
        resolve(directory, "preparation.json"),
        JSON.stringify(
          {
            statuses,
            failures: rows
              .filter((r) => r.status !== "ready")
              .map(({ id, status, error }) => ({ id, status, error })),
          },
          null,
          2,
        ),
      );
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }
} finally {
  await workers?.close();
  await benchmark?.close();
  await main.close();
  await admin.end();
}
