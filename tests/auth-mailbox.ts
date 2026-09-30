import assert from "node:assert/strict";
import type { AuthEmail } from "../server/auth-email";

export function authMailbox(origin: string) {
  const messages: AuthEmail[] = [];
  const headers = {
    Origin: origin,
    "X-Jevbox-Request": "1",
    "Content-Type": "application/json",
  };
  return {
    messages,
    sendAuthEmail: async (message: AuthEmail) => {
      messages.push(message);
    },
    async signIn(
      base: string,
      email: string,
      password = "a-secure-password-123!",
      invite?: string,
    ) {
      const verification = messages.findLast(
        (message) => message.to === email && message.kind === "verification",
      );
      assert.ok(verification, "Registration must send a verification email");
      const url = new URL(verification.url);
      const verified = await fetch(base + url.pathname + url.search, {
        redirect: "manual",
      });
      assert.ok(
        [200, 302].includes(verified.status),
        `Verification failed: ${verified.status}`,
      );
      const signedIn = await fetch(base + "/api/auth/sign-in/email", {
        method: "POST",
        headers,
        body: JSON.stringify({ email, password }),
      });
      assert.equal(signedIn.status, 200, await signedIn.text());
      const cookie = signedIn.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
      assert.ok(cookie);
      if (invite) {
        const accepted = await fetch(base + "/api/invitations/accept", {
          method: "POST",
          headers: { ...headers, Cookie: cookie },
          body: JSON.stringify({ token: invite }),
        });
        assert.equal(accepted.status, 200, await accepted.text());
      }
      return cookie;
    },
  };
}
