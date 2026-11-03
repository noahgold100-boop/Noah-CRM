import { NextResponse } from "next/server";
import { baseUrl } from "@/lib/env";
import { clearSessionCookie } from "@/lib/session";

export async function POST(req: Request) {
  const res = NextResponse.redirect(new URL("/", baseUrl(req)), 303);
  res.cookies.set(clearSessionCookie());
  return res;
}
