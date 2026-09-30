import { HttpError, type Actor, type Store } from "./db";

export async function authenticateToken(
  store: Store,
  token: string,
): Promise<Actor> {
  const current = await store.one<{
    user_id: string;
    org_id: string;
    role: string;
  }>(
    "SELECT s.user_id,s.org_id,m.role FROM auth_sessions s JOIN users u ON u.id=s.user_id JOIN members m ON m.org_id=s.org_id AND m.user_id=s.user_id WHERE s.id=? AND s.expires_at>now() AND u.email_verified=true",
    token,
  );
  if (!current) throw new HttpError(401, "Please sign in");
  const actor = {
    userId: current.user_id,
    orgId: current.org_id,
    role: current.role,
    token,
  };
  if (
    !(await store.permission(
      actor,
      "organization",
      actor.orgId,
      "active_member",
    ))
  )
    throw new HttpError(401, "Please sign in");
  return actor;
}
