import { supabase } from "./supabase";

// fetch() that attaches the logged-in Supabase token. Use for any /api endpoint
// that's staff-gated, so callers don't each have to thread a session prop.
export async function authFetch(url, opts = {}) {
  const { data } = await supabase.auth.getSession();
  const tok = data?.session?.access_token;
  const headers = { ...(opts.headers || {}), ...(tok ? { Authorization: `Bearer ${tok}` } : {}) };
  return fetch(url, { ...opts, headers });
}
