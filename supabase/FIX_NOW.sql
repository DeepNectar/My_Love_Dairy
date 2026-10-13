-- ============================================================
-- FIX_NOW.sql  (v6 — matches the credentials HARDCODED in src/lib/hardcodedAuth.ts)
-- v5 fix: auth.users.id is now NOT NULL with NO database default, so the old
--         INSERT failed with error 23502. The id is now generated explicitly
--         with gen_random_uuid().
-- v6 fix: robust to partial runs — if a previous attempt inserted the user but
--         failed before creating the identity row (or vice-versa), this script
--         repairs the missing pieces instead of failing on unique-violations.
-- Paste this ENTIRE file into Supabase Dashboard → SQL Editor → Run.
--
-- Cloud account used by the app (hardcoded in code, no .env needed):
--   Email:    depu_h2805@student.uml.edu
--   Password: DeepuH@2805
--
-- What it does (all idempotent, never drops anything):
--   1. Creates the diary_entries table with the EXACT columns the app uses.
--   2. Enables RLS and creates SELECT/INSERT/UPDATE/DELETE policies so the
--      logged-in user can only touch their own rows.
--   3. Creates/repairs/resets the cloud auth user above (same path the
--      dashboard "Add user" button uses). If this step fails with 42501, add
--      the user via the dashboard instead (instructions at the bottom).
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- 1. diary_entries (app schema) ----------
CREATE TABLE IF NOT EXISTS public.diary_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  heading     text NOT NULL DEFAULT '',
  date_time   text NOT NULL DEFAULT '',
  sender_name text NOT NULL DEFAULT '',
  message     text NOT NULL DEFAULT '',
  reflection  text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- If an older diary_entries table exists, make sure every column is present.
ALTER TABLE public.diary_entries ADD COLUMN IF NOT EXISTS heading     text NOT NULL DEFAULT '';
ALTER TABLE public.diary_entries ADD COLUMN IF NOT EXISTS date_time   text NOT NULL DEFAULT '';
ALTER TABLE public.diary_entries ADD COLUMN IF NOT EXISTS sender_name text NOT NULL DEFAULT '';
ALTER TABLE public.diary_entries ADD COLUMN IF NOT EXISTS message     text NOT NULL DEFAULT '';
ALTER TABLE public.diary_entries ADD COLUMN IF NOT EXISTS reflection  text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_diary_entries_user_id    ON public.diary_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_diary_entries_created_at ON public.diary_entries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_diary_entries_heading    ON public.diary_entries(user_id, heading);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_diary_entries_updated_at ON public.diary_entries;
CREATE TRIGGER trg_diary_entries_updated_at
  BEFORE UPDATE ON public.diary_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- 2. Row Level Security ----------
ALTER TABLE public.diary_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can insert own entries" ON public.diary_entries;
CREATE POLICY "Users can insert own entries" ON public.diary_entries
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own entries" ON public.diary_entries;
CREATE POLICY "Users can view own entries" ON public.diary_entries
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own entries" ON public.diary_entries;
CREATE POLICY "Users can update own entries" ON public.diary_entries
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own entries" ON public.diary_entries;
CREATE POLICY "Users can delete own entries" ON public.diary_entries
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ---------- 3. Create / reset the hardcoded cloud account ----------
DO $$
DECLARE
  v_uid uuid;
  v_email text := 'depu_h2805@student.uml.edu';
BEGIN
  SELECT id INTO v_uid FROM auth.users WHERE email = v_email;

  IF v_uid IS NULL THEN
    -- NOTE: id must be supplied explicitly (auth.users.id has no default).
    INSERT INTO auth.users (
      id,
      instance_id, aud, role, email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, email_change, email_change_token_new,
      recovery_token, is_sso_user
    ) VALUES (
      gen_random_uuid(),
      '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', v_email,
      crypt('DeepuH@2805', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}',
      '{}',
      now(), now(),
      '', '', '', '', false
    )
    RETURNING id INTO v_uid;
  ELSE
    -- Already exists: reset password + ensure email is confirmed.
    UPDATE auth.users
       SET encrypted_password = crypt('DeepuH@2805', gen_salt('bf')),
           email_confirmed_at = COALESCE(email_confirmed_at, now()),
           updated_at = now()
     WHERE id = v_uid;
  END IF;

  -- Ensure the identity row exists (repair for partial runs / broken schema).
  -- ON CONFLICT avoids unique-violation if it already exists.
  BEGIN
    INSERT INTO auth.identities (
      id, user_id, provider_id, provider, identity_data,
      status, last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), v_uid, 'email', 'email',
      format('{"sub":"%s","email":"%s","email_verified":true}', v_uid::text, v_email)::jsonb,
      'verified', now(), now(), now()
    )
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    NULL; -- ignore if identities table shape differs; dashboard Add-user will fix it
  END;
END $$;

-- ---------- 4. Verification ----------
-- You should see ONE row with confirmed = true and has_identity = true.
SELECT
  u.id                                             AS user_id,
  u.email,
  (u.email_confirmed_at IS NOT NULL)               AS confirmed,
  EXISTS (SELECT 1 FROM auth.identities i
          WHERE i.user_id = u.id)                  AS has_identity
FROM auth.users u
WHERE u.email = 'depu_h2805@student.uml.edu';

-- ============================================================
-- IF STEP 3 FAILED WITH "permission denied for schema auth" (42501)
-- OR THE VERIFICATION ROW SHOWS confirmed=false / has_identity=false:
-- do it in the dashboard instead (takes 30 seconds):
--   1. Authentication -> Users -> "Add user"
--      Email:    depu_h2805@student.uml.edu
--      Password: DeepuH@2805
--      Check "Auto Confirm User"
--   2. Authentication -> Sign In / Up -> Email
--      Turn OFF "Confirm email"
-- Steps 1-2 above (table + RLS) will already have succeeded, so after
-- adding the user, login works and the import RLS error is gone.
-- ============================================================
