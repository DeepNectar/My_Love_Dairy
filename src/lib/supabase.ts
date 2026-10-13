import { createClient } from '@supabase/supabase-js';

// Supabase configuration
// Replace these with your actual Supabase project credentials
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'YOUR_SUPABASE_URL';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'YOUR_SUPABASE_ANON_KEY';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

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
