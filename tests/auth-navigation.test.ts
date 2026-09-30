import assert from "node:assert/strict";
import { test } from "node:test";
import { loginDestination, loginRedirect } from "../shared/auth-navigation";

const origin = "https://app.test";

test("login redirects preserve protected destinations and legacy authentication links", () => {
  for (const destination of [
    "/library/folders/folder/documents/document?node=section&tab=index",
    "/chats/conversation",
    "/search?q=two+words",
    "/settings/api-keys",
    "/oauth/consent?client_id=client&sig=signature",
    "/?document=document&node=section",
  ]) {
    const login = new URL(loginRedirect(new URL(destination, origin)), origin);
    assert.equal(login.pathname, "/login");
    assert.equal(loginDestination(login), destination);
  }
  assert.equal(loginRedirect(new URL("/", origin)), "/login");
  assert.equal(
    loginRedirect(new URL("/?invite=invitation&verified=1", origin)),
    "/login?invite=invitation&verified=1",
  );
  assert.equal(
    loginRedirect(
      new URL("/oauth/sign-in?client_id=client&sig=signature", origin),
    ),
    "/login?client_id=client&sig=signature",
  );
  assert.equal(loginRedirect(new URL("/unknown", origin)), "/login");
});

test("post-login destinations reject external URLs, auth loops and protocol endpoints", () => {
  for (const destination of [
    "https://outside.test/library",
    "//outside.test/library",
    "/\\outside.test/library",
    "/library/../../login",
    "/login?returnTo=/library",
    "/reset-password?token=token",
    "/api/auth/sign-out",
    "/%2f%2foutside.test",
    "/library\n//outside.test",
    "javascript:alert(1)",
  ]) {
    const url = new URL("/login", origin);
    url.searchParams.set("returnTo", destination);
    assert.equal(loginDestination(url), "/library", destination);
  }
  assert.equal(loginDestination(new URL("/login", origin)), "/library");
});
