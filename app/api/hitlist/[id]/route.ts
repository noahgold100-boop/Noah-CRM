import { NextResponse } from "next/server";
import { api } from "@/lib/session";
import { deleteHit, setPriority } from "@/lib/hitlist";
import { reconcileNow } from "@/lib/sync";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const PATCH = api(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const { priority } = await req.json();
  if (!["very_important", "warm", "long_shot"].includes(priority)) return NextResponse.json({ error: "Bad priority" }, { status: 400 });
  const h: any = await setPriority(id, priority);
  if (!h) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (h.created_contact) await reconcileNow([h.created_contact]).catch(() => {});
  return NextResponse.json({ hit: h });
});

export const DELETE = api(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  await deleteHit(id);
  return NextResponse.json({ ok: true });
});
