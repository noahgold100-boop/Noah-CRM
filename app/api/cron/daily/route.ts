import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getSetting } from "@/lib/db";
import { backfillStep, dailySync, type BackfillState } from "@/lib/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Runs every morning (vercel.json). Reads new email, updates contacts, moves reminders. */
export async function GET(req: Request) {
  if (!env.cronSecret || req.headers.get("authorization") !== `Bearer ${env.cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  try {
    const sync = await dailySync(200_000);
    let backfill: BackfillState | null = null;
    const bf = await getSetting<BackfillState>("backfill");
    const left = 270_000 - (Date.now() - started);
    if (bf?.status === "running" && left > 40_000) backfill = await backfillStep(left - 20_000);
    return NextResponse.json({ sync, backfill });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
