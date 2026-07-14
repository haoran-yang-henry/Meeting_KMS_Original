import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

declare global {
  interface Window {
    __ENV?: Record<string, string | undefined>;
  }
}

// Runtime config (window.__ENV, written by the container entrypoint into
// env.js) takes precedence over build-time values, so one image can point
// at any Supabase instance. Static deploys (GitHub Pages) ship an empty
// env.js and fall back to the values baked in at build time.
const runtimeEnv = window.__ENV ?? {};

const SUPABASE_URL =
  runtimeEnv.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY =
  runtimeEnv.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  }
});