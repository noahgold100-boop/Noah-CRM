import { NextResponse } from "next/server";
import { api } from "@/lib/session";
import { saveProfile } from "@/lib/profile";
import { connectCalendly, disconnectCalendly } from "@/lib/calendly";

export const dynamic = "force-dynamic";

export const PUT = api(async (req: Request) => {
  const b = await req.json();
  return NextResponse.json({ profile: await saveProfile(b.profile || {}) });
});

export const POST = api(async (req: Request) => {
  const { calendly_token } = await req.json();
  if (!calendly_token) return NextResponse.json({ error: "Paste your Calendly token" }, { status: 400 });
  return NextResponse.json(await connectCalendly(calendly_token));
});

export const DELETE = api(async () => {
  await disconnectCalendly();
  return NextResponse.json({ ok: true });
});
