import { q, getSetting, setSetting } from "./db";
import { extractJson, researchWithWebSearch } from "./claude";
import { getProfile, profileText } from "./profile";
import { createContact } from "./contacts";
import type { HitPriority, Side } from "./roles";

export type HitEntry = {
  id: string;
  name: string;
  role: string | null;
  company: string | null;
  category: string | null;
  why: string | null;
  typical_scale: string | null;
  notable_work: string[];
  path_in: string | null;
  reach_out_when: string | null;
  priority: HitPriority;
  sources: { title: string; url: string }[];
  contact_id: string | null;
  verified_at: string;
};

export const CATEGORIES = [
  {
    id: "producers",
    label: "Producers & production companies",
    ask: "independent producers and production companies whose slate matches his genres and budget range and who have worked with emerging writer-directors",
    side: "Creative" as Side,
    role: "Producer",
  },
  {
    id: "execs",
    label: "Development & studio executives",
    ask: "development and creative executives at studios, streamers, mini-majors and financier-producers who acquire or develop scripts like his (spec sales, packaged projects)",
    side: "Business" as Side,
    role: "Development Executive",
  },
  {
    id: "reps",
    label: "Managers & agents",
    ask: "literary managers and agents known for signing and selling emerging writer-directors in his genres",
    side: "Business" as Side,
    role: "Manager",
  },
  {
    id: "money",
    label: "Financiers & film funds",
    ask: "financiers, equity film funds and grant-makers that back first and second features at his budget level",
    side: "Business" as Side,
    role: "Financier / Investor",
  },
  {
    id: "champions",
    label: "Festival, lab & fellowship champions",
    ask: "festival programmers and lab/fellowship leads (for example Sundance Institute, Film Independent, The Black List, SXSW, Tribeca, Austin Film Festival) who champion emerging work like his; weight his region",
    side: "Business" as Side,
    role: "Festival Programmer / Director",
  },
] as const;

const COLS = `id, name, role, company, category, why, typical_scale, notable_work, path_in, reach_out_when, priority, sources, contact_id, verified_at`;

export async function listHits(): Promise<HitEntry[]> {
  return q<HitEntry>(
    `select ${COLS} from hit_list order by case priority when 'very_important' then 0 when 'warm' then 1 else 2 end, category, name`,
  );
}

function norm(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

export type HitIndex = { names: string[]; match: (name: string, email: string) => { id: string } | null };

export async function hitListIndex(): Promise<HitIndex> {
  const rows = await q<{ id: string; name: string; company: string | null }>(`select id, name, company from hit_list`);
  const byName = new Map(rows.map((r) => [norm(r.name), r.id]));
  return {
    names: rows.map((r) => (r.company ? `${r.name} (${r.company})` : r.name)),
    match: (name) => {
      const id = byName.get(norm(name));
      return id ? { id } : null;
    },
  };
}

export async function markHitInterest(id: string, contactId: string, interested: boolean) {
  await q(
    `update hit_list set contact_id = $2, priority = case when $3 then 'very_important' else priority end where id = $1`,
    [id, contactId, interested],
  );
}

// ---------- research ----------

const SYSTEM = `You are a film and TV industry researcher building a private outreach "hit list" for an emerging filmmaker.
These are long-shot targets he will contact once he has more credibility, so pick people who could realistically buy, produce, finance, represent or champion his scripts.

Accuracy rules — follow all of them:
- Use web search to verify each person's CURRENT role and company. Drop anyone you cannot verify from a reputable source in the last ~18 months.
- Prefer Deadline, Variety, The Hollywood Reporter, IndieWire, Screen Daily, The Black List, Box Office Mojo/The Numbers, company and festival websites.
- "typical_scale" must describe the budget range and deal sizes they usually work at plus traction of their work (box office, streaming sale, festival wins, reported sale prices). Give ranges and only state numbers a source supports.
- Never guess or include email addresses or phone numbers.
- "why" is one plain sentence on why they fit HIM specifically (genre, budget, region, school, mutual contact, track record with first-timers).
- "path_in" is the most realistic route: a mutual contact from his CRM if one plausibly exists, their representation, a festival or lab, a fellowship. Set "warm": true only when the path is through a person already in his CRM.
- "reach_out_when" names the milestone that would make outreach credible (e.g. "after a top-tier festival selection", "once a script places on the Black List").
- Write plainly. No hype.

Finish with ONLY the JSON payload wrapped in <json></json>.`;

function format(n: number) {
  return `<json>{"people":[{"name":"","role":"","company":"","why":"","typical_scale":"","notable_work":["",""],"path_in":"","reach_out_when":"","warm":false,"sources":[{"title":"","url":""}]}]}</json>
Return ${n} people.`;
}

async function crmContext() {
  const rows = await q<{ name: string; role: string; company: string | null }>(
    `select name, role, company from contacts where status <> 'pending' and tier <> 'red' order by tier, last_contact_date desc nulls last limit 60`,
  );
  return rows.length ? rows.map((r) => `- ${r.name}, ${r.role}${r.company ? `, ${r.company}` : ""}`).join("\n") : "(none yet)";
}

function clean(v: unknown, max = 400) {
  return String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max) || null;
}

async function insertPeople(people: any[], category: string): Promise<number> {
  const existing = new Set((await q<{ name: string }>(`select name from hit_list`)).map((r) => norm(r.name)));
  let added = 0;
  for (const p of people) {
    const name = clean(p?.name, 120);
    if (!name || existing.has(norm(name))) continue;
    const sources = (Array.isArray(p.sources) ? p.sources : [])
      .filter((s: any) => typeof s?.url === "string" && /^https?:\/\//.test(s.url))
      .slice(0, 4)
      .map((s: any) => ({ title: clean(s.title, 160) || s.url, url: s.url }));
    if (!sources.length) continue; // every entry must be sourced
    await q(
      `insert into hit_list (name, role, company, category, why, typical_scale, notable_work, path_in, reach_out_when, priority, sources)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
      [
        name,
        clean(p.role, 120),
        clean(p.company, 120),
        category,
        clean(p.why),
        clean(p.typical_scale),
        (Array.isArray(p.notable_work) ? p.notable_work : []).map((x: any) => clean(x, 100)).filter(Boolean).slice(0, 3),
        clean(p.path_in),
        clean(p.reach_out_when, 200),
        p.warm ? "warm" : "long_shot",
        JSON.stringify(sources),
      ],
    );
    existing.add(norm(name));
    added++;
  }
  return added;
}

async function researchCategory(catIndex: number, count: number): Promise<number> {
  const cat = CATEGORIES[catIndex];
  const profile = await getProfile();
  const existing = (await q<{ name: string }>(`select name from hit_list`)).map((r) => r.name);
  const prompt = `Filmmaker profile:
${profileText(profile)}
${profile.dream_names ? `\nDream names he already has in mind (include any that fit this category, after verifying them): ${profile.dream_names}` : ""}
${profile.do_not_contact ? `\nNever include: ${profile.do_not_contact}` : ""}

People already in his CRM (use for second-degree paths in):
${await crmContext()}

Already on the hit list (do not repeat): ${existing.length ? existing.join(", ") : "(none)"}

Find ${count} ${cat.ask}.
Rank by strength of connection to him: (1) frequent collaborators of people in his CRM, (2) shared school, hometown or region, (3) track record with his genres, formats and budget range, (4) championed films from festivals or labs he is in or targeting, (5) history of buying or producing work from emerging writers and directors.

${format(count)}`;
  const text = await researchWithWebSearch(SYSTEM, prompt, 10);
  const data = extractJson<{ people: any[] }>(text);
  if (!data?.people) throw new Error("Research came back in an unexpected format. Try again.");
  return insertPeople(data.people, cat.id);
}

export type BuildState = { status: "idle" | "running" | "done"; step: number; total: number; added: number; last_built?: string; error?: string };

/** Builds the list one category per call (keeps each request short). */
export async function buildStep(): Promise<BuildState> {
  let s = (await getSetting<BuildState>("hitlist_build")) || { status: "idle", step: 0, total: CATEGORIES.length, added: 0 };
  if (s.status !== "running") s = { status: "running", step: 0, total: CATEGORIES.length, added: 0 };
  try {
    s.added += await researchCategory(s.step, 7);
    s.step += 1;
    delete s.error;
    if (s.step >= CATEGORIES.length) {
      s.status = "done";
      s.last_built = new Date().toISOString();
    }
  } catch (e: any) {
    s.error = e?.message || String(e);
  }
  await setSetting("hitlist_build", s);
  return s;
}

/** Monthly: re-verify the oldest entries. Never removes Very important or linked people. */
export async function verifyOldest(n = 10) {
  const rows = await q<HitEntry>(
    `select ${COLS} from hit_list where priority <> 'very_important' and contact_id is null order by verified_at asc limit $1`,
    [n],
  );
  if (!rows.length) return { checked: 0, removed: 0, updated: 0 };
  const prompt = `Verify whether each person still holds this role and company and is still relevant for an emerging filmmaker's outreach list. Use web search.
${rows.map((r) => `- id=${r.id} | ${r.name} | ${r.role || ""} | ${r.company || ""}`).join("\n")}

Return <json>{"results":[{"id":"","status":"keep|update|remove","role":"","company":"","source":{"title":"","url":""}}]}</json>
Use "remove" only if they left the industry, died, or moved somewhere irrelevant. Use "update" if their role or company changed.`;
  const text = await researchWithWebSearch(SYSTEM.replace(/Finish with[\s\S]*$/, "Finish with ONLY the JSON payload wrapped in <json></json>."), prompt, 12);
  const data = extractJson<{ results: any[] }>(text);
  let removed = 0;
  let updated = 0;
  const ids = new Set(rows.map((r) => r.id));
  for (const r of data?.results || []) {
    if (!ids.has(r.id)) continue;
    if (r.status === "remove") {
      await q(`delete from hit_list where id = $1 and priority <> 'very_important' and contact_id is null`, [r.id]);
      removed++;
    } else if (r.status === "update") {
      await q(`update hit_list set role = coalesce($2, role), company = coalesce($3, company), verified_at = now() where id = $1`, [r.id, clean(r.role, 120), clean(r.company, 120)]);
      updated++;
    } else {
      await q(`update hit_list set verified_at = now() where id = $1`, [r.id]);
    }
  }
  await setSetting("hitlist_verified_at", new Date().toISOString());
  return { checked: rows.length, removed, updated };
}

/** Monthly: add up to 5 new names, rotating through categories. */
export async function addNew(n = 5) {
  const idx = new Date().getUTCMonth() % CATEGORIES.length;
  const added = await researchCategory(idx, n);
  return { added };
}

/** Marking someone Very important puts them in the CRM as Green so they get a 3-week reminder. */
export async function setPriority(id: string, priority: HitPriority) {
  const rows = await q<HitEntry>(`update hit_list set priority = $2 where id = $1 returning ${COLS}`, [id, priority]);
  const h = rows[0];
  if (!h) return null;
  if (priority === "very_important" && !h.contact_id) {
    const cat = CATEGORIES.find((c) => c.id === h.category) || CATEGORIES[0];
    const role = cat.id === "reps" && /agent/i.test(h.role || "") ? "Literary Agent" : cat.role;
    const c = await createContact({
      name: h.name,
      emails: [],
      side: cat.side,
      role,
      company: h.company,
      tier: "green",
      status: "active",
      tier_locked: true,
      last_contact_date: new Date().toISOString().slice(0, 10),
      last_contact_summary: "Marked very important from the hit list.",
      remember: h.why,
      source: "Hit List",
      hit_list_id: h.id,
    });
    await q(`update hit_list set contact_id = $2 where id = $1`, [id, c.id]);
    return { ...h, contact_id: c.id, created_contact: c.id };
  }
  return h;
}

export async function deleteHit(id: string) {
  await q(`delete from hit_list where id = $1`, [id]);
}
