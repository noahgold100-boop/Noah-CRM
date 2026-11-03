import { google } from "googleapis";
import { env } from "./env";
import { decrypt, encrypt } from "./crypto";
import { getSetting, setSetting } from "./db";

export type GAuth = InstanceType<typeof google.auth.OAuth2>;

export const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.events",
];

export type GoogleSetting = {
  email: string;
  refresh_token: string; // encrypted
  connected_at: string;
  status: "connected" | "needs_reconnect";
  error?: string;
};

export function oauthClient(redirectUri?: string) {
  return new google.auth.OAuth2(env.googleClientId, env.googleClientSecret, redirectUri);
}

export async function saveGoogleTokens(email: string, refreshToken: string | null | undefined) {
  const existing = await getSetting<GoogleSetting>("google");
  const token = refreshToken ? encrypt(refreshToken) : existing?.refresh_token;
  if (!token) throw new Error("Google did not return offline access. Remove the app at myaccount.google.com/permissions and sign in again.");
  await setSetting("google", {
    email,
    refresh_token: token,
    connected_at: new Date().toISOString(),
    status: "connected",
  } satisfies GoogleSetting);
}

export async function googleStatus() {
  const g = await getSetting<GoogleSetting>("google");
  if (!g) return { connected: false as const };
  return { connected: g.status === "connected", email: g.email, error: g.error };
}

/** An authorized client for background work (cron) using the stored refresh token. */
export async function authedClient() {
  const g = await getSetting<GoogleSetting>("google");
  if (!g || g.status !== "connected") {
    const e: any = new Error("Google is not connected. Open Settings and reconnect Google.");
    e.status = 409;
    throw e;
  }
  const client = oauthClient();
  client.setCredentials({ refresh_token: decrypt(g.refresh_token) });
  return client;
}

/** Call when Google rejects the refresh token, so the UI can show "Reconnect Google". */
export async function markGoogleBroken(err: unknown) {
  const msg = String((err as any)?.message || err);
  if (!/invalid_grant|unauthorized_client|invalid_token/i.test(msg)) return false;
  const g = await getSetting<GoogleSetting>("google");
  if (g) await setSetting("google", { ...g, status: "needs_reconnect", error: msg });
  return true;
}
