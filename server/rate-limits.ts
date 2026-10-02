import type { Request } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { z } from "zod";

export function apiRateLimits() {
  return {
    read: z.coerce
      .number()
      .int()
      .positive()
      .default(3000)
      .parse(process.env.API_READ_LIMIT_PER_MINUTE),
    write: z.coerce
      .number()
      .int()
      .positive()
      .default(600)
      .parse(process.env.API_WRITE_LIMIT_PER_MINUTE),
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

export function createAnonymousRateLimiter() {
  return rateLimit({
    windowMs: 60000,
    limit: 180,
    keyGenerator: (req) =>
      `${ipKeyGenerator(req.ip ?? "127.0.0.1")}:${requestKind(req)}`,
    message: { error: "Too many requests. Wait a moment and try again." },
    standardHeaders: true,
    legacyHeaders: false,
  });
}
