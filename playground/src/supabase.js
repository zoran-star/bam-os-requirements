import { createClient } from '@supabase/supabase-js'

// Publishable (anon) key + URL are safe to expose in client code.
// Override via Vercel env vars if you ever rotate them.
const url = import.meta.env.VITE_SUPABASE_URL || 'https://jnojmfmpnsfmtqmwhopz.supabase.co'
const key =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'sb_publishable_FAa-j7-sA9ya4FXn_fkebA_JoYwK0xI'

export const supabase = createClient(url, key)
