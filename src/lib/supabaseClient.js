import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    "Missing Supabase config. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see .env.example)."
  );
}

// Supabase persists the login session in the browser's localStorage by
// default, which is exactly what gives us "stay logged in" / cross-device
// login for free once this is a real deployed website.
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
