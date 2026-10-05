import { createAuthClient } from "better-auth/react";
import { adminClient, organizationClient } from "better-auth/client/plugins";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { apiKeyClient } from "@better-auth/api-key/client";

export function authData<T>(result: {
  data: T;
  error: { message?: string } | null;
}): NonNullable<T> {
  if (result.error)
    throw new Error(
      result.error.message ?? "The request could not be completed.",
    );
  return result.data!;
}

export const authClient = createAuthClient({
  plugins: [
    adminClient(),
    organizationClient(),
    oauthProviderClient(),
    apiKeyClient(),
  ],
  disableDefaultFetchPlugins: true,
});

export async function organizationMembers(organizationId?: string) {
  const result = authData(
    await authClient.organization.listMembers({
      query: { organizationId, limit: 100 },
    }),
  );
  return result.members.map((member) => ({
    id: member.userId,
    membershipId: member.id,
    name: member.user.name,
    email: member.user.email,
    role: member.role,
  }));
}
