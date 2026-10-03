import { readFileSync } from "node:fs";
import { HttpError } from "./errors";
export type Relationship = {
  resource: { objectType: string; objectId: string };
  relation: string;
  subject: { object: { objectType: string; objectId: string } };
};
export type PermissionCheck = {
  kind: "resource" | "organization" | "chat";
  id: string;
  permission: string;
  zedToken?: string | null;
};
export const bulkPermissionBatchSize = 10_000;
export function createAuthorization(url: string, token: string) {
  const endpoint = new URL(url);
  if (
    !["http:", "https:"].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password
  )
    throw new Error("SPICEDB_HTTP_URL must be an HTTP(S) service endpoint");
  async function request(path: string, body: unknown) {
    try {
      const response = await fetch(new URL(path, endpoint), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
        redirect: "error",
      });
      if (!response.ok)
        throw new HttpError(
          503,
          "Permission service unavailable. Please retry.",
        );
      return await response.json();
    } catch {
      throw new HttpError(503, "Permission service unavailable. Please retry.");
    }
  }
  async function initialize() {
    const schema = readFileSync(
      new URL("./authorization.zed", import.meta.url),
      "utf8",
    );
    await request("/v1/schema/write", { schema });
  }
  async function ready() {
    await request("/v1/schema/read", {});
  }
  function requireToken(value: unknown): string {
    if (typeof value !== "string" || !value.length)
      throw new HttpError(503, "Permission service unavailable. Please retry.");
    return value;
  }
  function consistency(zedToken?: string | null) {
    return zedToken == null
      ? { fullyConsistent: true }
      : { atLeastAsFresh: { token: requireToken(zedToken) } };
  }
  async function write(relationships: Relationship[]) {
    if (!relationships.length) {
      const response = await request("/v1/schema/read", {});
      return requireToken(response?.readAt?.token);
    }
    let zedToken = "";
    for (let i = 0; i < relationships.length; i += 500) {
      const response = await request("/v1/relationships/write", {
        updates: relationships.slice(i, i + 500).map((relationship) => ({
          operation: "OPERATION_TOUCH",
          relationship,
        })),
      });
      zedToken = requireToken(response?.writtenAt?.token);
    }
    return zedToken;
  }
  async function check(
    version: string,
    kind: "resource" | "organization" | "chat",
    id: string,
    permission: string,
    userId: string,
    subjectKind: "user" | "link" = "user",
    zedToken?: string | null,
  ) {
    const response = await request("/v1/permissions/check", {
      consistency: consistency(zedToken),
      resource: { objectType: `jevbox/${kind}`, objectId: `${version}/${id}` },
      permission,
      subject: {
        object: { objectType: `jevbox/${subjectKind}`, objectId: userId },
      },
    });
    return response.permissionship === "PERMISSIONSHIP_HAS_PERMISSION";
  }
  async function checkBulk(
    version: string,
    kind: "resource" | "organization" | "chat",
    ids: string[],
    permission: string,
    userId: string,
    subjectKind: "user" | "link" = "user",
    zedToken?: string | null,
  ): Promise<boolean[]> {
    return checkMany(
      version,
      ids.map((id) => ({ kind, id, permission })),
      userId,
      subjectKind,
      zedToken,
    );
  }
  async function checkMany(
    version: string,
    checks: PermissionCheck[],
    userId: string,
    subjectKind: "user" | "link" = "user",
    zedToken?: string | null,
  ): Promise<boolean[]> {
    const allowed: boolean[] = new Array(checks.length);
    const groups = new Map<
      string | null,
      Map<string, { check: PermissionCheck; indices: number[] }>
    >();
    for (const [index, check] of checks.entries()) {
      const token =
        check.zedToken === undefined ? (zedToken ?? null) : check.zedToken;
      const group = groups.get(token) ?? new Map();
      groups.set(token, group);
      const key = JSON.stringify([check.kind, check.id, check.permission]);
      const item = group.get(key) ?? { check, indices: [] };
      item.indices.push(index);
      group.set(key, item);
    }
    for (const [token, group] of groups) {
      const entries = [...group.values()];
      for (let i = 0; i < entries.length; i += bulkPermissionBatchSize) {
        const batch = entries.slice(i, i + bulkPermissionBatchSize);
        const items = batch.map(({ check: { kind, id, permission } }) => ({
          resource: {
            objectType: `jevbox/${kind}`,
            objectId: `${version}/${id}`,
          },
          permission,
          subject: {
            object: { objectType: `jevbox/${subjectKind}`, objectId: userId },
          },
        }));
        const response = await request("/v1/permissions/checkbulk", {
          consistency: consistency(token),
          items,
        });
        if (
          !Array.isArray(response?.pairs) ||
          response.pairs.length !== items.length
        )
          throw new HttpError(
            503,
            "Permission service unavailable. Please retry.",
          );
        for (const [index, pair] of response.pairs.entries()) {
          const expected = items[index];
          if (
            !pair ||
            pair.error ||
            !pair.item ||
            pair.request?.resource?.objectType !==
              expected.resource.objectType ||
            pair.request?.resource?.objectId !== expected.resource.objectId ||
            pair.request?.permission !== expected.permission ||
            pair.request?.subject?.object?.objectType !==
              expected.subject.object.objectType ||
            pair.request?.subject?.object?.objectId !== userId
          )
            throw new HttpError(
              503,
              "Permission service unavailable. Please retry.",
            );
          for (const position of batch[index].indices)
            allowed[position] =
              pair.item.permissionship === "PERMISSIONSHIP_HAS_PERMISSION";
        }
      }
    }
    return allowed;
  }
  async function removeSnapshot(version: string) {
    for (const kind of ["organization", "resource", "chat"]) {
      await request("/v1/relationships/delete", {
        relationshipFilter: {
          resourceType: `jevbox/${kind}`,
          optionalResourceIdPrefix: `${version}/`,
        },
      });
    }
  }
  return {
    initialize,
    ready,
    write,
    check,
    checkBulk,
    checkMany,
    removeSnapshot,
  };
}
