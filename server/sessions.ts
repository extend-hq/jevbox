import { HttpError, type Actor, type Store } from "./db";
import type { createAuthentication } from "./auth";
import { isAPIError } from "better-auth/api";

type Auth = ReturnType<typeof createAuthentication>["auth"];

export async function sessionActor(
  store: Store,
  auth: Auth,
  headers: Headers,
): Promise<Actor> {
  const current = await auth.api.getSession({
    headers,
    query: { disableCookieCache: true },
  });
  if (!current?.user.emailVerified) throw new HttpError(401, "Please sign in");
  const member = await auth.api.getActiveMember({ headers }).catch((error) => {
    if (isAPIError(error) && [400, 401, 403].includes(error.statusCode))
      return null;
    throw error;
  });
  if (!member) throw new HttpError(401, "Please sign in");
  const actor = {
    userId: current.user.id,
    orgId: member.organizationId,
    role: member.role,
    token: current.session.token,
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

export async function authenticateToken(
  store: Store,
  auth: Auth,
  token: string,
): Promise<Actor> {
  return sessionActor(
    store,
    auth,
    new Headers({ Authorization: `Bearer ${token}` }),
  );
}
