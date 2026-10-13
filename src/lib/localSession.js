import { FIXED_USER_ID } from "./hardcodedAuth";
const SESSION_KEY = "diary-hardcoded-session";
async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
const SECRET_SALT = "diary-app-hardcoded-session-v1";
async function createLocalSession() {
  const createdAt = Date.now();
  const payload = `${FIXED_USER_ID}:${createdAt}:${SECRET_SALT}`;
  const signature = await sha256Hex(payload);
  const session = { userId: FIXED_USER_ID, createdAt, signature };
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
  }
  return session;
}
async function readLocalSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (session.userId !== FIXED_USER_ID) return null;
    const expected = await sha256Hex(`${session.userId}:${session.createdAt}:${SECRET_SALT}`);
    if (expected !== session.signature) return null;
    return session;
  } catch {
    return null;
  }
}
function clearLocalSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
  }
}
function writeLocalSessionItem(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
  }
}
function readLocalSessionItem(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
export {
  clearLocalSession,
  createLocalSession,
  readLocalSession,
  readLocalSessionItem,
  writeLocalSessionItem
};
