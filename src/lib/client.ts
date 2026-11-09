import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null

export function createClient(): SupabaseClient {
  const url = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co'
  const key =
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    import.meta.env.VITE_SUPABASE_ANON_KEY ||
    'placeholder-anon-key'

  if (!client) {
    client = createSupabaseClient(url, key)
  }
  return client
}

export function isSupabaseConfigured(): boolean {
  const url = import.meta.env.VITE_SUPABASE_URL
  const key =
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    import.meta.env.VITE_SUPABASE_ANON_KEY
  return Boolean(url && key && url !== 'https://placeholder.supabase.co')
}
