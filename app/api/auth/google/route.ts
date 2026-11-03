import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { baseUrl, env, missingEnv } from "@/lib/env";
import { oauthClient, SCOPES } from "@/lib/google";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (missingEnv().length) return NextResponse.redirect(new URL("/", req.url));
  const state = randomBytes(16).toString("hex");
  const client = oauthClient(`${baseUrl(req)}/api/auth/callback`);
  const url = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    scope: SCOPES,
    state,
    login_hint: env.ownerEmail,
  });
  const res = NextResponse.redirect(url);
  res.cookies.set("oauth_state", state, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600 });
  return res;
}
