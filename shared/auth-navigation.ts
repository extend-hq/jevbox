export const loginPath = "/login";

export function verificationDestination(
  url: URL,
  invite = url.searchParams.get("invite"),
) {
  const query = new URLSearchParams({ verified: "1" });
  if (invite) query.set("invite", invite);
  if (url.searchParams.has("returnTo"))
    query.set("returnTo", loginDestination(url));
  if (isOAuthLogin(url))
    for (const [key, value] of url.searchParams)
      if (!["verified", "error", "invite", "returnTo"].includes(key))
        query.append(key, value);
  return `${loginPath}?${query}`;
}

export function isAuthPage(pathname: string) {
  return pathname === loginPath || pathname === "/reset-password";
}

export function isOAuthLogin(url: URL) {
  return (
    url.searchParams.has("sig") &&
    (url.searchParams.has("client_id") || url.searchParams.has("request_uri"))
  );
}

export function loginDestination(url: URL) {
  const destination = url.searchParams.get("returnTo");
  if (
    !destination?.startsWith("/") ||
    destination.startsWith("//") ||
    /[\\\x00-\x1f\x7f]/.test(destination)
  )
    return "/library";
  try {
    const target = new URL(destination, url.origin);
    const appRoute =
      /^\/(?:library|documents|chats|search|settings|oauth\/consent)(?:\/|$)/.test(
        target.pathname,
      ) ||
      (target.pathname === "/" &&
        ["document", "folder"].some((parameter) =>
          target.searchParams.has(parameter),
        ));
    if (target.origin !== url.origin || !appRoute) return "/library";
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/library";
  }
}

export function loginRedirect(url: URL) {
  if (url.pathname === "/oauth/sign-in" || url.pathname === "/login/")
    return `${loginPath}${url.search}`;
  const query = new URLSearchParams();
  if (url.pathname === "/")
    for (const parameter of ["invite", "verified", "error"])
      if (url.searchParams.has(parameter))
        query.set(parameter, url.searchParams.get(parameter)!);
  if (!query.size && (url.pathname !== "/" || url.search)) {
    const destination = `${url.pathname}${url.search}${url.hash}`;
    const check = new URL(loginPath, url.origin);
    check.searchParams.set("returnTo", destination);
    if (loginDestination(check) === destination)
      query.set("returnTo", destination);
  }
  return `${loginPath}${query.size ? `?${query}` : ""}`;
}
