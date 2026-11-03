"use client";
// Public preview with made-up sample data. Reads and saves nothing; no account or email access.
import { useEffect, useState } from "react";
import App from "@/components/App";
import { addDays, todayIn } from "@/lib/dates";

export default function Demo() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t = todayIn("America/Chicago");
    let n = 0;
    const c = (o: any) => ({
      id: `demo-${++n}`,
      emails: [],
      phone: null,
      status: "active",
      tier_locked: true,
      calendar_event_id: "demo",
      calendar_dirty: false,
      gmail_thread_id: null,
      source: "Gmail",
      hit_list_id: null,
      updated_at: "",
      company: null,
      remember: null,
      ...o,
    });
    let contacts = [
      c({ name: "Maya Reyes", side: "Creative", role: "Producer", company: "Northlight Pictures", tier: "green", last_contact_date: addDays(t, -19), next_followup_date: addDays(t, 2), last_contact_summary: "Read Morpho over the weekend and asked for the budget top sheet before pitching it to her partners.", remember: "Met at Austin Film Festival; prefers a call over long emails." }),
      c({ name: "Daniel Okafor", side: "Creative", role: "Cinematographer / DP", tier: "green", status: "new", last_contact_date: addDays(t, -3), next_followup_date: addDays(t, 18), last_contact_summary: "Shared his reel and said he's free in March for a short.", remember: "Owns his own camera package." }),
      c({ name: "Lena Park", side: "Creative", role: "Writer", tier: "yellow", last_contact_date: addDays(t, -40), next_followup_date: addDays(t, 21), last_contact_summary: "Open to co-writing a series pilot once her fellowship ends.", remember: "Current fellowship runs through spring." }),
      c({ name: "Jordan Hale", side: "Creative", role: "Actor", tier: "yellow", last_contact_date: addDays(t, -25), next_followup_date: addDays(t, 35), last_contact_summary: "Liked the Rain Fugue sides; waiting to hear on dates.", remember: "Represented by a boutique talent agency in LA." }),
      c({ name: "Chris Vale", side: "Creative", role: "Composer", tier: "red", last_contact_date: addDays(t, -60), next_followup_date: null, last_contact_summary: "Quoted rates well above the budget for Rain Fugue." }),
      c({ name: "Rachel Stein", side: "Business", role: "Manager", company: "Grandview Management", tier: "green", last_contact_date: addDays(t, -16), next_followup_date: addDays(t, 5), last_contact_summary: "Wants to read the next draft of Morpho before deciding on representation.", remember: "Referred by Maya Reyes." }),
      c({ name: "Tom Albright", side: "Business", role: "Entertainment Attorney", company: "Albright Law", tier: "yellow", last_contact_date: addDays(t, -30), next_followup_date: addDays(t, 30), last_contact_summary: "Sent a quote for reviewing the Little Manly distribution agreement." }),
      c({ name: "Priya Shah", side: "Business", role: "Festival Programmer / Director", company: "Regional film festival", tier: "green", last_contact_date: addDays(t, -9), next_followup_date: addDays(t, 12), last_contact_summary: "Encouraged him to submit Morpho before the late deadline.", remember: "Programs the shorts block." }),
    ];
    const hits = [
      { id: "h1", name: "Sample Producer", role: "Founder", company: "Sample Films", category: "producers", why: "Has produced several first features in his genres under $5M.", typical_scale: "$1–8M independent features; festival premieres and mid-six-figure streamer sales.", notable_work: ["Sample Title One", "Sample Title Two"], path_in: "Through Maya Reyes, who has worked with her before.", reach_out_when: "After a top-tier festival selection.", priority: "warm", sources: [{ title: "Trade article", url: "https://deadline.com" }], contact_id: null, verified_at: "" },
      { id: "h2", name: "Sample Executive", role: "SVP, Development", company: "Sample Studio", category: "execs", why: "Buys elevated genre scripts from emerging writers.", typical_scale: "$10–40M studio features; spec purchases in the low-to-mid six figures.", notable_work: ["Sample Title Three"], path_in: "Through a manager or the Black List.", reach_out_when: "Once a script places on the Black List.", priority: "long_shot", sources: [{ title: "Trade article", url: "https://variety.com" }], contact_id: null, verified_at: "" },
      { id: "h3", name: "Sample Manager", role: "Literary Manager", company: "Sample Management", category: "reps", why: "Signs writer-directors coming off festival shorts.", typical_scale: "Packages $2–15M features; clients sell to streamers and mini-majors.", notable_work: ["Sample Title Four"], path_in: "Through Rachel Stein's network or a lab.", reach_out_when: "After the next short screens at a major festival.", priority: "long_shot", sources: [{ title: "Trade article", url: "https://www.hollywoodreporter.com" }], contact_id: null, verified_at: "" },
    ];
    const status = {
      google: { connected: true, email: "noahgold100@gmail.com" },
      calendly: { connected: false },
      profile: { company: "Little Cinema Productions", films: "Little Manly, Morpho, Rain Fugue", website: "littlecinemaproductions.com", projects: "Morpho" },
      profile_filled: true,
      backfill: { status: "done", scanned: 1820, found: 64 },
      build: { status: "done", step: 5, total: 5 },
      last_run: { at: new Date().toISOString() },
      timezone: "America/Chicago",
    };
    const json = (d: unknown) => new Response(JSON.stringify(d), { headers: { "Content-Type": "application/json" } });
    window.fetch = (async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (url.includes("/api/state")) return json({ contacts, hits, status });
      const m = url.match(/\/api\/contacts\/([^/]+)$/);
      if (m && init?.method === "PATCH") {
        contacts = contacts.map((x) => (x.id === m[1] ? { ...x, ...body, status: "active", emails: typeof body.emails === "string" ? body.emails.split(/[,\s]+/).filter(Boolean) : x.emails } : x));
        return json({ contact: contacts.find((x) => x.id === m[1]) });
      }
      if (url.endsWith("/api/contacts") && init?.method === "POST") {
        const added = c({ name: body.name, side: body.side, role: body.role, tier: body.tier, emails: body.email ? [body.email] : [], last_contact_date: t, next_followup_date: body.tier === "red" ? null : addDays(t, body.tier === "green" ? 21 : 61), source: "Manual" });
        contacts = [added, ...contacts];
        return json({ contact: added });
      }
      if (url.includes("/api/sync")) return json({ scanned: 0, found: 0, status: "done" });
      return json({ ok: true });
    }) as typeof fetch;
    setReady(true);
  }, []);

  if (!ready) return null;
  return (
    <>
      <div style={{ background: "var(--ink)", color: "var(--bg)", fontSize: 13, textAlign: "center", padding: "6px 16px" }}>
        Preview with made-up sample data. Nothing here is saved.
      </div>
      <App />
    </>
  );
}
