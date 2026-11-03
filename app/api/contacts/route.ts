import { NextResponse } from "next/server";
import { api } from "@/lib/session";
import { getSetting } from "@/lib/db";
import { createContact } from "@/lib/contacts";
import { todayIn } from "@/lib/dates";
import { normalizeSide, normalizeTier, sideForRole } from "@/lib/roles";
import { reconcileNow } from "@/lib/sync";

export const dynamic = "force-dynamic";

export const POST = api(async (req: Request) => {
  const b = await req.json();
  const name = String(b.name || "").trim();
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  const role = String(b.role || "Other");
  const tz = (await getSetting<string>("timezone")) || "America/Chicago";
  const c = await createContact({
    name,
    emails: String(b.email || "").split(/[,\s]+/).filter((e) => e.includes("@")),
    side: sideForRole(role, normalizeSide(b.side)),
    role,
    company: b.company || null,
    tier: normalizeTier(b.tier, "green"),
    status: "active",
    tier_locked: true,
    last_contact_date: todayIn(tz),
    last_contact_summary: b.last_contact_summary || null,
    remember: b.remember || null,
    source: "Manual",
  });
  let calendar_error: string | undefined;
  try {
    await reconcileNow([c.id]);
  } catch (e: any) {
    calendar_error = e?.message;
  }
  return NextResponse.json({ contact: c, calendar_error });
});
