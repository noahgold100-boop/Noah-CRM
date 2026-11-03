import { NextResponse } from "next/server";
import { api } from "@/lib/session";
import { buildStep, listHits } from "@/lib/hitlist";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = api(async () => {
  const state = await buildStep();
  return NextResponse.json({ state, hits: await listHits() });
});
