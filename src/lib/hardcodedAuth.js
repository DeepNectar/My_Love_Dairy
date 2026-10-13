import { supabase } from "./supabase";
const FIXED_USER_ID = "DeepNectar";
const OBFUSCATED_PASSWORD = "RGVlcHVIQDI4MDU=";
function verifyHardcodedPassword(input) {
  try {
    const expected = atob(OBFUSCATED_PASSWORD);
    return input === expected;
  } catch {
    return false;
  }
}
const SUPABASE_ACCOUNT_EMAIL = "depu_h2805@student.uml.edu";
const SUPABASE_ACCOUNT_PASSWORD = "DeepuH@2805";
async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
let cachedUserId = null;
async function getFixedSupabaseUserId() {
  if (cachedUserId) return cachedUserId;
  const hex = await sha256Hex(`hardcoded-auth:${FIXED_USER_ID}`);
  cachedUserId = [
    hex.slice(0, 8),
    hex.slice(8, 12),
    "4" + hex.slice(13, 16),
    (parseInt(hex.slice(16, 18), 16) & 63 | 128).toString(16) + hex.slice(18, 20),
    hex.slice(20, 32)
  ].join("-");
  return cachedUserId;
}
function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${Math.round(ms / 1e3)}s`)),
      ms
    );
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}
const REQUEST_TIMEOUT_MS = 8e3;
let sessionPromise = null;
async function signInFresh() {
  try {
    await withTimeout(supabase.auth.signOut(), 3e3, "Sign out");
  } catch {
  }
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { data, error } = await withTimeout(
        supabase.auth.signInWithPassword({
          email: SUPABASE_ACCOUNT_EMAIL,
          password: SUPABASE_ACCOUNT_PASSWORD
        }),
        REQUEST_TIMEOUT_MS,
        "Supabase login"
      );
      if (!error && data.session?.user) {
        cachedUserId = data.session.user.id;
        return cachedUserId;
      }
      const msg = error?.message || "no session returned";
      if (/invalid login credentials|email or password|not confirmed|user not found/i.test(msg)) {
        throw new Error(
          'Cloud account "' + SUPABASE_ACCOUNT_EMAIL + '" not found in Supabase. Fix: Dashboard \u2192 Authentication \u2192 Users \u2192 "Add user" (email above, password DeepuH@2805, auto-confirm ON), or run: npm run create-auth-user (see supabase/schema.sql section 6).'
        );
      }
      if (/database error querying schema|unexpected_failure|schema.*auth|relation .*auth.*does not exist/i.test(msg)) {
        throw new Error(
          'Supabase Auth is broken on the server ("Database error querying schema"). This is NOT an internet problem. Fix in Supabase Dashboard: (1) Settings \u2192 General \u2192 make sure the project is UNPAUSED; (2) SQL Editor \u2192 run: CREATE SCHEMA IF NOT EXISTS auth; then re-run ONLY section 6 of supabase/schema.sql; (3) Authentication \u2192 Users \u2192 delete any half-created user, then "Add user" again (depu_h2805@student.uml.edu / DeepuH@2805, auto-confirm ON). If it still fails, contact Supabase support with this error id shown in Network tab.'
        );
      }
      if (/rate limit|too many requests|temporarily|over_|fetch failed|Failed to fetch/i.test(msg)) {
        lastError = new Error(msg === "no session returned" ? "Supabase is rate-limiting requests" : msg);
      } else {
        lastError = new Error(msg);
      }
    } catch (err) {
      if (err?.message && /not found in Supabase|Supabase Auth is broken|Supabase login rejected/.test(err.message)) throw err;
      lastError = err;
    }
    if (attempt === 1) await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    "Cloud sync could not connect to Supabase: " + (lastError?.message || "unknown error") + ". Check your internet connection and that VITE_SUPABASE_URL is correct."
  );
}
async function ensureSupabaseSession() {
  if (cachedUserId) return cachedUserId;
  try {
    const { data: existing } = await withTimeout(
      supabase.auth.getSession(),
      REQUEST_TIMEOUT_MS,
      "Session check"
    );
    if (existing.session?.user) {
      const testResult = await withTimeout(
        Promise.resolve(
          supabase.from("diary_entries").select("id", { count: "exact", head: true }).limit(1)
        ),
        REQUEST_TIMEOUT_MS,
        "Session verify"
      );
      if (!testResult.error) {
        cachedUserId = existing.session.user.id;
        return cachedUserId;
      }
      try {
        await withTimeout(supabase.auth.signOut(), 3e3, "Sign out");
      } catch {
      }
    }
  } catch {
    try {
      await supabase.auth.signOut();
    } catch {
    }
  }
  if (!sessionPromise) {
    sessionPromise = signInFresh().finally(() => {
      sessionPromise = null;
    });
  }
  return sessionPromise;
}
function resetCachedUserId() {
  cachedUserId = null;
}
export {
  FIXED_USER_ID,
  SUPABASE_ACCOUNT_EMAIL,
  ensureSupabaseSession,
  getFixedSupabaseUserId,
  resetCachedUserId,
  verifyHardcodedPassword
};
