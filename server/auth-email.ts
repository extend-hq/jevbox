import nodemailer from "nodemailer";

export type AuthEmail = {
  id?: string;
  to: string;
  kind: "verification" | "password-reset";
  url: string;
};
export type SendAuthEmail = (message: AuthEmail) => Promise<void>;

export function createAuthEmailSender(localDevelopment = false): SendAuthEmail {
  const production = process.env.NODE_ENV === "production" && !localDevelopment;
  const host = process.env.SMTP_HOST ?? (!production ? "127.0.0.1" : "");
  const from =
    process.env.AUTH_EMAIL_FROM ??
    (!production ? "Jevbox <auth@localhost.test>" : "");
  if (!host || !from)
    throw new Error(
      "SMTP_HOST and AUTH_EMAIL_FROM are required for authentication email",
    );
  const port = Number(process.env.SMTP_PORT ?? (production ? 587 : 1025));
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("SMTP_PORT must be a valid port");
  const secure = process.env.SMTP_SECURE === "true" || port === 465;
  const transport = nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: production && !secure,
    ...(process.env.SMTP_USER
      ? {
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASSWORD,
          },
        }
      : {}),
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
  return async ({ to, kind, url, id }) => {
    await transport.sendMail({
      from,
      to,
      ...(id ? { messageId: `<${id}@jevbox.auth>` } : {}),
      subject:
        kind === "verification"
          ? "Verify your email address"
          : "Reset your password",
      text:
        kind === "verification"
          ? `Verify your email address to sign in to Jevbox:\n\n${url}\n\nThis link expires in one hour.`
          : `Reset your Jevbox password:\n\n${url}\n\nThis link expires in one hour. If you did not request it, you can ignore this email.`,
    });
  };
}
