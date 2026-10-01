import assert from "node:assert/strict";
import { after, afterEach, beforeEach, test } from "node:test";
import { JSDOM } from "jsdom";
import type { Root } from "react-dom/client";
import type { Me } from "../src/lib/api";
import {
  parseModelList,
  validateEmail,
  validateLength,
  validateModelList,
  validateName,
  validatePassword,
  validateProviderConfig,
  validateRequiredText,
} from "../src/lib/form-validation";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://app.test/",
  pretendToBeVisual: true,
});
for (const key of [
  "window",
  "document",
  "navigator",
  "location",
  "history",
  "Node",
  "Element",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "HTMLFormElement",
  "MutationObserver",
  "Event",
  "CustomEvent",
  "MouseEvent",
  "KeyboardEvent",
  "FormData",
  "AbortController",
  "AbortSignal",
] as const) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: dom.window[key],
    writable: true,
  });
}
Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
});
dom.window.matchMedia = (query) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent: () => true,
});
dom.window.Element.prototype.getAnimations = () => [];

const originalFetch = globalThis.fetch;
let fetchImplementation = originalFetch;
globalThis.fetch = (...args) => fetchImplementation(...args);

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { Auth } = await import("../src/components/auth");
const { SettingsView } = await import("../src/components/settings");
const { Form } = await import("../src/components/coss/form");
const { Field, FieldLabel, FieldError } =
  await import("../src/components/coss/field");
const { Textarea } = await import("../src/components/coss/textarea");

type RequestCall = {
  path: string;
  method: string;
  body: Record<string, unknown>;
};
let root: Root;
let requests: RequestCall[];
let respond: (request: RequestCall) => Response;
const json = (data: unknown, status = 200) => Response.json(data, { status });

beforeEach(() => {
  history.replaceState({}, "", "/");
  requests = [];
  respond = (request) => {
    throw new Error(`Unexpected request: ${request.method} ${request.path}`);
  };
  fetchImplementation = async (input, init) => {
    const request = {
      path: new URL(String(input), location.origin).pathname,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : {},
    };
    requests.push(request);
    return respond(request);
  };
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
});
after(() => dom.window.close());

function element<T extends Element>(selector: string): T {
  const match = document.querySelector<T>(selector);
  assert.ok(match, `Missing element: ${selector}`);
  return match;
}
function control(name: string) {
  return element<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`);
}
function fieldError(name: string) {
  return control(name)
    .closest('[data-slot="field"]')
    ?.querySelector('[data-slot="field-error"]')?.textContent;
}
async function fill(name: string, value: string) {
  const input = control(name);
  const prototype =
    input.tagName === "TEXTAREA"
      ? dom.window.HTMLTextAreaElement.prototype
      : dom.window.HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
      input,
      value,
    );
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}
async function submit() {
  const form = element<HTMLFormElement>("form");
  assert.equal(form.noValidate, true);
  await act(async () => form.requestSubmit());
}

test("login validates inline, focuses the first invalid field, and submits after correction", async () => {
  let signedIn = false;
  respond = () => json({});
  await act(async () =>
    root.render(
      <Auth
        onLogin={() => {
          signedIn = true;
        }}
      />,
    ),
  );
  await submit();
  assert.equal(requests.length, 0);
  assert.equal(document.activeElement, control("email"));
  assert.equal(control("email").getAttribute("aria-invalid"), "true");
  assert.equal(fieldError("email"), "Enter an email address.");
  assert.equal(fieldError("password"), "Enter your password.");
  const error = control("email")
    .closest('[data-slot="field"]')!
    .querySelector('[data-slot="field-error"]')!;
  assert.ok(
    control("email")
      .getAttribute("aria-describedby")
      ?.split(" ")
      .includes(error.id),
  );
  assert.ok(document.querySelector(`label[for="${control("email").id}"]`));

  await fill("email", "invalid");
  assert.equal(fieldError("email"), "Enter a valid email address.");
  await fill("email", "member@example.test");
  await fill("password", "short");
  assert.notEqual(control("email").getAttribute("aria-invalid"), "true");
  await submit();
  assert.equal(signedIn, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, "/api/auth/sign-in/email");
  assert.equal(requests[0].body.password, "short");
});

test("credential rejection is inline and editing either credential allows a retry", async () => {
  let signedIn = false;
  respond = () => json({ error: "Email or password is incorrect" }, 401);
  await act(async () =>
    root.render(
      <Auth
        onLogin={() => {
          signedIn = true;
        }}
      />,
    ),
  );
  await fill("email", "member@example.test");
  await fill("password", "unchanged-password");
  await submit();
  assert.equal(signedIn, false);
  assert.equal(fieldError("password"), "Email or password is incorrect.");
  assert.equal(control("password").getAttribute("aria-invalid"), "true");
  assert.equal(document.activeElement, control("password"));
  await fill("email", "corrected@example.test");
  assert.notEqual(control("password").getAttribute("aria-invalid"), "true");
  respond = () => json({});
  await submit();
  assert.equal(signedIn, true);
  assert.equal(requests.length, 2);
});

test("login returns to a protected destination and rejects external destinations", async () => {
  for (const [destination, expected] of [
    [
      "/library/documents/document?node=section",
      "/library/documents/document?node=section",
    ],
    ["https://outside.test/library", "/library"],
  ]) {
    history.replaceState(
      {},
      "",
      `/login?${new URLSearchParams({ returnTo: destination })}`,
    );
    respond = () => json({});
    await act(async () =>
      root.render(<Auth key={destination} onLogin={() => {}} />),
    );
    await fill("email", "member@example.test");
    await fill("password", "password");
    await submit();
    assert.equal(location.pathname + location.search, expected);
  }
});

test("OAuth sign-in at the canonical login path forwards the signed authorization query", async () => {
  const query =
    "client_id=client&sig=signature&exp=123&ba_param=client_id&ba_param=exp";
  history.replaceState({}, "", `/login?${query}`);
  respond = () => json({});
  await act(async () => root.render(<Auth onLogin={() => {}} />));
  await fill("email", "member@example.test");
  await fill("password", "password");
  await submit();
  assert.equal(requests[0].body.oauth_query, query);
  assert.equal(
    new URL(String(requests[0].body.callbackURL), location.origin).pathname,
    "/login",
  );
});

test("registration validates names and password length without altering credentials", async () => {
  respond = () => json({});
  await act(async () => root.render(<Auth onLogin={() => {}} />));
  await submit();
  await act(async () =>
    element<HTMLButtonElement>(".auth-switch button").click(),
  );
  assert.equal(document.querySelector('[aria-invalid="true"]'), null);
  await fill("name", "   ");
  await fill("organization", "Invalid/name");
  await fill("email", "member@example.test");
  await fill("password", "short");
  await submit();
  assert.equal(requests.length, 0);
  assert.equal(document.activeElement, control("name"));
  assert.equal(fieldError("name"), "Enter your name.");
  assert.equal(
    fieldError("organization"),
    "Use a name without slashes or control characters.",
  );
  assert.equal(fieldError("password"), "Use at least 12 characters.");
  await fill("name", "New member");
  await fill("organization", "Organization");
  await fill("password", " password-with-spaces ");
  await submit();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, "/api/auth/sign-up/email");
  assert.equal(requests[0].body.password, " password-with-spaces ");
});

test("successful invited sign-in accepts before returning to the library", async () => {
  history.replaceState({}, "", "/login?invite=invitation");
  let signedIn = false;
  respond = (request) => {
    if (request.path === "/api/auth/get-session") return json(null);
    if (request.path === "/api/auth/sign-in/email")
      return json({
        redirect: true,
        url: "/login?verified=1&invite=invitation",
      });
    if (request.path === "/api/auth/organization/accept-invitation") {
      assert.equal(signedIn, false);
      assert.equal(location.pathname, "/login");
      return json({});
    }
    throw new Error(`Unexpected request: ${request.path}`);
  };
  await act(async () =>
    root.render(
      <Auth
        onLogin={() => {
          signedIn = true;
        }}
      />,
    ),
  );
  await act(async () =>
    element<HTMLButtonElement>(".auth-switch button").click(),
  );
  await fill("email", "member@example.test");
  await fill("password", "password");
  await submit();
  assert.equal(signedIn, true);
  assert.equal(location.pathname + location.search, "/library");
  assert.deepEqual(
    requests.map(({ path }) => path),
    [
      "/api/auth/get-session",
      "/api/auth/sign-in/email",
      "/api/auth/organization/accept-invitation",
    ],
  );
  assert.equal(requests.at(-1)!.body.invitationId, "invitation");
});

test("verification callback resumes the native session and invitation without another sign-in", async () => {
  history.replaceState({}, "", "/login?invite=invitation&verified=1");
  let signedIn = false;
  respond = (request) =>
    request.path === "/api/auth/get-session"
      ? json({
          user: { id: "member", emailVerified: true },
          session: { id: "session" },
        })
      : request.path === "/api/auth/organization/accept-invitation"
        ? json({})
        : (() => {
            throw new Error(`Unexpected request: ${request.path}`);
          })();
  await act(async () =>
    root.render(
      <Auth
        onLogin={() => {
          signedIn = true;
        }}
      />,
    ),
  );
  assert.equal(signedIn, true);
  assert.equal(location.pathname + location.search, "/library");
  assert.deepEqual(
    requests.map(({ path }) => path),
    ["/api/auth/get-session", "/api/auth/organization/accept-invitation"],
  );
});

test("failed verification links show the error instead of claiming successful verification", async () => {
  history.replaceState(
    {},
    "",
    "/login?invite=invitation&verified=1&error=TOKEN_EXPIRED",
  );
  await act(async () => root.render(<Auth onLogin={() => {}} />));
  assert.match(element("[role=status]").textContent!, /invalid or expired/);
  assert.doesNotMatch(document.body.textContent!, /Email verified/);
  assert.equal(requests.length, 0);
});

test("password reset preserves the invitation and does not accept it before resetting", async () => {
  history.replaceState(
    {},
    "",
    "/reset-password?token=reset-token&invite=invitation",
  );
  respond = () => json({ status: true });
  await act(async () => root.render(<Auth onLogin={() => {}} />));
  assert.equal(requests.length, 0);
  await fill("password", "updated-secure-password-456!");
  await fill("confirmPassword", "updated-secure-password-456!");
  await submit();
  assert.equal(requests[0].path, "/api/auth/reset-password");
  assert.equal(requests[0].body.token, "reset-token");
  assert.equal(location.pathname + location.search, "/login?invite=invitation");
});

const me: Me = {
  user: { id: "member", name: "Member", email: "member@example.test" },
  organization: { id: "org", name: "Organization" },
  role: "admin",
  organizations: [],
  chatEnabled: true,
  chatModels: [],
  defaultChatModel: { provider: "openai", model: "model-id" },
  semanticEnabled: false,
  extendEnabled: true,
};
const settings = {
  provider: "openai",
  model: "model-id",
  configured: { extendKey: true, jevKey: true },
  providers: { openai: { configured: true, models: [], hasConfig: true } },
};
function settingsResponse(request: RequestCall) {
  if (request.path === "/api/members") return json([]);
  if (request.path === "/api/settings") return json(settings);
  if (request.path === "/api/invitations")
    return json({ url: "https://app.test/?invite=token" });
  throw new Error(`Unexpected request: ${request.path}`);
}

test("connections reject invalid fields, reveal hidden JSON errors, and preserve untouched keys", async () => {
  respond = settingsResponse;
  await act(async () =>
    root.render(
      <SettingsView me={me} onSaved={() => {}} section="connections" />,
    ),
  );
  await fill("openai-model", " ");
  await fill("openai-config", "[]");
  const details = element<HTMLDetailsElement>(".advanced-config");
  details.open = false;
  await submit();
  assert.equal(
    requests.filter((request) => request.method === "PUT").length,
    0,
  );
  assert.equal(fieldError("openai-model"), "Enter a model ID.");
  assert.equal(
    fieldError("openai-config"),
    "Enter a JSON object with setting names and values.",
  );
  assert.equal(document.activeElement, control("openai-model"));
  assert.equal(details.open, true);
  await fill("openai-model", "model-id");
  details.open = false;
  await submit();
  assert.equal(details.open, true);
  assert.equal(document.activeElement, control("openai-config"));
  await fill("openai-config", "{}");
  await fill("openai-models", " model-one,model-two\nmodel-three ");
  await submit();
  const saves = requests.filter((request) => request.method === "PUT");
  assert.equal(saves.length, 1);
  assert.deepEqual(saves[0].body, {
    organization: { enabled: true },
    removedProviders: [],
    chatProviders: [
      {
        provider: "openai",
        providerEnabled: true,
        model: "model-id",
        models: ["model-one", "model-two", "model-three"],
        providerConfig: {},
      },
    ],
  });
  assert.equal(control("openai-config").value, "");
  assert.equal(document.querySelector('[aria-invalid="true"]'), null);
});

test("invitations validate email locally before creating a link", async () => {
  respond = settingsResponse;
  await act(async () =>
    root.render(<SettingsView me={me} onSaved={() => {}} section="people" />),
  );
  await fill("email", "invalid");
  await submit();
  assert.equal(fieldError("email"), "Enter a valid email address.");
  assert.equal(
    requests.some((request) => request.method === "POST"),
    false,
  );
  await fill("email", "invited@example.test");
  await submit();
  const invite = requests.find((request) => request.method === "POST");
  assert.equal(invite?.path, "/api/invitations");
  assert.equal(invite?.body.email, "invited@example.test");
  assert.equal(
    element<HTMLInputElement>('[aria-label="Invitation link"]').value,
    "https://app.test/?invite=token",
  );
});

test("textarea constraints participate in coss submission and error recovery", async () => {
  let submitted = "";
  await act(async () =>
    root.render(
      <Form
        onSubmit={(event) => {
          event.preventDefault();
          submitted = String(
            new FormData(event.currentTarget).get("description"),
          );
        }}
      >
        <Field
          name="description"
          validate={(value) => validateRequiredText(value, "a description", 10)}
        >
          <FieldLabel>Description</FieldLabel>
          <Textarea name="description" required maxLength={10} />
          <FieldError />
        </Field>
        <button type="submit">Save</button>
      </Form>,
    ),
  );
  await submit();
  assert.equal(submitted, "");
  assert.equal(fieldError("description"), "Enter a description.");
  assert.equal(control("description").getAttribute("aria-invalid"), "true");
  assert.equal(document.activeElement, control("description"));
  await fill("description", "too many characters");
  await submit();
  assert.equal(submitted, "");
  assert.equal(fieldError("description"), "Use 10 characters or fewer.");
  await fill("description", "Valid");
  await submit();
  assert.equal(submitted, "Valid");
  assert.notEqual(control("description").getAttribute("aria-invalid"), "true");
});

test("form validators cover length boundaries, whitespace, model lists, and JSON types", () => {
  assert.equal(validateName("  Folder  ", "a name"), null);
  assert.ok(validateName("\t", "a name"));
  assert.ok(validateName("Path\\child", "a name"));
  assert.ok(validateName("a".repeat(161), "a name"));
  assert.equal(validateEmail(" member@example.test "), null);
  assert.ok(validateEmail("a@"));
  assert.equal(validatePassword("x".repeat(12), true), null);
  assert.ok(validatePassword("x".repeat(129), false));
  assert.equal(validateRequiredText(" ", "a query", 2000), "Enter a query.");
  assert.equal(validateLength("a".repeat(1000), 1000), null);
  assert.ok(validateLength("a".repeat(1001), 1000));
  assert.deepEqual(parseModelList(" one, two\n\nthree "), [
    "one",
    "two",
    "three",
  ]);
  assert.equal(validateModelList(Array(30).fill("model").join(",")), null);
  assert.ok(validateModelList(Array(31).fill("model").join(",")));
  assert.ok(validateModelList("m".repeat(151)));
  for (const value of ["null", "[]", '"text"', "false", "42", "{invalid}"])
    assert.ok(validateProviderConfig(value));
  for (const value of ["", "  ", "{}", '{"region":"region-id"}'])
    assert.equal(validateProviderConfig(value), null);
});
