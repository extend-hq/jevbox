import { Pool, type PoolClient, types as pgTypes } from "pg";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { resolve } from "node:path";
import {
  randomUUID,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import {
  createAuthorization,
  type Relationship,
  type PermissionCheck,
} from "./authorization";
import { HttpError } from "./errors";
import { createJobs, type Jobs } from "./jobs";
import { createFileStorage, createObjectStorage } from "./object-storage";
export { HttpError } from "./errors";
pgTypes.setTypeParser(20, (value) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n))
    throw new Error("Database integer exceeds safe range");
  return n;
});
export async function createStore(
  directory: string,
  databaseUrl = process.env.DATABASE_URL,
) {
  const objects = createObjectStorage();
  if (!databaseUrl)
    throw new Error(
      "DATABASE_URL is required. Start PostgreSQL and SpiceDB with pnpm services:up.",
    );
  const spiceUrl = process.env.SPICEDB_HTTP_URL;
  const spiceKey = process.env.SPICEDB_PRESHARED_KEY;
  if (!spiceUrl || !spiceKey)
    throw new Error("SPICEDB_HTTP_URL and SPICEDB_PRESHARED_KEY are required");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const keyPath = resolve(directory, "encryption.key");
  const configuredKey = process.env.ENCRYPTION_KEY;
  if (process.env.NODE_ENV === "production" && !configuredKey)
    throw new Error("ENCRYPTION_KEY is required in production");
  if (!configuredKey && !existsSync(keyPath))
    writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: "wx" });
  if (configuredKey && !/^[a-fA-F0-9]{64}$/.test(configuredKey))
    throw new Error("ENCRYPTION_KEY must contain 64 hexadecimal characters");
  const key = configuredKey
    ? Buffer.from(configuredKey, "hex")
    : readFileSync(keyPath);
  if (key.length !== 32) throw new Error("Invalid encryption key");
  const db = new Pool({
    connectionString: databaseUrl,
    max: 6,
    connectionTimeoutMillis: 5000,
  });
  const snapshotDb = new Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 5000,
  });
  const authDb = new Pool({
    connectionString: databaseUrl,
    max: 4,
    connectionTimeoutMillis: 5000,
  });
  for (const pool of [db, snapshotDb, authDb])
    pool.on("error", () => console.error("An idle database connection closed"));
  let jobs: Jobs | undefined;
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      await jobs?.close();
      objects?.close();
      await Promise.all([db.end(), snapshotDb.end(), authDb.end()]);
    })());
  const context = new AsyncLocalStorage<PoolClient>();
  const commitChecks = new AsyncLocalStorage<(() => Promise<void>)[]>();
  let savepointSequence = 0;
  const authPool = new Proxy(authDb, {
    get(pool, property) {
      if (property === "connect")
        return async () => {
          const client = context.getStore();
          if (!client) return pool.connect();
          const savepoint = `auth_${++savepointSequence}`;
          return new Proxy(client, {
            get(connection, field) {
              if (field === "release") return () => {};
              if (field === "query")
                return (sql: string, args?: unknown[]) => {
                  const command = sql.trim().toLowerCase();
                  if (/^(begin|start transaction)/.test(command))
                    return connection.query(`SAVEPOINT ${savepoint}`);
                  if (command === "commit")
                    return connection.query(`RELEASE SAVEPOINT ${savepoint}`);
                  if (command === "rollback")
                    return connection.query(
                      `ROLLBACK TO SAVEPOINT ${savepoint}`,
                    );
                  return connection.query(sql, args);
                };
              const value = Reflect.get(connection, field);
              return typeof value === "function"
                ? value.bind(connection)
                : value;
            },
          });
        };
      if (property === "query")
        return (sql: string, args?: unknown[]) =>
          (context.getStore() ?? pool).query(sql, args);
      const value = Reflect.get(pool, property);
      return typeof value === "function" ? value.bind(pool) : value;
    },
  });
  const authorization = createAuthorization(spiceUrl, spiceKey);
  function parameterize(sql: string) {
    let index = 0;
    return sql.replace(/'[^']*'|\?/g, (match) =>
      match === "?" ? `$${++index}` : match,
    );
  }
  async function all<T = Record<string, unknown>>(
    sql: string,
    ...args: any[]
  ): Promise<T[]> {
    return (await (context.getStore() ?? db).query(parameterize(sql), args))
      .rows as T[];
  }
  async function one<T = Record<string, unknown>>(
    sql: string,
    ...args: any[]
  ): Promise<T | undefined> {
    return (await all<T>(sql, ...args))[0];
  }
  async function publishPermissions(orgId: string) {
    const previous = await one<{ authz_version: string | null }>(
      "SELECT authz_version FROM orgs WHERE id=?",
      orgId,
    );
    if (!previous) return;
    const version = randomUUID();
    await snapshotDb.query("INSERT INTO authz_snapshots(version) VALUES($1)", [
      version,
    ]);
    const relationships: Relationship[] = [];
    const add = (
      kind: string,
      id: string,
      relation: string,
      subjectKind: string,
      subjectId: string,
    ) =>
      relationships.push({
        resource: {
          objectType: `jevbox/${kind}`,
          objectId: `${version}/${id}`,
        },
        relation,
        subject: {
          object: {
            objectType: `jevbox/${subjectKind}`,
            objectId:
              subjectKind === "user" || subjectKind === "link"
                ? subjectId
                : `${version}/${subjectId}`,
          },
        },
      });
    for (const member of await all<{ user_id: string; role: string }>(
      "SELECT user_id,role FROM members WHERE org_id=?",
      orgId,
    ))
      add(
        "organization",
        orgId,
        member.role === "admin" ? "admin" : "member",
        "user",
        member.user_id,
      );
    for (const resource of await all<Resource>(
      "SELECT * FROM resources WHERE org_id=?",
      orgId,
    )) {
      add("resource", resource.id, "organization", "organization", orgId);
      add("resource", resource.id, "owner", "user", resource.owner_id);
      if (resource.parent_id)
        add("resource", resource.id, "parent", "resource", resource.parent_id);
      else add("resource", resource.id, "root", "organization", orgId);
      if (resource.access === "organization")
        add("resource", resource.id, "org_access", "organization", orgId);
      if (resource.access === "inherit" && resource.parent_id)
        add(
          "resource",
          resource.id,
          "inherited",
          "resource",
          resource.parent_id,
        );
    }
    for (const link of await all<{ resource_id: string; token_hash: string }>(
      "SELECT l.resource_id,l.token_hash FROM share_links l JOIN resources r ON r.id=l.resource_id WHERE l.org_id=? AND r.access='link'",
      orgId,
    ))
      add("resource", link.resource_id, "link_viewer", "link", link.token_hash);
    for (const grant of await all<{
      resource_id: string;
      user_id: string;
      role: string;
    }>(
      "SELECT g.* FROM grants g JOIN resources r ON r.id=g.resource_id WHERE r.org_id=?",
      orgId,
    ))
      add("resource", grant.resource_id, grant.role, "user", grant.user_id);
    for (const chat of await all<{ id: string; user_id: string }>(
      "SELECT id,user_id FROM chats WHERE org_id=?",
      orgId,
    )) {
      add("chat", chat.id, "organization", "organization", orgId);
      add("chat", chat.id, "owner", "user", chat.user_id);
    }
    const zedToken = await authorization.write(relationships);
    await context
      .getStore()!
      .query("UPDATE orgs SET authz_version=$1,authz_token=$2 WHERE id=$3", [
        version,
        zedToken,
        orgId,
      ]);
    await context
      .getStore()!
      .query("DELETE FROM authz_dirty WHERE org_id=$1", [orgId]);
  }
  let writer = Promise.resolve();
  async function transaction<T>(fn: () => T | Promise<T>): Promise<T> {
    if (context.getStore()) return fn();
    const previous = writer;
    let unlock!: () => void;
    writer = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    await previous;
    let client: PoolClient | undefined;
    try {
      client = await db.connect();
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(194816, 1)");
      const result = await commitChecks.run([], () =>
        context.run(client!, async () => {
          const value = await fn();
          for (const row of await all<{ org_id: string }>(
            "SELECT org_id FROM authz_dirty ORDER BY org_id",
          ))
            await publishPermissions(row.org_id);
          for (const check of commitChecks.getStore()!) await check();
          return value;
        }),
      );
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client?.query("ROLLBACK");
      throw error;
    } finally {
      client?.release();
      unlock();
    }
  }
  async function run(sql: string, ...args: any[]) {
    const execute = async () => {
      const result = await (context.getStore() ?? db).query(
        parameterize(sql),
        args,
      );
      return { changes: result.rowCount ?? 0 };
    };
    return context.getStore() ? execute() : transaction(execute);
  }
  async function withPermissionSnapshot<T>(
    actor: Actor,
    check: (version: string, zedToken: string | null) => Promise<T>,
  ) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await one<{
        authz_version: string;
        authz_token: string | null;
      }>("SELECT authz_version,authz_token FROM orgs WHERE id=?", actor.orgId);
      if (!before?.authz_version)
        throw new HttpError(503, "Permissions are not initialized");
      const allowed = await check(before.authz_version, before.authz_token);
      const after = await one<{
        authz_version: string;
        authz_token: string | null;
      }>("SELECT authz_version,authz_token FROM orgs WHERE id=?", actor.orgId);
      if (
        after?.authz_version === before.authz_version &&
        after.authz_token === before.authz_token
      )
        return allowed;
    }
    throw new HttpError(503, "Permissions changed. Please retry.");
  }
  async function permission(
    actor: Actor,
    kind: "resource" | "chat" | "organization",
    id: string,
    action: string,
    subjectKind: "user" | "link" = "user",
  ) {
    return withPermissionSnapshot(actor, (version, zedToken) =>
      authorization.check(
        version,
        kind,
        id,
        action,
        actor.userId,
        subjectKind,
        zedToken,
      ),
    );
  }
  async function permissions(
    actor: Actor,
    kind: "resource" | "chat" | "organization",
    ids: string[],
    action: string,
    subjectKind: "user" | "link" = "user",
    cache?: PermissionCache,
  ) {
    return cachedPermissions(
      actor,
      ids.map((id) => ({ kind, id, permission: action })),
      (version, missing, zedToken) =>
        authorization.checkBulk(
          version,
          kind,
          missing.map(({ id }) => id),
          action,
          actor.userId,
          subjectKind,
          zedToken,
        ),
      subjectKind,
      cache,
    );
  }
  async function permissionsFor(
    actor: Actor,
    checks: PermissionCheck[],
    subjectKind: "user" | "link" = "user",
    cache?: PermissionCache,
  ) {
    return cachedPermissions(
      actor,
      checks,
      (version, missing, zedToken) =>
        authorization.checkMany(
          version,
          missing,
          actor.userId,
          subjectKind,
          zedToken,
        ),
      subjectKind,
      cache,
    );
  }
  async function cachedPermissions(
    actor: Actor,
    checks: PermissionCheck[],
    check: (
      version: string,
      missing: PermissionCheck[],
      zedToken: string | null,
    ) => Promise<boolean[]>,
    subjectKind: "user" | "link",
    cache?: PermissionCache,
  ) {
    if (!checks.length) return [];
    return withPermissionSnapshot(actor, async (version, zedToken) => {
      if (cache && (cache.version !== version || cache.zedToken !== zedToken)) {
        cache.version = version;
        cache.zedToken = zedToken;
        cache.values = new Map();
      }
      const values = cache?.values ?? new Map<string, boolean>();
      const key = ({
        kind,
        id,
        permission,
        zedToken: itemToken,
      }: PermissionCheck) =>
        JSON.stringify([
          kind,
          permission,
          subjectKind,
          actor.userId,
          id,
          itemToken === undefined ? zedToken : itemToken,
        ]);
      const unique = new Map(checks.map((item) => [key(item), item]));
      const missing = [...unique.values()].filter(
        (item) => !values.has(key(item)),
      );
      if (missing.length) {
        const allowed = await check(version, missing, zedToken);
        for (const [index, item] of missing.entries())
          values.set(key(item), allowed[index]);
      }
      return checks.map((item) => values.get(key(item))!);
    });
  }
  async function cleanupPermissions() {
    await transaction(async () => {
      const stale = await all<{ version: string }>(
        "SELECT version FROM authz_snapshots WHERE created < now() - interval '10 minutes' AND version NOT IN (SELECT authz_version FROM orgs WHERE authz_version IS NOT NULL) LIMIT 20",
      );
      for (const snapshot of stale) {
        await authorization.removeSnapshot(snapshot.version);
        await run(
          "DELETE FROM authz_snapshots WHERE version=?",
          snapshot.version,
        );
      }
    });
  }
  try {
    await transaction(async () => {
      await context
        .getStore()!
        .query(
          "CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY)",
        );
      const directory = new URL("./migrations/", import.meta.url);
      for (const migration of readdirSync(directory)
        .filter((file) => /^\d+-.*\.sql$/.test(file))
        .sort()) {
        const version = Number(migration.split("-")[0]);
        if (
          await one(
            "SELECT version FROM schema_migrations WHERE version=?",
            version,
          )
        )
          continue;
        await context
          .getStore()!
          .query(readFileSync(new URL(migration, directory), "utf8"));
        await context
          .getStore()!
          .query("INSERT INTO schema_migrations VALUES($1)", [version]);
      }
      await authorization.initialize();
      await context
        .getStore()!
        .query(
          "INSERT INTO authz_dirty(org_id) SELECT id FROM orgs ON CONFLICT DO NOTHING",
        );
    });
  } catch (error) {
    await close();
    throw error;
  }
  function encrypt(value: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    return Buffer.concat([
      iv,
      cipher.update(value),
      cipher.final(),
      cipher.getAuthTag(),
    ]).toString("base64");
  }
  function decrypt(value: string) {
    const data = Buffer.from(value, "base64");
    const cipher = createDecipheriv("aes-256-gcm", key, data.subarray(0, 12));
    cipher.setAuthTag(data.subarray(-16));
    return Buffer.concat([
      cipher.update(data.subarray(12, -16)),
      cipher.final(),
    ]).toString();
  }
  try {
    jobs = await createJobs({
      databaseUrl,
      schema: (await db.query("SELECT current_schema() AS schema")).rows[0]
        .schema,
      db: {
        executeSql: (sql, values) =>
          (context.getStore() ?? db).query(sql, values),
      },
      transaction,
      beforeCommit(check) {
        const checks = commitChecks.getStore();
        if (!checks) throw new Error("A commit check requires a transaction");
        checks.push(check);
      },
      encrypt,
    });
  } catch (error) {
    await close();
    throw error;
  }
  const files = createFileStorage(
    {
      one,
      all,
      run,
      transaction,
      async reserve(object) {
        await snapshotDb.query(
          "INSERT INTO storage_objects(bucket,object_key,sha256,size) VALUES($1,$2,$3,$4)",
          [object.bucket, object.object_key, object.sha256, object.size],
        );
      },
    },
    objects,
  );
  return {
    db,
    authDb,
    authPool,
    all,
    one,
    run,
    transaction,
    encrypt,
    decrypt,
    jobs,
    files,
    authorization,
    permission,
    permissions,
    permissionsFor,
    cleanupPermissions,
    close,
  };
}
export type Store = Awaited<ReturnType<typeof createStore>>;
export type PermissionCache = {
  version?: string;
  zedToken?: string | null;
  values: Map<string, boolean>;
};
export type Actor = {
  userId: string;
  orgId: string;
  role: string;
  token: string;
};
export type Resource = {
  id: string;
  org_id: string;
  owner_id: string;
  parent_id: string | null;
  kind: "folder" | "document";
  name: string;
  description: string;
  access: "restricted" | "organization" | "inherit" | "link";
  mime: string;
  size: number;
  status: string;
  error: string | null;
  parse_run: string | null;
  parse_requested: boolean;
  index_job_id: string | null;
  parsed: string | null;
  created: string;
  thumbnail_status: string;
  thumbnail_job_id: string | null;
  thumbnail_key: string | null;
  thumbnail_width: number | null;
  thumbnail_height: number | null;
  thumbnail_pages: number | null;
};

export async function resourceAccess(
  store: Store,
  actor: Actor,
  id: string,
  action: "read" | "write" | "share" = "read",
): Promise<boolean> {
  const resource = await store.one(
    "SELECT id FROM resources WHERE id=? AND org_id=?",
    id,
    actor.orgId,
  );
  return !!resource && store.permission(actor, "resource", id, action);
}
export async function resourceAccessBatch(
  store: Store,
  actor: Actor,
  ids: string[],
  action: "read" | "write" | "share" = "read",
  cache?: PermissionCache,
): Promise<Set<string>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Set();
  const resources = await store.all<{ id: string }>(
    "SELECT id FROM resources WHERE org_id=? AND id=ANY(?::text[])",
    actor.orgId,
    unique,
  );
  const scoped = new Set(resources.map((resource) => resource.id));
  const existing = unique.filter((id) => scoped.has(id));
  if (!existing.length) return new Set();
  const allowed = await store.permissions(
    actor,
    "resource",
    existing,
    action,
    "user",
    cache,
  );
  return new Set(existing.filter((_id, index) => allowed[index]));
}
export async function resourcePermissionsBatch(
  store: Store,
  actor: Actor,
  checks: { id: string; action: "read" | "write" | "share" }[],
  cache?: PermissionCache,
): Promise<boolean[]> {
  if (!checks.length) return [];
  const resources = await store.all<{ id: string }>(
    "SELECT id FROM resources WHERE org_id=? AND id=ANY(?::text[])",
    actor.orgId,
    [...new Set(checks.map(({ id }) => id))],
  );
  const scoped = new Set(resources.map(({ id }) => id));
  const existing = checks.filter(({ id }) => scoped.has(id));
  const allowed = await store.permissionsFor(
    actor,
    existing.map(({ id, action }) => ({
      kind: "resource",
      id,
      permission: action,
    })),
    "user",
    cache,
  );
  let index = 0;
  return checks.map(({ id }) => (scoped.has(id) ? allowed[index++] : false));
}
export async function requireResource(
  store: Store,
  actor: Actor,
  id: string,
  action: "read" | "write" | "share" = "read",
  cache?: PermissionCache,
) {
  const allowed = cache
    ? (await resourceAccessBatch(store, actor, [id], action, cache)).has(id)
    : await resourceAccess(store, actor, id, action);
  if (!allowed) throw new HttpError(404, "Resource not found");
  const resource = await store.one<Resource>(
    "SELECT * FROM resources WHERE id=? AND org_id=?",
    id,
    actor.orgId,
  );
  if (!resource) throw new HttpError(404, "Resource not found");
  return resource;
}
export async function requireResources(
  store: Store,
  actor: Actor,
  ids: string[],
  action: "read" | "write" | "share" = "read",
  cache?: PermissionCache,
): Promise<Resource[]> {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const allowed = await resourceAccessBatch(
    store,
    actor,
    unique,
    action,
    cache,
  );
  if (allowed.size !== unique.length)
    throw new HttpError(404, "Resource not found");
  const resources = await store.all<Resource>(
    "SELECT * FROM resources WHERE org_id=? AND id=ANY(?::text[])",
    actor.orgId,
    unique,
  );
  const byId = new Map(resources.map((resource) => [resource.id, resource]));
  return unique.map((id) => {
    const resource = byId.get(id);
    if (!resource) throw new HttpError(404, "Resource not found");
    return resource;
  });
}
export async function visibleResources(store: Store, actor: Actor) {
  const rows = await store.all<Resource>(
    "SELECT * FROM resources WHERE org_id=? ORDER BY created DESC",
    actor.orgId,
  );
  const allowed = await resourceAccessBatch(
    store,
    actor,
    rows.map((resource) => resource.id),
  );
  return rows.filter((resource) => allowed.has(resource.id));
}
