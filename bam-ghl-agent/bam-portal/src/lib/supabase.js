import { createClient } from "@supabase/supabase-js";

// Read from Vite env vars only. Fail fast in dev if missing so we never silently
// fall back to a hardcoded literal that could drift from the deployed env.
// In production these are set in Vercel; locally see .env.local.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Supabase env vars missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY " +
    "in .env.local (local dev) or Vercel project settings (prod)."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
