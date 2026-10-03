import type { Request } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { z } from "zod";

export const configuredLimit = (name: string, fallback: number) =>
  z.coerce
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .default(fallback)
    .parse(process.env[name]);

export function apiRateLimits() {
  return {
    read: configuredLimit("API_READ_LIMIT_PER_MINUTE", 1200),
    write: configuredLimit("API_WRITE_LIMIT_PER_MINUTE", 120),
  };
}

export function authRateLimits() {
  return {
    requests: configuredLimit("AUTH_LIMIT_PER_MINUTE", 60),
    signIn: configuredLimit("AUTH_SIGN_IN_LIMIT_PER_15_MINUTES", 20),
    signUp: configuredLimit("AUTH_SIGN_UP_LIMIT_PER_MINUTE", 3),
    recovery: configuredLimit("AUTH_RECOVERY_LIMIT_PER_15_MINUTES", 5),
    verification: configuredLimit("AUTH_VERIFICATION_LIMIT_PER_15_MINUTES", 10),
    keyCreation: configuredLimit("AUTH_KEY_CREATION_LIMIT_PER_HOUR", 10),
    oauth: configuredLimit("AUTH_OAUTH_LIMIT_PER_MINUTE", 120),
    oauthRegistration: configuredLimit(
      "AUTH_OAUTH_REGISTRATION_LIMIT_PER_MINUTE",
      5,
    ),
    apiKey: configuredLimit("API_KEY_LIMIT_PER_MINUTE", 600),
  };
}

export function searchRateLimits() {
  return {
    user: configuredLimit("SEARCH_USER_LIMIT_PER_MINUTE", 20),
    credential: configuredLimit("SEARCH_CREDENTIAL_LIMIT_PER_MINUTE", 20),
    organization: configuredLimit("SEARCH_ORGANIZATION_LIMIT_PER_MINUTE", 100),
  };
}

const requestKind = (req: Request) =>
  ["GET", "HEAD", "OPTIONS"].includes(req.method) ? "read" : "write";

export function createApiRateLimiter(
  userId: (req: Request) => string,
  limits = apiRateLimits(),
) {
  return rateLimit({
    windowMs: 60000,
    limit: (req) => limits[requestKind(req)],
    keyGenerator: (req) => `user:${userId(req)}:${requestKind(req)}`,
    message: { error: "Too many requests. Wait a moment and try again." },
    standardHeaders: true,
    legacyHeaders: false,
  });
}

export function createAnonymousRateLimiter(
  limit = configuredLimit("ANONYMOUS_LIMIT_PER_MINUTE", 300),
) {
  return rateLimit({
    windowMs: 60000,
    limit,
    keyGenerator: (req) =>
      `${ipKeyGenerator(req.ip ?? "127.0.0.1")}:${requestKind(req)}`,
    message: { error: "Too many requests. Wait a moment and try again." },
    standardHeaders: true,
    legacyHeaders: false,
  });
}

export function createSignupRateLimiter() {
  return rateLimit({
    windowMs: 3_600_000,
    limit: configuredLimit("SIGNUP_DEPLOYMENT_LIMIT_PER_HOUR", 100),
    keyGenerator: () => "signup",
    message: { error: "Registration is busy. Please try again later." },
    standardHeaders: true,
    legacyHeaders: false,
  });
}
