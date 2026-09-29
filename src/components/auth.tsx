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
  const [register, setRegister] = useState(Boolean(invite));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const action = useAction();
  return (
    <ScrollArea className="h-dvh" scrollFade>
      <div className="auth-layout">
        <section className="auth-main">
          <Brand />
          <div className="auth-form">
            <h1>{register ? "Create account" : "Sign in"}</h1>
            {invite && (
              <div className="notice">
                You’ve been invited to an organization. Use the email address on
                your invitation.
              </div>
            )}
            <Form
              key={register ? "register" : "login"}
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
                  try {
                    await api(`/auth/${register ? "register" : "login"}`, {
                      method: "POST",
                      body: JSON.stringify({
                        email: data.get("email"),
                        password: data.get("password"),
                        ...(register
                          ? {
                              name: data.get("name"),
                              ...(!invite
                                ? {
                                    organization: data.get("organization"),
                                    bootstrapToken:
                                      data.get("bootstrapToken") || undefined,
                                  }
                                : { invite }),
                            }
                          : {}),
                      }),
                    });
                  } catch (error) {
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
                  if (invite && !register)
                    await api("/invitations/accept", {
                      method: "POST",
                      body: JSON.stringify({ token: invite }),
                    });
                  if (invite || location.pathname === "/")
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
                    <ShapeTriangle size={10} className="disclosure-triangle" />
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
              <Field
                name="password"
                validate={(value) => validatePassword(value, register)}
              >
                <FieldLabel>Password</FieldLabel>
                <Input
                  name="password"
                  type="password"
                  autoComplete={register ? "new-password" : "current-password"}
                  minLength={register ? 12 : 1}
                  maxLength={128}
                  placeholder={
                    register ? "At least 12 characters" : "Enter your password"
                  }
                  required
                />
                <FieldError />
              </Field>
              {action.error && (
                <div className="error" role="alert">
                  {action.error}
                </div>
              )}
              <Button type="submit" className="w-full" disabled={action.busy}>
                {action.busy
                  ? "One moment…"
                  : register
                    ? invite
                      ? "Join organization"
                      : "Create organization"
                    : "Sign in"}
                <ArrowRight size={16} />
              </Button>
            </Form>
            <p className="auth-switch">
              {register ? "Already have an account?" : "New to Jevbox?"}{" "}
              <button
                type="button"
                onClick={() => {
                  setRegister(!register);
                  setErrors({});
                  action.setError("");
                }}
              >
                {register ? "Sign in" : "Create an organization"}
              </button>
            </p>
          </div>
        </section>
      </div>
    </ScrollArea>
  );
}
