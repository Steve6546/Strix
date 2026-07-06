import type { NextFunction, Request, Response } from "express";

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: "Not found" });
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  console.error(redactError(error));
  res.status(500).json({ error: "Internal server error" });
}

function redactError(error: unknown) {
  if (!(error instanceof Error)) {
    return error;
  }

  return {
    name: error.name,
    message: redact(error.message),
    stack: error.stack ? redact(error.stack) : undefined
  };
}

function redact(value: string) {
  return value
    .replace(/Bot\s+[A-Za-z0-9._-]+/g, "Bot [REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [REDACTED]")
    .replace(/postgresql:\/\/[^\s]+/g, "postgresql://[REDACTED]");
}
