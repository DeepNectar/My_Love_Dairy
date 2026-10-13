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
// Wrap a promise so it can never hang longer than `ms` milliseconds.
// Supabase network calls occasionally stall (bad connection, DNS issues);
// without this the login button would sit on "Please wait..." forever.
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)),
      ms
    );
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

const REQUEST_TIMEOUT_MS = 8000;

export async function ensureSupabaseSession(): Promise<string> {
  // Reuse an existing valid session if we already have one — no network call.
  try {
    const { data: existing } = await withTimeout(
      supabase.auth.getSession(),
      REQUEST_TIMEOUT_MS,
      'Session check'
    );
    if (existing.session?.user) {
      cachedUserId = existing.session.user.id;
      return cachedUserId;
    }
  } catch {
    // Stale/unreadable local session — fall through to a fresh sign-in.
    try { await supabase.auth.signOut(); } catch { /* ignore */ }
  }

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { data, error } = await withTimeout(
        supabase.auth.signInWithPassword({
          email: SUPABASE_ACCOUNT_EMAIL,
          password: SUPABASE_ACCOUNT_PASSWORD,
        }),
        REQUEST_TIMEOUT_MS,
        'Supabase login'
      );

      if (!error && data.session?.user) {
        cachedUserId = data.session.user.id;
        return cachedUserId;
      }

      const msg = error?.message || 'no session returned';

      // Wrong credentials / unknown user → retrying is pointless.
      if (/invalid login credentials|email or password|not confirmed|user not found/i.test(msg)) {
        throw new Error(
          'Cloud account "' + SUPABASE_ACCOUNT_EMAIL + '" not found in Supabase. ' +
          'Fix: Dashboard → Authentication → Users → "Add user" (email above, password DeepuH@2805, ' +
          'auto-confirm ON), or run: npm run create-auth-user (see supabase/schema.sql section 6).'
        );
      }
      // Rate limit / temporary server errors → worth one retry.
      if (/rate limit|too many requests|temporarily|over_|fetch failed|Failed to fetch/i.test(msg)) {
        lastError = new Error(msg === 'no session returned' ? 'Supabase is rate-limiting requests' : msg);
      } else {
        lastError = new Error(msg);
      }
    } catch (err: any) {
      // Custom actionable messages (thrown above) must not be swallowed.
      if (err?.message && /not found in Supabase|Supabase login rejected/.test(err.message)) throw err;
      lastError = err; // timeout / network hiccup → retry once
    }
    if (attempt === 1) await new Promise((r) => setTimeout(r, 500));
  }

  throw new Error(
    'Cloud sync could not connect to Supabase: ' +
      (lastError?.message || 'unknown error') +
      '. Check your internet connection and that VITE_SUPABASE_URL is correct.'
  );
}

/** Clears the in-memory cached uid (used on logout). */
export function resetCachedUserId() {
  cachedUserId = null;
}
