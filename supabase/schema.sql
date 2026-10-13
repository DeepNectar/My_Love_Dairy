-- ============================================================
-- 📖 My Diary — Supabase SQL (run in SQL Editor to go live)
-- Format:  #### HEADING N: [Topic Name]
--          - Message: [Date & Time] - [Sender]: "[Message]"
--            What I felt: [Reflection]
-- ============================================================

-- 1) Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2) Heading categories reference table (the 15 allowed headings)
CREATE TABLE IF NOT EXISTS heading_categories (
  id SERIAL PRIMARY KEY,
  emoji TEXT NOT NULL,
  title TEXT NOT NULL UNIQUE,
  when_to_use TEXT NOT NULL,
  only_if_mentioned BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INT NOT NULL DEFAULT 0
);

-- Full heading text = emoji || ' ' || title  e.g. '🌅 Morning & Night Greetings'
INSERT INTO heading_categories (emoji, title, when_to_use, only_if_mentioned, sort_order) VALUES
  ('🌅', 'Morning & Night Greetings',        'For good mornings/nights',               FALSE, 1),
  ('💬', 'Daily Life & Important Updates',   'For daily conversations',                FALSE, 2),
  ('💖', 'Sweet Compliments & Love',         'For loving words',                       FALSE, 3),
  ('👨‍👩‍👧‍👦', 'About Kesha (Her Sister)',       'ONLY if mentioned',                      TRUE,  4),
  ('👨‍👩‍👧‍👦', 'About Arya (Her Brother)',       'ONLY if mentioned',                      TRUE,  5),
  ('🎯', 'Dreams & Future Plans',            'For future goals',                       FALSE, 6),
  ('🤗', 'Emotional Support & Care',         'For emotional talks',                    FALSE, 7),
  ('😄', 'Fun Moments & Jokes',              'For funny moments',                      FALSE, 8),
  ('🔥', 'Flirty Banter & Teasing',          'For flirty exchanges',                   FALSE, 9),
  ('💕', 'Romantic Confessions',             'For romantic declarations',              FALSE, 10),
  ('💘', 'Attraction & Desire',              'For attraction talks',                   FALSE, 11),
  ('🌙', 'Intimate & Passionate Talks',      'For intimate moments',                   FALSE, 12),
  ('💝', 'Deep Chemistry & Connection',      'For deep connection',                    FALSE, 13),
  ('💭', 'My Messages To Her (No Reply Yet)','For Deep''s messages without reply',     FALSE, 14),
  ('💌', 'Her Messages To Me',               'For her messages without Deep''s reply', FALSE, 15)
ON CONFLICT (title) DO UPDATE SET
  emoji = EXCLUDED.emoji,
  when_to_use = EXCLUDED.when_to_use,
  only_if_mentioned = EXCLUDED.only_if_mentioned,
  sort_order = EXCLUDED.sort_order;

-- Everyone (signed-in users) can read the heading list; only service role can modify it
ALTER TABLE heading_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Headings are readable by authenticated users" ON heading_categories;
CREATE POLICY "Headings are readable by authenticated users"
  ON heading_categories FOR SELECT
  TO authenticated
  USING (TRUE);

-- 3) Diary entries table (adds the heading column)
CREATE TABLE IF NOT EXISTS diary_entries (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  heading TEXT NOT NULL DEFAULT '💬 Daily Life & Important Updates',
  date_time TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  message TEXT NOT NULL,
  reflection TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- If you already have the OLD diary_entries table (without heading), run this instead:
-- ALTER TABLE diary_entries ADD COLUMN IF NOT EXISTS heading TEXT NOT NULL DEFAULT '💬 Daily Life & Important Updates';

CREATE INDEX IF NOT EXISTS idx_diary_entries_user_id ON diary_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_diary_entries_created_at ON diary_entries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_diary_entries_heading ON diary_entries(user_id, heading);

-- 4) Row Level Security on diary_entries
ALTER TABLE diary_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own entries" ON diary_entries;
CREATE POLICY "Users can view own entries"
  ON diary_entries FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own entries" ON diary_entries;
CREATE POLICY "Users can insert own entries"
  ON diary_entries FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own entries" ON diary_entries;
CREATE POLICY "Users can update own entries"
  ON diary_entries FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own entries" ON diary_entries;
CREATE POLICY "Users can delete own entries"
  ON diary_entries FOR DELETE
  USING (auth.uid() = user_id);

-- 5) Auto-update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_diary_entries_updated_at ON diary_entries;
CREATE TRIGGER update_diary_entries_updated_at
  BEFORE UPDATE ON diary_entries
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Done ✅ — the app's dropdown/export/import templates use exactly these 15 headings.

-- ============================================================
-- 6) REQUIRED: Create the fixed login account in Supabase Auth
-- ------------------------------------------------------------
-- The app logs in to Supabase behind the scenes with this exact
-- email + password so every request carries a real JWT and passes
-- the RLS policies above. Without this step you will get:
--   "new row violates row-level security policy for table diary_entries"
--
-- Option A (recommended): Supabase Dashboard → Authentication → Users →
--   "Add user" → Email: depu_h2805@student.uml.edu, Password: DeepuH@2805
--   Check "Auto Confirm User". Also turn OFF email confirmation under
--   Authentication → Sign In / Up → Email ("Confirm email"), otherwise
--   password login is rejected until the (undeliverable) confirmation link
--   is clicked.
--
-- Option B: run this SQL block as-is in the SQL Editor (creates the auth user):
-- ------------------------------------------------------------
-- ⚠️ WARNING: NEVER run "DROP SCHEMA auth CASCADE" or re-run sections 1-5
-- after section 6 — dropping/recreating the `auth` schema breaks Supabase's
-- own login system and causes: "Database error querying schema" (HTTP 500)
-- on every sign-in. If you see that error, follow section 7 below first.
DO $$
DECLARE v_uid uuid := gen_random_uuid();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'depu_h2805@student.uml.edu') THEN
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, recovery_sent_at, last_sign_in_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, email_change, email_change_token_new,
      phone_change, phone_change_token, reauthentication_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
      'depu_h2805@student.uml.edu',
      crypt('DeepuH@2805', gen_salt('bf')),
      NOW(), NULL, NULL,
      '{"provider":"email","providers":["email"]}',
      '{}', NOW(), NOW(), '', '', '', '', '', ''
    );
    INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), v_uid, v_uid::text,
            jsonb_build_object('sub', v_uid::text, 'email', 'depu_h2805@student.uml.edu', 'email_verified', true),
            'email', NOW(), NOW(), NOW());
  END IF;
END $$;
--
-- If you use a different email/password, set them in .env:
--   VITE_DIARY_ACCOUNT_EMAIL=...
--   VITE_DIARY_ACCOUNT_PASSWORD=...
-- ============================================================

-- ============================================================
-- 7) REPAIR: "Database error querying schema" on login (HTTP 500)
-- ------------------------------------------------------------
-- Cause: the `auth` schema / auth.users table was dropped or altered
-- (usually by running DROP SCHEMA auth CASCADE, or an old version of
-- section 6 failed halfway). GoTrue (Supabase Auth) can no longer query
-- its own tables, so EVERY login fails with this error.
--
-- Fix: run this block ONCE in the SQL Editor, then re-run section 6 above,
-- then verify with: npm run create-auth-user
--
-- NOTE: if auth.users exists but is corrupted, prefer Dashboard →
-- Authentication → Users → delete broken users first.

CREATE SCHEMA IF NOT EXISTS auth;

-- Restore the core auth tables Supabase expects (safe: IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS auth.users (
  instance_id uuid,
  id uuid PRIMARY KEY,
  aud varchar(255),
  role varchar(255),
  email varchar(255) UNIQUE,
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  phone varchar(15) UNIQUE,
  phone_confirmed_at timestamptz,
  confirmation_token varchar(255),
  recovery_token varchar(255),
  email_change_token_new varchar(255),
  email_change varchar(255),
  email_change_token_current varchar(255),
  email_change_confirm_status smallint DEFAULT 0,
  banned_until timestamptz,
  reauthentication_token varchar(255),
  reauthentication_sent_at timestamptz,
  is_sso_user boolean NOT NULL DEFAULT false,
  password_recovered boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  last_sign_in_at timestamptz,
  app_metadata jsonb DEFAULT '{}'::jsonb,
  user_metadata jsonb DEFAULT '{}'::jsonb,
  raw_app_meta_data jsonb DEFAULT '{}'::jsonb,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

CREATE TABLE IF NOT EXISTS auth.identities (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  identity_data jsonb NOT NULL,
  provider text NOT NULL,
  provider_id text,
  security_stamp text,
  last_sign_in_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  email text GENERATED ALWAYS AS (lower(identity_data->>'email')) STORED,
  UNIQUE (provider_id, provider)
);

GRANT USAGE ON SCHEMA auth TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA auth TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT ALL ON TABLES TO postgres, service_role;
-- ============================================================
