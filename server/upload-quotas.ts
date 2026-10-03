import {
  uploadAdmissionLimits,
  type UploadAdmissionLimits,
} from "./upload-limits";
import { HttpError, type Store } from "./db";

export const uploadScopes = (userId: string, orgId: string) => [
  {
    key: "user" as const,
    subject: `user:${userId}`,
    where: "owner_id=?",
    args: [userId],
  },
  {
    key: "organization" as const,
    subject: `organization:${orgId}`,
    where: "org_id=?",
    args: [orgId],
  },
  {
    key: "deployment" as const,
    subject: "deployment",
    where: "TRUE",
    args: [],
  },
];

export async function checkStoredDocumentQuota(
  store: Store,
  userId: string,
  orgId: string,
  additionalBytes: number,
  additionalDocuments = 0,
  limits: UploadAdmissionLimits = uploadAdmissionLimits(),
) {
  for (const scope of uploadScopes(userId, orgId)) {
    const row = await store.one<{ size: string; count: string }>(
      `SELECT COUNT(*)::text AS count,COALESCE(SUM(size::bigint+OCTET_LENGTH(COALESCE(parsed,''))),0)::text AS size FROM resources WHERE kind='document' AND ${scope.where}`,
      ...scope.args,
    );
    if (
      Number(row?.count ?? 0) + additionalDocuments >
      limits.documents[scope.key]
    )
      throw new HttpError(429, "Document count quota reached");
    const used = Number(row?.size ?? 0);
    if (
      used + additionalBytes > limits.storedBytes[scope.key] ||
      (additionalDocuments > 0 && used >= limits.storedBytes[scope.key])
    )
      throw new HttpError(
        429,
        scope.key === "organization"
          ? "Organization storage limit reached. Delete documents to free space before uploading."
          : "Document storage quota reached",
      );
  }
}

export async function organizationStorage(store: Store, orgId: string) {
  const row = await store.one<{
    count: string;
    originals: string;
    index: string;
  }>(
    "SELECT COUNT(*)::text AS count,COALESCE(SUM(size::bigint),0)::text AS originals,COALESCE(SUM(OCTET_LENGTH(COALESCE(parsed,''))),0)::text AS index FROM resources WHERE kind='document' AND org_id=?",
    orgId,
  );
  const originalBytes = Number(row?.originals ?? 0);
  const indexBytes = Number(row?.index ?? 0);
  const limitBytes = uploadAdmissionLimits().storedBytes.organization;
  return {
    usedBytes: originalBytes + indexBytes,
    limitBytes,
    originalBytes,
    indexBytes,
    documents: Number(row?.count ?? 0),
  };
}
