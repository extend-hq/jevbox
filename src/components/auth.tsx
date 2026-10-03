import { ShapeTriangle } from "./icons";
import { navigateTo, paths } from "@/lib/navigation";
import {
  isOAuthLogin,
  loginDestination,
  loginPath,
  verificationDestination,
} from "../../shared/auth-navigation";
import { ScrollArea } from "@/components/coss/scroll-area";
import { useEffect, useState } from "react";
import { ArrowRight } from "@/components/icons";
import { Button } from "@/components/coss/button";
import { Input } from "@/components/coss/input";
import { Form } from "@/components/coss/form";
import { Field, FieldLabel, FieldError } from "@/components/coss/field";
import { authClient } from "@/lib/auth-client";
import {
  validateEmail,
  validateName,
  validatePassword,
} from "@/lib/form-validation";
import { Brand, useAction } from "./common";
import { GitHubLink } from "./github-link";
export function Auth({ onLogin }: { onLogin: () => void }) {
  const invite = new URLSearchParams(location.search).get("invite");
  const query = new URLSearchParams(location.search);
  const verificationCallback = verificationDestination(new URL(location.href));
  type Mode =
    | "signin"
    | "register"
    | "verification"
    | "forgot"
    | "reset"
    | "sent"
    | "invitation";
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
    query.has("error")
      ? "That link is invalid or expired. Request a new one."
      : query.has("verified")
        ? "Email verified."
        : "",
  );
  const resetToken = query.get("token");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const action = useAction();
  async function completeLogin() {
    if (invite) {
      setMode("invitation");
      const accepted = await authClient.organization.acceptInvitation({
        invitationId: invite,
      });
      if (accepted.error) throw new Error(accepted.error.message);
    }
    onLogin();
    navigateTo(
      invite ? paths.library() : loginDestination(new URL(location.href)),
      { replace: true },
    );
  }
  useEffect(() => {
    if (
      location.pathname !== loginPath ||
      (!invite && !query.has("verified")) ||
      query.has("error")
    )
      return;
    let active = true;
    void action.run(async () => {
      const session = await authClient.getSession();
      if (!active) return;
      if (session.error) throw new Error(session.error.message);
      if (!session.data?.user.emailVerified) return;
      if (isOAuthLogin(new URL(location.href))) {
        onLogin();
        return;
      }
      await completeLogin();
    });
    return () => {
      active = false;
    };
  }, [location.pathname, invite, verificationCallback]);
  return (
    <ScrollArea className="h-dvh" scrollFade>
      <div className="auth-layout">
        <section className="auth-main">
          <div className="flex items-center justify-between gap-4">
            <Brand />
            <GitHubLink />
          </div>
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
                      : mode === "invitation"
                        ? "Join organization"
                        : "Sign in"}
            </h1>
            {notice && (
              <p className="notice" role="status">
                {notice}
              </p>
            )}
            {mode === "invitation" ? (
              <div className="space-y-4">
                {action.error && (
                  <p className="error" role="alert">
                    {action.error}
                  </p>
                )}
                <Button
                  type="button"
                  className="w-full"
                  disabled={action.busy}
                  onClick={() => void action.run(completeLogin)}
                >
                  {action.busy ? "Joining…" : "Accept invitation"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      const result = await authClient.signOut();
                      if (result.error) throw new Error(result.error.message);
                      setMode("signin");
                      setNotice("");
                    })
                  }
                >
                  Sign in with another account
                </Button>
              </div>
            ) : mode === "verification" || mode === "sent" ? (
              <div className="space-y-4">
                <p>
                  {mode === "verification"
                    ? "Open the verification link in your email to continue."
                    : "If an account exists, you’ll receive a password reset link."}
                </p>
                {mode === "verification" && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={action.busy}
                    onClick={() =>
                      void action.run(async () => {
                        const result = await authClient.sendVerificationEmail({
                          email: address,
                          callbackURL: verificationCallback,
                        });
                        if (result.error) throw new Error(result.error.message);
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
                        const result = await authClient.requestPasswordReset({
                          email,
                          redirectTo: `/reset-password?${new URLSearchParams({
                            ...(invite ? { invite } : {}),
                            ...(query.has("returnTo")
                              ? {
                                  returnTo: loginDestination(
                                    new URL(location.href),
                                  ),
                                }
                              : {}),
                          })}`,
                        });
                        if (result.error) throw new Error(result.error.message);
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
                        const result = await authClient.resetPassword({
                          token: resetToken,
                          newPassword: String(data.get("password")),
                        });
                        if (result.error) throw new Error(result.error.message);
                        navigateTo(
                          `${loginPath}?${new URLSearchParams({
                            ...(invite ? { invite } : {}),
                            ...(query.has("returnTo")
                              ? {
                                  returnTo: loginDestination(
                                    new URL(location.href),
                                  ),
                                }
                              : {}),
                          })}`,
                          { replace: true },
                        );
                        setMode("signin");
                        setNotice(
                          "Password reset. Sign in with your new password.",
                        );
                        onLogin();
                        return;
                      }
                      if (register) {
                        const result = await authClient.signUp.email({
                          email,
                          password: String(data.get("password")),
                          name: String(data.get("name")),
                          callbackURL: verificationCallback,
                          ...(!invite
                            ? {
                                organization: data.get("organization"),
                                bootstrapToken:
                                  data.get("bootstrapToken") || undefined,
                              }
                            : { invite }),
                        });
                        if (result.error) throw new Error(result.error.message);
                        setMode("verification");
                        setNotice("");
                        return;
                      }
                      const result = await authClient.signIn.email({
                        email,
                        password: String(data.get("password")),
                        callbackURL: verificationCallback,
                      });
                      if (result.error) {
                        if (result.error.code === "EMAIL_NOT_VERIFIED") {
                          setMode("verification");
                          setNotice("");
                          return;
                        }
                        if (result.error.status === 401) {
                          setErrors({
                            password: "Email or password is incorrect.",
                          });
                          return;
                        }
                        throw new Error(result.error.message);
                      }
                      if (
                        isOAuthLogin(new URL(location.href)) &&
                        result.data?.redirect &&
                        result.data.url
                      ) {
                        location.assign(result.data.url);
                        return;
                      }
                      await completeLogin();
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
