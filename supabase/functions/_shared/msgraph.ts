// Microsoft Graph OAuth + API helpers for the Teams transcript integration.
//
// Required secrets: MS_CLIENT_ID, MS_CLIENT_SECRET (from the Entra app
// registration). The redirect URI is always <SUPABASE_URL>/functions/v1/teams-callback.
//
// Only work/school accounts can use the transcript APIs, and the tenant must
// allow the delegated scopes below (the user consents; OnlineMeetingTranscript
// additionally needs admin consent in most tenants).

export const GRAPH_SCOPES = [
  "offline_access",
  "User.Read",
  "Calendars.Read",
  "OnlineMeetings.Read",
  "OnlineMeetingTranscript.Read.All",
].join(" ");

const AUTH_BASE = "https://login.microsoftonline.com/common/oauth2/v2.0";
export const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

// Frontend base URLs allowed as post-OAuth redirect targets.
const ALLOWED_APP_URLS = [
  "http://localhost:8080/",
  "https://haoran-yang-henry.github.io/Meeting_KMS_Original/",
];

export function isAllowedAppUrl(url: string): boolean {
  return ALLOWED_APP_URLS.includes(url);
}

export function msConfigured(): boolean {
  return !!(Deno.env.get("MS_CLIENT_ID") && Deno.env.get("MS_CLIENT_SECRET"));
}

export function getRedirectUri(): string {
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1/teams-callback`;
}

export function getAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: Deno.env.get("MS_CLIENT_ID")!,
    response_type: "code",
    redirect_uri: getRedirectUri(),
    response_mode: "query",
    scope: GRAPH_SCOPES,
    state,
  });
  return `${AUTH_BASE}/authorize?${params}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  body.set("client_id", Deno.env.get("MS_CLIENT_ID")!);
  body.set("client_secret", Deno.env.get("MS_CLIENT_SECRET")!);

  const response = await fetch(`${AUTH_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("MS token error:", response.status, errorText.slice(0, 300));
    throw new Error("Microsoft token exchange failed");
  }
  return await response.json();
}

export function exchangeCode(code: string): Promise<TokenResponse> {
  return tokenRequest(new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: getRedirectUri(),
    scope: GRAPH_SCOPES,
  }));
}

export function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  return tokenRequest(new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: GRAPH_SCOPES,
  }));
}

export async function graphGet(
  accessToken: string,
  path: string,
  accept = "application/json",
): Promise<Response> {
  return await fetch(path.startsWith("http") ? path : `${GRAPH_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: accept },
  });
}

// --- Stateless OAuth `state` signing (HMAC, service-role key as secret) ---

async function hmacKey(): Promise<CryptoKey> {
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function b64url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** state payload: `${userId}|${appUrl}|${timestampMs}` */
export async function signState(userId: string, appUrl: string): Promise<string> {
  const payload = `${userId}|${appUrl}|${Date.now()}`;
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(), new TextEncoder().encode(payload));
  return `${btoa(payload).replaceAll("=", "")}.${b64url(sig)}`;
}

const STATE_MAX_AGE_MS = 10 * 60 * 1000;

export async function verifyState(
  state: string,
): Promise<{ userId: string; appUrl: string } | null> {
  try {
    const [payloadB64, sigB64] = state.split(".");
    const payload = atob(payloadB64);
    const expected = b64url(
      await crypto.subtle.sign("HMAC", await hmacKey(), new TextEncoder().encode(payload)),
    );
    if (expected !== sigB64) return null;

    const [userId, appUrl, ts] = payload.split("|");
    if (!userId || !appUrl || Date.now() - Number(ts) > STATE_MAX_AGE_MS) return null;
    if (!isAllowedAppUrl(appUrl)) return null;
    return { userId, appUrl };
  } catch {
    return null;
  }
}
