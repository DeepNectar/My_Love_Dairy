import { createClient } from "@supabase/supabase-js";
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "https://unvomzolyjwcdavitdmr.supabase.co";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVudm9tem9seWp3Y2Rhdml0ZG1yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4NzQ3NjEsImV4cCI6MjEwNzQ1MDc2MX0.SaukqHzJlXRXfx2R4yvbIEeWFEj7hm9xnkj6Oqw_4wY";
if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("Supabase credentials are missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env");
}
const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // Gracefully handle environments where localStorage is unavailable (sandboxed iframes)
    storageKey: "diary-auth"
  }
});
export {
  supabase
};
