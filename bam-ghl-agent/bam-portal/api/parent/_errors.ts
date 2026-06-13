import type { ParentApiResponse } from "./_types.js";

export class HttpError extends Error {
  readonly status: number;
  readonly detail?: unknown;

  constructor(status: number, message: string, detail: unknown = undefined) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    if (detail !== undefined) this.detail = detail;
  }
}

export function sendError(res: ParentApiResponse, error: unknown) {
  if (error instanceof HttpError) {
    const body: { error: string; detail?: unknown } = { error: error.message };
    if (error.detail !== undefined) body.detail = error.detail;
    return res.status(error.status).json(body);
  }

  console.error("[parent-api]", error);
  return res.status(500).json({ error: "internal error" });
}
