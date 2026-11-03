import { NextResponse } from "next/server";
import { api } from "@/lib/session";
import { getSetting } from "@/lib/db";
import { listContacts } from "@/lib/contacts";
import { listHits } from "@/lib/hitlist";
import { googleStatus } from "@/lib/google";
import { calendlyStatus } from "@/lib/calendly";
import { getProfile, profileFilled } from "@/lib/profile";

export const dynamic = "force-dynamic";

export const GET = api(async () => {
  const [contacts, hits, google, calendly, profile, backfill, build, lastRun, tz] = await Promise.all([
    listContacts(),
    listHits(),
    googleStatus(),
    calendlyStatus(),
    getProfile(),
    getSetting("backfill"),
    getSetting("hitlist_build"),
    getSetting("last_run"),
    getSetting<string>("timezone"),
  ]);
  return NextResponse.json({
    contacts,
    hits,
    status: { google, calendly, profile, profile_filled: profileFilled(profile), backfill, build, last_run: lastRun, timezone: tz || "America/Chicago" },
  });
});
