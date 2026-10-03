import type { Request } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { z } from "zod";

const configuredLimit = (name: string, fallback: number) =>
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

export function searchRateLimits() {
  return { user: 20, credential: 20, organization: 100 };
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

export function createAnonymousRateLimiter(limit = 300) {
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
