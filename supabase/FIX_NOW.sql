-- ============================================================
-- FIX_NOW.sql  (v3 — safe for the SQL Editor)
-- Paste this ENTIRE file into Supabase Dashboard → SQL Editor → Run.
--
-- WHY v3: the previous version tried to CREATE TABLE auth.users, which
-- your dashboard role is not allowed to do (error 42501 "permission
-- denied for schema auth"). The auth schema is managed by Supabase
-- itself — it was NOT actually broken. This script touches only what
-- your role owns: public tables, RLS policies, and inserting the app
-- user via the supported auth.users INSERT path (same one Supabase's
-- own dashboard uses).
--
-- Safe to run multiple times (idempotent). It never drops anything.
-- ============================================================

-- ---------- 1. Extension & helper trigger function ----------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------- 2. heading_categories ----------
CREATE TABLE IF NOT EXISTS public.heading_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_heading_categories_user_id
  ON public.heading_categories(user_id);

DROP TRIGGER IF EXISTS trg_heading_categories_updated_at
  ON public.heading_categories;
CREATE TRIGGER trg_heading_categories_updated_at
  BEFORE UPDATE ON public.heading_categories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.heading_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own categories"
  ON public.heading_categories;
CREATE POLICY "Users manage own categories"
  ON public.heading_categories
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ---------- 3. diary_entries ----------
CREATE TABLE IF NOT EXISTS public.diary_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title        text NOT NULL,
  content      text,
  mood         text,
  entry_date   date NOT NULL DEFAULT CURRENT_DATE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_diary_entries_user_id
  ON public.diary_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_diary_entries_entry_date
  ON public.diary_entries(entry_date);

DROP TRIGGER IF EXISTS trg_diary_entries_updated_at
  ON public.diary_entries;
CREATE TRIGGER trg_diary_entries_updated_at
  BEFORE UPDATE ON public.diary_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.diary_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can insert own entries"
  ON public.diary_entries;
CREATE POLICY "Users can insert own entries"
  ON public.diary_entries
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own entries"
  ON public.diary_entries;
CREATE POLICY "Users can view own entries"
  ON public.diary_entries
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own entries"
  ON public.diary_entries;
CREATE POLICY "Users can update own entries"
  ON public.diary_entries
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own entries"
  ON public.diary_entries;
CREATE POLICY "Users can delete own entries"
  ON public.diary_entries
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ---------- 4. Create / reset the app login account ----------
-- This INSERT into auth.users is the same path the Supabase dashboard
-- "Add user" button uses. Your postgres role has permission for it on
-- a normal project. If it still fails with 42501, use the dashboard
-- instead: Authentication -> Users -> Add user (see note at bottom).
DO $$
DECLARE
  v_uid uuid;
BEGIN
  SELECT id INTO v_uid FROM auth.users
   WHERE email = 'deepnectar@diary-app.local';

  IF v_uid IS NULL THEN
    INSERT INTO auth.users (
      instance_id, aud, role, email,
      encrypted_password,
      email_confirmed_at, recovery_sent_at,
      last_sign_in_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, email_change, email_change_token_new,
      recovery_token, is_sso_user
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated', 'deepnectar@diary-app.local',
      crypt('DeepuH@2805', gen_salt('bf')),
      now(), null, null,
      '{"provider":"email","providers":["email"]}',
      '{}',
      now(), now(),
      '', '', '', '', false
    )
    RETURNING id INTO v_uid;

    INSERT INTO auth.identities (
      id, user_id, provider_id, provider, identity_data,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), v_uid, v_uid, 'email',
      format('{"sub":"%s","email":"%s","email_verified":true}',
             v_uid::text, 'deepnectar@diary-app.local')::jsonb,
      now(), now(), now()
    );
  ELSE
    -- Already exists: just reset the password + confirm email.
    UPDATE auth.users
       SET encrypted_password = crypt('DeepuH@2805', gen_salt('bf')),
           email_confirmed_at = COALESCE(email_confirmed_at, now()),
           updated_at = now()
     WHERE id = v_uid;

    IF NOT EXISTS (SELECT 1 FROM auth.identities WHERE user_id = v_uid) THEN
      INSERT INTO auth.identities (
        id, user_id, provider_id, provider, identity_data,
        last_sign_in_at, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), v_uid, v_uid, 'email',
        format('{"sub":"%s","email":"%s","email_verified":true}',
               v_uid::text, 'deepnectar@diary-app.local')::jsonb,
        now(), now(), now()
      );
    END IF;
  END IF;
END $$;

-- ---------- 5. Verification ----------
-- You should see ONE row with confirmed = true and has_identity = true.
SELECT
  u.id                                            AS user_id,
  u.email,
  (u.email_confirmed_at IS NOT NULL)              AS confirmed,
  EXISTS (SELECT 1 FROM auth.identities i
          WHERE i.user_id = u.id)                 AS has_identity
FROM auth.users u
WHERE u.email = 'deepnectar@diary-app.local';

-- ============================================================
-- IF STEP 4 FAILED WITH "permission denied for schema auth":
-- Do it in the dashboard instead (takes 30 seconds):
--   1. Authentication -> Users -> "Add user"
--      Email:    deepnectar@diary-app.local
--      Password: DeepuH@2805
--      Check "Auto Confirm User"
--   2. Authentication -> Sign In / Up -> Email
--      Turn OFF "Confirm email"
-- Steps 1-3 above (tables + RLS) will already have succeeded, so
-- after adding the user the import/RLS error is gone.
-- ============================================================
