import { SUPABASE_ANON_KEY, SUPABASE_URL } from './supabase-config.js';

const isConfigured = SUPABASE_URL.startsWith('https://') &&
  SUPABASE_ANON_KEY.length > 20;

export let supabaseClient = null;
if (isConfigured) {
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
      }
    })
}
