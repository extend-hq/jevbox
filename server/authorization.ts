import { readFileSync } from "node:fs";
import { HttpError } from "./errors";
export type Relationship = {
  resource: { objectType: string; objectId: string };
  relation: string;
  subject: { object: { objectType: string; objectId: string } };
};
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
  async function write(relationships: Relationship[]) {
    for (let i = 0; i < relationships.length; i += 500) {
      await request("/v1/relationships/write", {
        updates: relationships.slice(i, i + 500).map((relationship) => ({
          operation: "OPERATION_TOUCH",
          relationship,
        })),
      });
    }
  }
  async function check(
    version: string,
    kind: "resource" | "organization" | "chat",
    id: string,
    permission: string,
    userId: string,
    subjectKind: "user" | "link" = "user",
  ) {
    const response = await request("/v1/permissions/check", {
      consistency: { fullyConsistent: true },
      resource: { objectType: `jevbox/${kind}`, objectId: `${version}/${id}` },
      permission,
      subject: {
        object: { objectType: `jevbox/${subjectKind}`, objectId: userId },
      },
    });
    return response.permissionship === "PERMISSIONSHIP_HAS_PERMISSION";
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
  return { initialize, ready, write, check, removeSnapshot };
}
