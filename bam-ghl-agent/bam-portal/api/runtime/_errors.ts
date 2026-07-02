import type { RuntimeApiResponse } from "./_types.js";

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

export function sendError(res: RuntimeApiResponse, error: unknown) {
  if (error instanceof HttpError) {
    if (error.status >= 500 || error.detail !== undefined) {
      console.error("[runtime-api]", {
        detail: error.detail,
        message: error.message,
        status: error.status,
      });
    }

    return res.status(error.status).json({ error: getPublicErrorMessage(error) });
  }

  console.error("[runtime-api]", error);
  return res.status(500).json({ error: "Something went wrong. Please try again." });
}

function getPublicErrorMessage(error: HttpError): string {
  if (error.status >= 500) {
    return "Something went wrong. Please try again.";
  }

  return error.message;
}
