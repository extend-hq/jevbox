import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import type { Store } from "../server/db";

export async function testDatabase() {
  if (!process.env.DATABASE_URL)
    throw new Error(
      "Start local services and configure .env before running tests",
    );
  const schema = "test_" + randomUUID().replaceAll("-", "");
  const admin = new Pool({ connectionString: process.env.DATABASE_URL });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set("options", `-c search_path=${schema}`);
  return {
    url: url.toString(),
    async cleanup(store?: Store) {
      try {
        if (store) {
          const snapshots = await store.all<{ version: string }>(
            "SELECT version FROM authz_snapshots",
          );
          for (const { version } of snapshots)
            await store.authorization.removeSnapshot(version);
        }
      } finally {
        try {
          await store?.close();
        } finally {
          try {
            await admin.query(`DROP SCHEMA IF EXISTS "${schema}_jobs" CASCADE`);
            await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
          } finally {
            await admin.end();
          }
        }
      }
    },
  };
}
