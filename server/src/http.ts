import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { isProd } from "./env.ts";

/**
 * One error shape for every API response (gone-standards error-handling pattern):
 * { error: { code, message, requestId, details? } }
 */
export type ErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "EXTERNAL_SERVICE_ERROR"
  | "INTERNAL_ERROR"
  | "SERVICE_UNAVAILABLE";

export class AppError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: ErrorCode,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (message: string, details?: Record<string, unknown>) => new AppError(message, 400, "VALIDATION_ERROR", details);
export const notFound = (what = "Not found") => new AppError(what, 404, "NOT_FOUND");
export const unauthorized = (message = "Unauthorized") => new AppError(message, 401, "UNAUTHORIZED");
export const unavailable = (message: string) => new AppError(message, 503, "SERVICE_UNAVAILABLE");

/** Returns the value or throws a 404, so handlers read top to bottom. */
export function assertFound<T>(value: T | null | undefined, what: string): T {
  if (value == null) throw notFound(`${what} not found`);
  return value;
}

declare module "express-serve-static-core" {
  interface Request {
    id: string;
  }
}

/** Tags every request with an id (honours an upstream X-Request-Id) and echoes it back. */
export function requestId(req: Request, res: Response, next: NextFunction) {
  const upstream = req.get("x-request-id");
  req.id = upstream && /^[\w-]{8,64}$/.test(upstream) ? upstream : crypto.randomUUID();
  res.setHeader("X-Request-Id", req.id);
  next();
}

export const sendError = (res: Response, req: Request, err: AppError) =>
  res.status(err.statusCode).json({ error: { code: err.code, message: err.message, requestId: req.id, ...(err.details && { details: err.details }) } });

/** Async handler wrapper: rejected promises go to the error middleware. */
export const wrap = (fn: (req: Request, res: Response) => Promise<unknown> | unknown) => (req: Request, res: Response, next: NextFunction) =>
  Promise.resolve(fn(req, res)).catch(next);

export function notFoundApi(req: Request, res: Response) {
  sendError(res, req, notFound(`No route for ${req.method} ${req.path}`));
}

/** Last middleware. Operational errors pass through; anything else is logged and hidden in production. */
export function errorHandler(err: Error & { type?: string; status?: number }, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) return sendError(res, req, err);
  // body-parser: malformed JSON or an oversized body.
  if (err.type === "entity.parse.failed") return sendError(res, req, badRequest("Malformed JSON body"));
  if (err.type === "entity.too.large") return sendError(res, req, new AppError("Request body too large", 413, "BAD_REQUEST"));
  // http-errors from Express internals (e.g. serve-static 404s) already carry a safe 4xx status.
  if (err.status && err.status >= 400 && err.status < 500) return sendError(res, req, new AppError(err.status === 404 ? "Not found" : err.message, err.status, err.status === 404 ? "NOT_FOUND" : "BAD_REQUEST"));
  console.error(`[error] ${req.id} ${req.method} ${req.path}`, err);
  sendError(res, req, new AppError(isProd ? "Something went wrong" : err.message || "Server error", 500, "INTERNAL_ERROR"));
}
