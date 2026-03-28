import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://jnojmfmpnsfmtqmwhopz.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impub2ptZm1wbnNmbXRxbXdob3B6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MjI1ODQsImV4cCI6MjA5MDE5ODU4NH0.8vUj-MHg73yUtQR5i3VAbgrTyjvmTCMM6-U3mGxbGGo'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
