// Local session management for the hardcoded ("DeepNectar") login.
// The app uses a fixed credential gate instead of Supabase email/password auth,
// so we persist our own signed session token in localStorage.

import { FIXED_USER_ID } from './hardcodedAuth';

const SESSION_KEY = 'diary-hardcoded-session';

// Simple HMAC-ish signature using SHA-256 over payload + secret salt.
async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const SECRET_SALT = 'diary-app-hardcoded-session-v1';

export interface LocalSession {
  userId: string; // fixed login id (DeepNectar)
  createdAt: number;
  signature: string;
}

export async function createLocalSession(): Promise<LocalSession> {
  const createdAt = Date.now();
  const payload = `${FIXED_USER_ID}:${createdAt}:${SECRET_SALT}`;
  const signature = await sha256Hex(payload);
  const session: LocalSession = { userId: FIXED_USER_ID, createdAt, signature };
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* storage unavailable — session lives in memory only */
  }
  return session;
}

export async function readLocalSession(): Promise<LocalSession | null> {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as LocalSession;
    if (session.userId !== FIXED_USER_ID) return null;
    const expected = await sha256Hex(`${session.userId}:${session.createdAt}:${SECRET_SALT}`);
    if (expected !== session.signature) return null; // tampered
    return session;
  } catch {
    return null;
  }
}

export function clearLocalSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

// --- Generic local key/value persistence (used for stickers, etc.) ---
export function writeLocalSessionItem(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

export function readLocalSessionItem<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
