// ─── HARDCODED LOGIN CREDENTIALS ────────────────────────────────────────────
// This app uses a single fixed login. The user ID is pre-filled in the form
// and cannot be changed; only the password field is editable.
//
//   User ID  : DeepNectar   (pre-filled, locked)
//   Password : DeepuH@2805  (user must type this exactly)
// ─────────────────────────────────────────────────────────────────────────────

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
