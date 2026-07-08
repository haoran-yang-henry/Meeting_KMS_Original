import { createClient, type SupabaseClient, type User } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "./cors.ts";

export interface AuthedContext {
  req: Request;
  user: User;
  supabase: SupabaseClient;
}

/**
 * Standard wrapper for all edge functions:
 * - answers CORS preflight
 * - rejects unauthenticated callers (the anon key alone is NOT enough:
 *   getUser() must resolve to a real user)
 * - creates a Supabase client bound to the caller's JWT so RLS applies
 * - converts uncaught errors into a 500 without leaking internals
 */
export function serveWithAuth(
  handler: (ctx: AuthedContext) => Promise<Response>,
) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return json({ error: "Missing authorization header" }, 401);
      }

      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );

      const { data: { user }, error } = await supabase.auth.getUser();
      if (error || !user) {
        return json({ error: "Unauthorized" }, 401);
      }

      return await handler({ req, user, supabase });
    } catch (error) {
      console.error("Unhandled error:", error);
      return json({ error: "Internal server error" }, 500);
    }
  });
}
