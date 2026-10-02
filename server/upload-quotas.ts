import { uploadLimits } from "../shared/uploads";
import { HttpError, type Store } from "./db";

export async function checkStoredDocumentQuota(
  store: Store,
  userId: string,
  orgId: string,
  additionalBytes: number,
  additionalDocuments = 0,
) {
  const rows = await store.all<{
    subject: string;
    size: string;
    count: string;
  }>(
    "SELECT subject,COUNT(*)::text AS count,COALESCE(SUM(size::bigint+OCTET_LENGTH(COALESCE(parsed,''))),0)::text AS size FROM resources CROSS JOIN LATERAL (VALUES ('deployment'),(CASE WHEN owner_id=? THEN 'user' END),(CASE WHEN org_id=? THEN 'organization' END)) s(subject) WHERE kind='document' AND subject IS NOT NULL GROUP BY subject",
    userId,
    orgId,
  );
  for (const row of rows) {
    const scope = row.subject as keyof typeof uploadLimits.storedBytes;
    if (Number(row.count) + additionalDocuments > uploadLimits.documents[scope])
      throw new HttpError(429, "Document count quota reached");
    if (Number(row.size) + additionalBytes > uploadLimits.storedBytes[scope])
      throw new HttpError(429, "Document storage quota reached");
  }
}
