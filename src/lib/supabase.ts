import { createClient } from '@supabase/supabase-js';

// Supabase configuration
// Values come from .env (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY),
// falling back to the project defaults so the site works even without a .env file.
const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL || 'https://unvomzolyjwcdavitdmr.supabase.co';
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVudm9tem9seWp3Y2Rhdml0ZG1yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4NzQ3NjEsImV4cCI6MjEwNzQ1MDc2MX0.SaukqHzJlXRXfx2R4yvbIEeWFEj7hm9xnkj6Oqw_4wY';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase credentials are missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // Gracefully handle environments where localStorage is unavailable (sandboxed iframes)
    storageKey: 'diary-auth',
  },
});

// Types for our database
export interface DiaryEntry {
  id: string;
  user_id: string;
  heading: string;
  date_time: string;
  sender_name: string;
  message: string;
  reflection: string;
  created_at: string;
  updated_at: string;
}

export interface HeadingCategoryRow {
  id: number;
  emoji: string;
  title: string;
  when_to_use: string;
  only_if_mentioned: boolean;
  sort_order: number;
}

export interface User {
  id: string;
  email: string;
  full_name?: string;
}
