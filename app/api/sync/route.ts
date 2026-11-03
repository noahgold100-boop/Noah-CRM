import { NextResponse } from "next/server";
import { api } from "@/lib/session";
import { backfillStep, dailySync } from "@/lib/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = api(async (req: Request) => {
  const { mode } = await req.json().catch(() => ({ mode: "daily" }));
  if (mode === "backfill") return NextResponse.json(await backfillStep(45_000));
  return NextResponse.json(await dailySync(120_000));
});
