import { ShapeTriangle } from "./icons";
import { navigateTo, paths } from "@/lib/navigation";
import { ScrollArea } from "@/components/coss/scroll-area";
import { useState } from "react";
import { ArrowRight } from "@/components/icons";
import { Button } from "@/components/coss/button";
import { Input } from "@/components/coss/input";
import { Form } from "@/components/coss/form";
import { Field, FieldLabel, FieldError } from "@/components/coss/field";
import { api, ApiError } from "@/lib/api";
import {
  validateEmail,
  validateName,
  validatePassword,
} from "@/lib/form-validation";
import { Brand, useAction } from "./common";
export function Auth({ onLogin }: { onLogin: () => void }) {
  const invite = new URLSearchParams(location.search).get("invite");
  const query = new URLSearchParams(location.search);
  type Mode =
    "signin" | "register" | "verification" | "forgot" | "reset" | "sent";
  const [mode, setMode] = useState<Mode>(
    location.pathname === "/reset-password"
      ? "reset"
      : invite && !query.has("verified")
        ? "register"
        : "signin",
  );
  const register = mode === "register";
  const [address, setAddress] = useState("");
  const [notice, setNotice] = useState(
    query.has("verified")
      ? "Email verified. Sign in to continue."
      : query.has("error")
        ? "That link is invalid or expired. Request a new one."
        : "",
  );
  const resetToken = query.get("token");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const action = useAction();
  return (
    <ScrollArea className="h-dvh" scrollFade>
      <div className="auth-layout">
        <section className="auth-main">
          <Brand />
          <div className="auth-form">
            <h1>
              {register
                ? "Create account"
                : mode === "verification"
                  ? "Check your email"
                  : mode === "forgot" || mode === "reset"
                    ? "Reset password"
                    : mode === "sent"
                      ? "Check your email"
                      : "Sign in"}
            </h1>
            {notice && (
              <p className="notice" role="status">
                {notice}
              </p>
            )}
            {mode === "verification" || mode === "sent" ? (
              <div className="space-y-4">
                <p>
                  {mode === "verification"
                    ? "Open the verification link in your email, then sign in."
                    : "If an account exists, you’ll receive a password reset link."}
                </p>
                {mode === "verification" && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={action.busy}
                    onClick={() =>
                      void action.run(async () => {
                        const callback = new URLSearchParams({
                          verified: "1",
                          ...(invite ? { invite } : {}),
                        });
                        await api("/auth/send-verification-email", {
                          method: "POST",
                          body: JSON.stringify({
                            email: address,
                            callbackURL: `/?${callback}`,
                          }),
                        });
                        setNotice("Verification email sent.");
                      })
                    }
                  >
                    Resend email
                  </Button>
                )}
                {action.error && (
                  <p className="error" role="alert">
                    {action.error}
                  </p>
                )}
                <Button
                  type="button"
                  className="w-full"
                  onClick={() => {
                    setMode("signin");
                    setNotice("");
                    action.setError("");
                  }}
                >
                  Back to sign in
                </Button>
              </div>
            ) : (
              <>
                {invite && (
                  <div className="notice">
                    You’ve been invited to an organization. Use the email
                    address on your invitation.
                  </div>
                )}
                <Form
                  key={mode}
                  errors={errors}
                  onChange={() => {
                    if (Object.keys(errors).length) setErrors({});
                    if (action.error) action.setError("");
                  }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (action.busy) return;
                    const data = new FormData(e.currentTarget);
                    void action.run(async () => {
                      const email = String(data.get("email") ?? "").trim();
                      setAddress(email);
                      if (mode === "forgot") {
                        await api("/auth/request-password-reset", {
                          method: "POST",
                          body: JSON.stringify({
                            email,
                            redirectTo: "/reset-password",
                          }),
                        });
                        setMode("sent");
                        setNotice("");
                        return;
                      }
                      if (mode === "reset") {
                        if (!resetToken)
                          throw new Error(
                            "That link is invalid or expired. Request a new one.",
                          );
                        if (
                          data.get("password") !== data.get("confirmPassword")
                        ) {
                          setErrors({
                            confirmPassword: "Passwords do not match.",
                          });
                          return;
                        }
                        await api("/auth/reset-password", {
                          method: "POST",
                          body: JSON.stringify({
                            token: resetToken,
                            newPassword: data.get("password"),
                          }),
                        });
                        navigateTo("/", { replace: true });
                        setMode("signin");
                        setNotice(
                          "Password reset. Sign in with your new password.",
                        );
                        onLogin();
                        return;
                      }
                      try {
                        const signedIn = await api<{
                          redirect?: boolean;
                          url?: string;
                        }>(`/auth/${register ? "register" : "sign-in/email"}`, {
                          method: "POST",
                          body: JSON.stringify({
                            email,
                            password: data.get("password"),
                            ...(!register &&
                            location.pathname === "/oauth/sign-in"
                              ? { oauth_query: location.search.slice(1) }
                              : {}),
                            ...(register
                              ? {
                                  name: data.get("name"),
                                  ...(!invite
                                    ? {
                                        organization: data.get("organization"),
                                        bootstrapToken:
                                          data.get("bootstrapToken") ||
                                          undefined,
                                      }
                                    : { invite }),
                                }
                              : {}),
                          }),
                        });
                        if (!register && signedIn.redirect && signedIn.url) {
                          location.assign(signedIn.url);
                          return;
                        }
                      } catch (error) {
                        if (
                          !register &&
                          error instanceof ApiError &&
                          error.code === "EMAIL_NOT_VERIFIED"
                        ) {
                          setMode("verification");
                          setNotice("");
                          return;
                        }
                        if (
                          !register &&
                          error instanceof ApiError &&
                          error.status === 401
                        ) {
                          setErrors({
                            password: "Email or password is incorrect.",
                          });
                          return;
                        }
                        throw error;
                      }
                      if (register) {
                        setMode("verification");
                        setNotice("");
                        return;
                      }
                      if (invite && !register)
                        await api("/invitations/accept", {
                          method: "POST",
                          body: JSON.stringify({ token: invite }),
                        });
                      if (
                        invite ||
                        location.pathname === "/" ||
                        location.pathname === "/reset-password"
                      )
                        navigateTo(paths.library(), { replace: true });
                      onLogin();
                    });
                  }}
                >
                  {register && (
                    <Field
                      name="name"
                      validate={(value) => validateName(value, "your name")}
                    >
                      <FieldLabel>Your name</FieldLabel>
                      <Input
                        name="name"
                        type="text"
                        autoComplete="name"
                        required
                        maxLength={160}
                      />
                      <FieldError />
                    </Field>
                  )}
                  {register && !invite && (
                    <Field
                      name="organization"
                      validate={(value) =>
                        validateName(value, "an organization name")
                      }
                    >
                      <FieldLabel>Organization name</FieldLabel>
                      <Input
                        name="organization"
                        type="text"
                        autoComplete="organization"
                        required
                        maxLength={160}
                      />
                      <FieldError />
                    </Field>
                  )}
                  {register && !invite && (
                    <details className="bootstrap-field">
                      <summary className="triangle-summary">
                        <ShapeTriangle
                          size={10}
                          className="disclosure-triangle"
                        />
                        Deployment setup token
                      </summary>
                      <Field name="bootstrapToken">
                        <FieldLabel>Bootstrap token</FieldLabel>
                        <Input
                          name="bootstrapToken"
                          type="password"
                          autoComplete="off"
                          placeholder="For the first account on a private deployment"
                        />
                        <FieldError />
                      </Field>
                    </details>
                  )}
                  {mode !== "reset" && (
                    <Field name="email" validate={validateEmail}>
                      <FieldLabel>Email address</FieldLabel>
                      <Input
                        name="email"
                        type="email"
                        autoComplete="email"
                        placeholder="you@company.com"
                        required
                        maxLength={254}
                      />
                      <FieldError />
                    </Field>
                  )}
                  {mode !== "forgot" && (
                    <Field
                      name="password"
                      validate={(value) =>
                        validatePassword(value, register || mode === "reset")
                      }
                    >
                      <FieldLabel>
                        {mode === "reset" ? "New password" : "Password"}
                      </FieldLabel>
                      <Input
                        name="password"
                        type="password"
                        autoComplete={
                          register || mode === "reset"
                            ? "new-password"
                            : "current-password"
                        }
                        minLength={register || mode === "reset" ? 12 : 1}
                        maxLength={128}
                        placeholder={
                          register || mode === "reset"
                            ? "At least 12 characters"
                            : "Enter your password"
                        }
                        required
                      />
                      <FieldError />
                    </Field>
                  )}
                  {mode === "reset" && (
                    <Field
                      name="confirmPassword"
                      validate={(value) => validatePassword(value, true)}
                    >
                      <FieldLabel>Confirm password</FieldLabel>
                      <Input
                        name="confirmPassword"
                        type="password"
                        autoComplete="new-password"
                        required
                        minLength={12}
                        maxLength={128}
                      />
                      <FieldError />
                    </Field>
                  )}
                  {action.error && (
                    <div className="error" role="alert">
                      {action.error}
                    </div>
                  )}
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={action.busy}
                  >
                    {action.busy
                      ? "One moment…"
                      : mode === "forgot"
                        ? "Send reset link"
                        : mode === "reset"
                          ? "Save password"
                          : register
                            ? invite
                              ? "Join organization"
                              : "Create organization"
                            : "Sign in"}
                    <ArrowRight size={16} />
                  </Button>
                </Form>
                <p className="auth-switch">
                  {register
                    ? "Already have an account?"
                    : mode === "signin"
                      ? "New to Jevbox?"
                      : "Remember your password?"}{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setMode(mode === "signin" ? "register" : "signin");
                      setNotice("");
                      setErrors({});
                      action.setError("");
                    }}
                  >
                    {mode === "signin" ? "Create an organization" : "Sign in"}
                  </button>
                </p>
                {mode === "signin" && (
                  <button
                    type="button"
                    className="auth-switch"
                    onClick={() => {
                      setMode("forgot");
                      setErrors({});
                      setNotice("");
                      action.setError("");
                    }}
                  >
                    Forgot password?
                  </button>
                )}
              </>
            )}
          </div>
        </section>
      </div>
    </ScrollArea>
  );
}
