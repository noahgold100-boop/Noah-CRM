import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getSetting } from "@/lib/db";
import { addNew, verifyOldest } from "@/lib/hitlist";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Day 1 of each month: re-verify the oldest entries. Day 2: add up to 5 new names. */
export async function GET(req: Request) {
  if (!env.cronSecret || req.headers.get("authorization") !== `Bearer ${env.cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const built = await getSetting<{ status: string }>("hitlist_build");
  if (built?.status !== "done") return NextResponse.json({ skipped: "Hit list not built yet" });
  try {
    const day = new Date().getUTCDate();
    return NextResponse.json(day === 1 ? await verifyOldest(10) : await addNew(5));
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
