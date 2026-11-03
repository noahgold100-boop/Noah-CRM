import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { baseUrl, env } from "@/lib/env";
import { oauthClient, saveGoogleTokens, SCOPES } from "@/lib/google";
import { createSessionCookie } from "@/lib/session";

export const dynamic = "force-dynamic";

function back(req: Request, error?: string) {
  const u = new URL("/", baseUrl(req));
  if (error) u.searchParams.set("error", error);
  return NextResponse.redirect(u);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const store = await cookies();
  if (url.searchParams.get("error")) return back(req, "Google sign-in was cancelled.");
  if (!code || !state || state !== store.get("oauth_state")?.value) return back(req, "Sign-in expired. Please try again.");

  try {
    const client = oauthClient(`${baseUrl(req)}/api/auth/callback`);
    const { tokens } = await client.getToken(code);
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token!, audience: env.googleClientId });
    const email = (ticket.getPayload()?.email || "").toLowerCase();
    if (email !== env.ownerEmail) return back(req, `This CRM is private. Signed in as ${email}, which isn't the owner account.`);

    const granted = (tokens.scope || "").split(" ");
    const missing = SCOPES.filter((s) => s.startsWith("https://") && !granted.includes(s));
    if (missing.length) return back(req, "Please allow Gmail (read-only) and Calendar access — the CRM needs both to work.");

    await saveGoogleTokens(email, tokens.refresh_token);
    const res = back(req);
    res.cookies.set(await createSessionCookie(email));
    res.cookies.set("oauth_state", "", { path: "/", maxAge: 0 });
    return res;
  } catch (e: any) {
    console.error(e);
    return back(req, e?.message || "Sign-in failed.");
  }
}
