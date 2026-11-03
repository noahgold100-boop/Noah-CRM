import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { env } from "./env";

const COOKIE = "crm_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function secret() {
  return new TextEncoder().encode(env.sessionSecret);
}

export async function createSessionCookie(email: string) {
  const token = await new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());
  return {
    name: COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: MAX_AGE,
  };
}

export async function currentUser(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const email = String(payload.email || "").toLowerCase();
    return email === env.ownerEmail ? email : null;
  } catch {
    return null;
  }
}

export class Unauthorized extends Error {}

export async function requireOwner(): Promise<string> {
  const u = await currentUser();
  if (!u) throw new Unauthorized();
  return u;
}

export function clearSessionCookie() {
  return { name: COOKIE, value: "", path: "/", maxAge: 0 };
}

/** Wraps an API handler: owner-only, consistent JSON errors. */
export function api<A extends any[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      await requireOwner();
      return await fn(...args);
    } catch (e: any) {
      if (e instanceof Unauthorized) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
      console.error(e);
      return NextResponse.json({ error: e?.message || "Something went wrong" }, { status: e?.status || 500 });
    }
  };
}
