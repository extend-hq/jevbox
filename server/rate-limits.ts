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
    read: configuredLimit("API_READ_LIMIT_PER_MINUTE", 6000),
    write: configuredLimit("API_WRITE_LIMIT_PER_MINUTE", 1200),
  };
}

export function authRateLimits() {
  return {
    requests: configuredLimit("AUTH_LIMIT_PER_MINUTE", 3000),
    signIn: configuredLimit("AUTH_SIGN_IN_LIMIT_PER_15_MINUTES", 300),
    signUp: configuredLimit("AUTH_SIGN_UP_LIMIT_PER_MINUTE", 120),
    recovery: configuredLimit("AUTH_RECOVERY_LIMIT_PER_15_MINUTES", 60),
    verification: configuredLimit(
      "AUTH_VERIFICATION_LIMIT_PER_15_MINUTES",
      120,
    ),
    keyCreation: configuredLimit("AUTH_KEY_CREATION_LIMIT_PER_HOUR", 300),
    oauth: configuredLimit("AUTH_OAUTH_LIMIT_PER_MINUTE", 1000),
    oauthRegistration: configuredLimit(
      "AUTH_OAUTH_REGISTRATION_LIMIT_PER_MINUTE",
      120,
    ),
    apiKey: configuredLimit("API_KEY_LIMIT_PER_MINUTE", 6000),
  };
}

export function searchRateLimits() {
  return {
    user: configuredLimit("SEARCH_USER_LIMIT_PER_MINUTE", 120),
    credential: configuredLimit("SEARCH_CREDENTIAL_LIMIT_PER_MINUTE", 120),
    organization: configuredLimit("SEARCH_ORGANIZATION_LIMIT_PER_MINUTE", 3000),
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
  limit = configuredLimit("ANONYMOUS_LIMIT_PER_MINUTE", 3000),
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
