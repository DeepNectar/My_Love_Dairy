// ─── HARDCODED LOGIN CREDENTIALS ────────────────────────────────────────────
// This app uses a single fixed login. The user ID is pre-filled in the form
// and cannot be changed; only the password field is editable.
//
//   User ID  : DeepNectar   (pre-filled, locked)
//   Password : DeepuH@2805  (user must type this exactly)
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from './supabase';

export const FIXED_USER_ID = 'DeepNectar';

// Stored obfuscated (base64) so the plain password isn't sitting in source as
// a readable string. It is still embedded in the bundle — treat it as an
// access gate, not strong security.
const OBFUSCATED_PASSWORD = 'RGVlcHVIQDI4MDU=';

export function verifyHardcodedPassword(input: string): boolean {
  try {
    const expected = atob(OBFUSCATED_PASSWORD);
    return input === expected;
  } catch {
    return false;
  }
}

// The Supabase email used for the fixed account's real auth session.
// A REAL Supabase login (email/password) is performed behind the scenes so the
// request carries a genuine JWT — otherwise RLS (`auth.uid() = user_id`)
// rejects every insert with "new row violates row-level security policy".
export const SUPABASE_ACCOUNT_EMAIL =
  import.meta.env.VITE_DIARY_ACCOUNT_EMAIL || 'deepnectar@diary-app.local';

// Password for that Supabase account. Defaults to the same fixed app password.
// If you changed it in Supabase, set VITE_DIARY_ACCOUNT_PASSWORD in .env.
const SUPABASE_ACCOUNT_PASSWORD =
  import.meta.env.VITE_DIARY_ACCOUNT_PASSWORD || atob(OBFUSCATED_PASSWORD);

// Deterministic UUID derived from the fixed user id (v5-style via SHA-256).
async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

let cachedUserId: string | null = null;

export async function getFixedSupabaseUserId(): Promise<string> {
  if (cachedUserId) return cachedUserId;
  const hex = await sha256Hex(`hardcoded-auth:${FIXED_USER_ID}`);
  // Format as a valid UUID v4-looking string from the hash.
  cachedUserId = [
    hex.slice(0, 8),
    hex.slice(8, 12),
    '4' + hex.slice(13, 16),
    ((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16) + hex.slice(18, 20),
    hex.slice(20, 32),
  ].join('-');
  return cachedUserId;
}

/**
 * Signs in to Supabase with the fixed account so subsequent inserts/updates
 * carry a real JWT and pass the diary_entries RLS policies.
 *
 * IMPORTANT: the account must exist in Supabase (Auth → Users) with this exact
 * email/password — see section 6 of supabase/schema.sql. Its uid will be the
 * value returned here, which the app then writes into `user_id`.
 */
export async function ensureSupabaseSession(): Promise<string> {
  // Reuse an existing valid session if we already have one.
  const { data: existing } = await supabase.auth.getSession();
  if (existing.session?.user) {
    cachedUserId = existing.session.user.id;
    return cachedUserId;
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: SUPABASE_ACCOUNT_EMAIL,
    password: SUPABASE_ACCOUNT_PASSWORD,
  });

  if (error || !data.session?.user) {
    throw new Error(
      'Supabase login failed: ' +
        (error?.message || 'no session') +
        '. Make sure the account exists (see schema.sql section 6).'
    );
  }

  cachedUserId = data.session.user.id;
  return cachedUserId;
}

/** Clears the in-memory cached uid (used on logout). */
export function resetCachedUserId() {
  cachedUserId = null;
}
