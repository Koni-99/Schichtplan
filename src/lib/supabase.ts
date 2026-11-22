import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** null = lokaler Demo-Modus (keine Supabase-Konfiguration hinterlegt). */
export const supabase: SupabaseClient | null =
  url && key && !url.includes('xxxxxxxx')
    ? createClient(url, key, {
        auth: {
          persistSession: true, // dauerhafte Session auf dem Filial-Tablet
          autoRefreshToken: true,
          detectSessionInUrl: false,
          storageKey: 'pausenplaner-auth',
        },
        realtime: { params: { eventsPerSecond: 20 } },
      })
    : null;

export const isCloudMode = supabase !== null;
