import { NextResponse } from "next/server";
import { api } from "@/lib/session";
import { deleteContact, updateContact } from "@/lib/contacts";
import { normalizeSide, normalizeTier, sideForRole } from "@/lib/roles";
import { reconcileNow } from "@/lib/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Approve the imported contacts in one go. Each item can adjust tier/role or be removed. */
export const POST = api(async (req: Request) => {
  const { items } = (await req.json()) as { items: { id: string; tier?: string; role?: string; side?: string; remove?: boolean }[] };
  const approved: string[] = [];
  for (const it of items || []) {
    if (it.remove) {
      await deleteContact(null, it.id);
      continue;
    }
    const patch: Record<string, any> = { status: "active", tier_locked: true };
    if (it.tier) patch.tier = normalizeTier(it.tier);
    if (it.role) {
      patch.role = it.role;
      patch.side = sideForRole(it.role, normalizeSide(it.side));
    }
    await updateContact(it.id, patch);
    approved.push(it.id);
  }
  let calendar: any = null;
  try {
    calendar = await reconcileNow(approved);
  } catch (e: any) {
    calendar = { error: e?.message };
  }
  return NextResponse.json({ approved: approved.length, calendar });
});
