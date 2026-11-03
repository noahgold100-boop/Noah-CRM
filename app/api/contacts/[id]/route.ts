import { NextResponse } from "next/server";
import { api } from "@/lib/session";
import { deleteContact, getContact, updateContact } from "@/lib/contacts";
import { normalizeSide, normalizeTier, sideForRole } from "@/lib/roles";
import { reconcileNow } from "@/lib/sync";
import { authedClient } from "@/lib/google";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const PATCH = api(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const b = await req.json();
  const patch: Record<string, any> = {};
  for (const k of ["name", "phone", "company", "last_contact_summary", "remember"]) {
    if (typeof b[k] === "string") patch[k] = b[k].trim() || (k === "name" ? undefined : null);
  }
  if (patch.name === undefined) delete patch.name;
  if (Array.isArray(b.emails)) patch.emails = b.emails;
  else if (typeof b.emails === "string") patch.emails = b.emails.split(/[,\s]+/).filter((e: string) => e.includes("@"));
  if (typeof b.role === "string") {
    patch.role = b.role;
    patch.side = sideForRole(b.role, normalizeSide(b.side));
  } else if (b.side) patch.side = normalizeSide(b.side);
  if (b.tier) {
    patch.tier = normalizeTier(b.tier);
    patch.tier_locked = true; // Noah's choice always wins over inferred tiers
    const cur = await getContact(id);
    if (cur && cur.status === "new") patch.status = "active";
  }
  if (typeof b.last_contact_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.last_contact_date)) patch.last_contact_date = b.last_contact_date;

  let c = await updateContact(id, patch);
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  let calendar_error: string | undefined;
  if (c.status !== "pending") {
    try {
      await reconcileNow([id]);
      c = (await getContact(id))!;
    } catch (e: any) {
      calendar_error = e?.message; // stays marked dirty; the daily sync retries
    }
  }
  return NextResponse.json({ contact: c, calendar_error });
});

export const DELETE = api(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const auth = await authedClient().catch(() => null);
  await deleteContact(auth, id);
  return NextResponse.json({ ok: true });
});
