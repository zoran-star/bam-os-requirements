import { HttpError } from "../parent/_errors.js";
import { eq, sb, verifySupabaseUser, type SupabaseUser } from "../parent/_supabase.js";
import type { ParentApiRequest } from "../parent/_types.js";

export type ClientUserRow = {
  id: string;
  user_id: string;
  client_id: string;
  name: string;
  email: string | null;
};

export type ClientUserContext = {
  user: SupabaseUser;
  clientUser: ClientUserRow;
  tenantId: string;
};

export async function getClientUserContext(req: ParentApiRequest): Promise<ClientUserContext> {
  const user = await verifySupabaseUser(req);
  const rows = await sb<ClientUserRow[]>(
    `client_users?user_id=eq.${eq(user.id)}` +
      "&select=id,user_id,client_id,name,email" +
      "&limit=1",
  );
  const clientUser = Array.isArray(rows) ? (rows[0] ?? null) : null;

  if (!clientUser) {
    throw new HttpError(403, "Not authorized for the client portal.");
  }

  return {
    user,
    clientUser,
    tenantId: clientUser.client_id,
  };
}
