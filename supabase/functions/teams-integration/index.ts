import { createClient } from "jsr:@supabase/supabase-js@2";
import { serveWithAuth } from "../_shared/auth.ts";
import { json } from "../_shared/cors.ts";
import { getAuthorizeUrl, isAllowedAppUrl, msConfigured, signState } from "../_shared/msgraph.ts";

interface IntegrationRequest {
  action: "status" | "connect" | "disconnect";
  appUrl?: string; // frontend base URL to return to after OAuth (allowlisted)
}

// ms_connections is only reachable with the service role — clients have no grants.
function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

serveWithAuth(async ({ req, user }) => {
  const { action, appUrl }: IntegrationRequest = await req.json();

  if (action === "status") {
    if (!msConfigured()) {
      return json({ connected: false, available: false });
    }
    const { data } = await serviceClient()
      .from("ms_connections")
      .select("account_email, connected_at")
      .eq("user_id", user.id)
      .maybeSingle();
    return json({
      available: true,
      connected: !!data,
      accountEmail: data?.account_email ?? null,
      connectedAt: data?.connected_at ?? null,
    });
  }

  if (action === "connect") {
    if (!msConfigured()) {
      return json({ error: "Microsoft integration not configured" }, 503);
    }
    if (!appUrl || !isAllowedAppUrl(appUrl)) {
      return json({ error: "Invalid appUrl" }, 400);
    }
    const state = await signState(user.id, appUrl);
    return json({ url: getAuthorizeUrl(state) });
  }

  if (action === "disconnect") {
    await serviceClient().from("ms_connections").delete().eq("user_id", user.id);
    return json({ success: true });
  }

  return json({ error: "Unknown action" }, 400);
});
