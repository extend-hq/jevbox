import {
  uploadAdmissionLimits,
  type UploadAdmissionLimits,
} from "./upload-limits";
import { HttpError, type Store } from "./db";

export async function checkStoredDocumentQuota(
  store: Store,
  userId: string,
  orgId: string,
  additionalBytes: number,
  additionalDocuments = 0,
  limits: UploadAdmissionLimits = uploadAdmissionLimits(),
) {
  if (
    !Number.isFinite(limits.documents.user) &&
    !Number.isFinite(limits.storedBytes.user)
  )
    return;
  const row = await store.one<{ size: string; count: string }>(
    "SELECT COUNT(*)::text AS count,COALESCE(SUM(size::bigint+OCTET_LENGTH(COALESCE(parsed,''))),0)::text AS size FROM resources WHERE kind='document' AND owner_id=?",
    userId,
  );
  if (Number(row?.count ?? 0) + additionalDocuments > limits.documents.user)
    throw new HttpError(429, "Document count quota reached");
  if (Number(row?.size ?? 0) + additionalBytes > limits.storedBytes.user)
    throw new HttpError(429, "Document storage quota reached");
}
