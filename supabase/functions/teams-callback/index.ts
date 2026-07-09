// OAuth redirect target for Microsoft login. Deployed with verify_jwt = false:
// the browser arrives here from login.microsoftonline.com without any Supabase
// JWT. Authenticity is guaranteed by the HMAC-signed `state` we issued in
// teams-integration; without a valid signature nothing is stored.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { exchangeCode, graphGet, verifyState } from "../_shared/msgraph.ts";

function redirect(to: string, result: string): Response {
  const url = new URL(to);
  url.searchParams.set("teams", result);
  return new Response(null, { status: 302, headers: { Location: url.toString() } });
}

const FALLBACK_APP_URL = "https://haoran-yang-henry.github.io/Meeting_KMS_Original/";

Deno.serve(async (req) => {
  const params = new URL(req.url).searchParams;
  const state = params.get("state") ?? "";

  const verified = await verifyState(state);
  if (!verified) {
    // No trustworthy return address — use the production app URL.
    return redirect(FALLBACK_APP_URL, "error");
  }
  const { userId, appUrl } = verified;

  if (params.get("error") || !params.get("code")) {
    console.error("OAuth error:", params.get("error"), params.get("error_description"));
    return redirect(appUrl, "denied");
  }

  try {
    const tokens = await exchangeCode(params.get("code")!);
    if (!tokens.refresh_token) {
      console.error("No refresh token returned (offline_access missing?)");
      return redirect(appUrl, "error");
    }

    // Identify the connected account for display purposes
    let accountEmail: string | null = null;
    const me = await graphGet(tokens.access_token, "/me?$select=mail,userPrincipalName");
    if (me.ok) {
      const profile = await me.json();
      accountEmail = profile.mail ?? profile.userPrincipalName ?? null;
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { error } = await supabase.from("ms_connections").upsert({
      user_id: userId,
      account_email: accountEmail,
      refresh_token: tokens.refresh_token,
      scopes: "delegated",
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (error) {
      console.error("Store connection error:", error);
      return redirect(appUrl, "error");
    }

    return redirect(appUrl, "connected");
  } catch (error) {
    console.error("Callback error:", error);
    return redirect(appUrl, "error");
  }
});
