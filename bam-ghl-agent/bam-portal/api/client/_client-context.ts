import { HttpError } from "../parent/_errors.js";
import { eq, sb, verifySupabaseUser, type SupabaseUser } from "../parent/_supabase.js";
import type { ParentApiRequest } from "../parent/_types.js";

export type ClientUserRow = {
  id: string;
  user_id: string;
  client_id: string;
  name: string;
  email: string | null;
  status?: string;
};

export type ClientUserContext = {
  user: SupabaseUser;
  clientUser: ClientUserRow;
  tenantId: string;
};

export async function getClientUserContext(req: ParentApiRequest): Promise<ClientUserContext> {
  const user = await verifySupabaseUser(req);
  const requestedClientId = readRequestedClientId(req);
  const filters = [`user_id=eq.${eq(user.id)}`, "status=eq.active"];
  if (requestedClientId) filters.push(`client_id=eq.${eq(requestedClientId)}`);

  const rows = await sb<ClientUserRow[]>(
    `client_users?${filters.join("&")}` +
      "&select=id,user_id,client_id,name,email,status" +
      `&limit=${requestedClientId ? 1 : 2}`,
  );

  if (!requestedClientId && Array.isArray(rows) && rows.length > 1) {
    throw new HttpError(422, "Client is required for multi-academy accounts.");
  }

  const clientUser = Array.isArray(rows) ? (rows[0] ?? null) : null;

  if (!clientUser) {
    throw new HttpError(
      403,
      requestedClientId
        ? "Not authorized for this client."
        : "Not authorized for the client portal.",
    );
  }

  return {
    user,
    clientUser,
    tenantId: clientUser.client_id,
  };
}

function readRequestedClientId(req: ParentApiRequest): string | null {
  return (
    queryValue(req.query?.client_id) ??
    queryValue(req.headers["x-client-id"]) ??
    bodyStringValue(req.body, "client_id")
  );
}

function bodyStringValue(body: unknown, key: string): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function queryValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
