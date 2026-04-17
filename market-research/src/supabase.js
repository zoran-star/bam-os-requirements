import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://raedfefzjudzlodtcxop.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJhZWRmZWZ6anVkemxvZHRjeG9wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzMjM5MDQsImV4cCI6MjA4OTg5OTkwNH0.hZ_C-57ddIALKGkPThyEyayZAS1i2Sg_zBvnYCm1xuc'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
