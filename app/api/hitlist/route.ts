import { NextResponse } from "next/server";
import { api } from "@/lib/session";
import { buildStep, listHits, resetForRebuild } from "@/lib/hitlist";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** POST {} runs one build step. POST {"rebuild": true} clears the list so the next steps start fresh. */
export const POST = api(async (req: Request) => {
  const body = await req.json().catch(() => ({}));
  const state = body?.rebuild ? await resetForRebuild() : await buildStep();
  return NextResponse.json({ state, hits: await listHits() });
});
