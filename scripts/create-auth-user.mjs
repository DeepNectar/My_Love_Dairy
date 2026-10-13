#!/usr/bin/env node
// Creates the fixed diary account in Supabase Auth so the app's hidden login
// gets a real JWT and RLS policies accept inserts.
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/create-auth-user.mjs
// or
//   SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=xxxx \
//     node scripts/create-auth-user.mjs        (uses Supabase Management API)
//
// Get the service_role key: Dashboard → Project Settings → API →
// "service_role secret". Keep it private — it bypasses RLS.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env if present (simple parser, no dependency).
const envPath = resolve(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const url = process.env.VITE_SUPABASE_URL || 'https://unvomzolyjwcdavitdmr.supabase.co';
const email = 'depu_h2805@student.uml.edu';
const password = 'DeepuH@2805';
const anonKey = process.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVudm9tem9seWp3Y2Rhdml0ZG1yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4NzQ3NjEsImV4cCI6MjEwNzQ1MDc2MX0.SaukqHzJlXRXfx2R4yvbIEeWFEj7hm9xnkj6Oqw_4wY';

async function createUserWithServiceRole() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return false;
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true, // auto-confirm so password login works immediately
    }),
  });
  const text = await res.text();
  if (res.ok) {
    console.log(`✅ Created auth user ${email} (id: ${JSON.parse(text)?.id})`);
    return true;
  }
  if (/already exists|user already/i.test(text)) {
    console.log(`ℹ️ User ${email} already exists.`);
    return true;
  }
  console.error(`❌ Admin API create failed (${res.status}): ${text}`);
  return false;
}

async function createUserWithManagementApi() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF ||
    (url.match(/https:\/\/([a-z0-9-]+)\.supabase\.co/) || [])[1];
  if (!token || !ref) return false;
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/auth/create-user`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const text = await res.text();
  if (res.ok) {
    console.log(`✅ Created auth user ${email} via Management API`);
    return true;
  }
  console.error(`❌ Management API create failed (${res.status}): ${text}`);
  return false;
}

async function verifyLogin() {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anonKey },
    body: JSON.stringify({ email, password }),
  });
  const text = await res.text();
  if (res.ok) {
    console.log('✅ Password login verified — the app can now sign in.');
    return true;
  }
  console.error(`❌ Login verification failed (${res.status}): ${text}`);
  return false;
}

let done =
  (await createUserWithServiceRole()) ||
  (await createUserWithManagementApi());

if (!done) {
  console.log(`
No credentials supplied. Do ONE of these:

1) Easiest — Supabase Dashboard:
   Authentication → Users → "Add user"
   Email:    ${email}
   Password: ${password}
   Check "Auto Confirm User" ✅

2) SQL Editor (paste section 6 block from supabase/schema.sql, uncommented).

3) With the service role key (Dashboard → Project Settings → API):
   SUPABASE_SERVICE_ROLE_KEY=ey... npm run create-auth-user

Then re-run this script to verify login.
`);
  // Still try to verify in case the user was created manually.
  done = await verifyLogin();
  process.exit(done ? 0 : 1);
}

process.exit((await verifyLogin()) ? 0 : 1);
