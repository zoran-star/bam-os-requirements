import { createClient } from '@supabase/supabase-js'

// Publishable (anon) key + URL are safe to expose in client code.
// Override via Vercel env vars if you ever rotate them.
const url = import.meta.env.VITE_SUPABASE_URL || 'https://jnojmfmpnsfmtqmwhopz.supabase.co'
// Anon JWT (not the sb_publishable_ key) so verify_jwt edge functions accept it too.
const key =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impub2ptZm1wbnNmbXRxbXdob3B6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MjI1ODQsImV4cCI6MjA5MDE5ODU4NH0.8vUj-MHg73yUtQR5i3VAbgrTyjvmTCMM6-U3mGxbGGo'

export const supabase = createClient(url, key)
