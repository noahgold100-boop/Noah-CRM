import { env } from "./env";
import { acquireLock, getSetting, q, releaseLock, setSetting } from "./db";
import { authedClient, markGoogleBroken, type GAuth, type GoogleSetting } from "./google";
import { BASE_QUERY, getThread, getThreadHead, gmailClient, lastDateFor, listThreadIds, threadToText, worthClassifying, type SimpleThread } from "./gmail";
import { classifyThread, type ExtractedPerson } from "./claude";
import { createContact, findByEmail, findByEmails, findByName, reconcile, updateContact, type Contact } from "./contacts";
import { doNotTrackList, getProfile, profileText } from "./profile";
import { getTimezone } from "./calendar";
import { todayIn } from "./dates";
import { calendlyStatus, newBookings } from "./calendly";
import { hitListIndex, markHitInterest, type HitIndex } from "./hitlist";

type Mode = "backfill" | "daily";

export type BackfillState = {
  status: "idle" | "running" | "done";
  query?: string;
  pageToken?: string | null;
  scanned: number;
  found: number;
  started_at?: string;
  finished_at?: string;
};

type Ctx = {
  auth: GAuth;
  mode: Mode;
  tz: string;
  ownerEmails: string[];
  profile: string;
  skip: string[];
  hits: HitIndex;
  touched: Set<string>;
};

async function makeCtx(auth: GAuth, mode: Mode): Promise<Ctx> {
  const g = await getSetting<GoogleSetting>("google");
  const p = await getProfile();
  return {
    auth,
    mode,
    tz: await getTimezone(auth),
    ownerEmails: Array.from(new Set([env.ownerEmail, g?.email || ""].filter(Boolean).map((e) => e.toLowerCase()))),
    profile: profileText(p),
    skip: doNotTrackList(p),
    hits: await hitListIndex(),
    touched: new Set(),
  };
}

function dateIn(tz: string, d: Date) {
  return todayIn(tz, d);
}

async function markProcessed(threadId: string, lastMessageId: string) {
  await q(
    `insert into processed_threads (thread_id, last_message_id, processed_at) values ($1,$2,now())
     on conflict (thread_id) do update set last_message_id = excluded.last_message_id, processed_at = now()`,
    [threadId, lastMessageId],
  );
}

async function alreadyProcessed(threadId: string, lastMessageId: string) {
  const r = await q(`select 1 from processed_threads where thread_id = $1 and last_message_id = $2`, [threadId, lastMessageId]);
  return r.length > 0;
}

/** Apply one person from a classified thread to the CRM. */
async function applyPerson(ctx: Ctx, t: SimpleThread, p: ExtractedPerson) {
  if (ctx.skip.some((s) => s === p.email || s === p.name.toLowerCase() || p.email.endsWith("@" + s))) return;
  const last = lastDateFor(t, p.email) || t.messages[t.messages.length - 1].date;
  const lastDate = dateIn(ctx.tz, last);
  const hit = ctx.hits.match(p.name, p.email);
  const interested = !!hit && p.interest;

  let c: Contact | null = (await findByEmail(p.email)) || (await findByName(p.name, p.company));
  if (c) {
    const newer = !c.last_contact_date || lastDate >= c.last_contact_date;
    const patch: Partial<Contact> = {};
    if (!c.emails.includes(p.email)) patch.emails = [...c.emails, p.email];
    if (newer) {
      patch.last_contact_date = lastDate;
      if (p.summary) patch.last_contact_summary = p.summary;
      patch.gmail_thread_id = t.id;
    }
    if (p.remember && (newer || !c.remember)) patch.remember = p.remember;
    if (!c.company && p.company) patch.company = p.company;
    if (!c.tier_locked) {
      if (c.role === "Other" && p.role !== "Other") {
        patch.role = p.role;
        patch.side = p.side;
      }
      if (newer) patch.tier = p.suggested_tier;
    }
    if (interested) {
      patch.tier = "green";
      patch.tier_locked = true;
      patch.hit_list_id = hit!.id;
    }
    if (Object.keys(patch).length) c = await updateContact(c.id, patch);
  } else {
    c = await createContact({
      name: p.name,
      emails: [p.email],
      side: p.side,
      role: p.role,
      company: p.company || null,
      tier: interested ? "green" : p.suggested_tier,
      status: ctx.mode === "backfill" ? "pending" : "new",
      tier_locked: interested,
      last_contact_date: lastDate,
      last_contact_summary: p.summary,
      remember: p.remember,
      gmail_thread_id: t.id,
      source: hit ? "Hit List" : "Gmail",
      hit_list_id: hit?.id || null,
    });
  }
  if (c) {
    ctx.touched.add(c.id);
    if (hit) await markHitInterest(hit.id, c.id, interested);
  }
}

async function classifyOne(ctx: Ctx, t: SimpleThread) {
  const emails = new Set<string>();
  for (const m of t.messages) for (const a of [m.from, ...m.to, ...m.cc]) if (!ctx.ownerEmails.includes(a.email)) emails.add(a.email);
  const known = (await findByEmails([...emails])).map((c) => ({
    email: c.emails.find((e) => emails.has(e)) || c.emails[0],
    name: c.name,
    role: c.role,
    company: c.company,
    tier: c.tier,
    remember: c.remember,
  }));
  return classifyThread({
    threadText: threadToText(t),
    ownerName: env.ownerName,
    ownerEmails: ctx.ownerEmails,
    profile: ctx.profile,
    known,
    hitListNames: ctx.hits.names.slice(0, 80),
  });
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

/** Process one page of thread ids. Classification runs in parallel; writes run in order (no duplicate contacts). */
async function processIds(ctx: Ctx, ids: string[]): Promise<{ scanned: number; found: number }> {
  const gmail = gmailClient(ctx.auth);
  const heads = await pool(ids, 8, async (id) => ({ id, last: await getThreadHead(gmail, id) }));
  const todo = [];
  for (const h of heads) if (h.last && !(await alreadyProcessed(h.id, h.last))) todo.push(h.id);

  const threads = await pool(todo, 8, (id) => getThread(gmail, id));
  const candidates = threads.filter((t) => t.messages.length && worthClassifying(t, ctx.ownerEmails, ctx.skip));
  const skipped = threads.filter((t) => !candidates.includes(t));
  for (const t of skipped) await markProcessed(t.id, t.lastMessageId);

  const results = await pool(candidates, 4, async (t) => {
    try {
      return { t, r: await classifyOne(ctx, t) };
    } catch (e) {
      console.error("classify failed", t.id, e);
      return { t, r: null }; // left unprocessed, retried next run
    }
  });

  let found = 0;
  for (const { t, r } of results) {
    if (!r) continue;
    if (r.is_business) for (const p of r.people) {
      await applyPerson(ctx, t, p);
      found++;
    }
    await markProcessed(t.id, t.lastMessageId);
  }
  return { scanned: ids.length, found };
}

async function applyBookings(ctx: Ctx, sinceIso: string) {
  const bookings = await newBookings(sinceIso).catch((e) => {
    console.error("calendly", e);
    return null;
  });
  for (const b of bookings || []) {
    if (ctx.ownerEmails.includes(b.email)) continue;
    const date = dateIn(ctx.tz, new Date(b.booked));
    const when = dateIn(ctx.tz, new Date(b.start));
    const summary = `Booked "${b.eventName}" through Calendly for ${when}.`;
    const c = await findByEmail(b.email);
    if (c) {
      if (!c.last_contact_date || date >= c.last_contact_date) {
        await updateContact(c.id, { last_contact_date: date, last_contact_summary: summary });
        ctx.touched.add(c.id);
      }
    } else {
      const n = await createContact({
        name: b.name,
        emails: [b.email],
        side: "Creative",
        role: "Other",
        tier: "yellow",
        status: ctx.mode === "backfill" ? "pending" : "new",
        tier_locked: false,
        last_contact_date: date,
        last_contact_summary: summary,
        source: "Calendly",
      });
      ctx.touched.add(n.id);
    }
  }
}

function queryFor(afterEpochSec: number, calendlyConnected: boolean) {
  return `${BASE_QUERY}${calendlyConnected ? " -from:calendly.com" : ""} after:${afterEpochSec}`;
}

async function withAuth<T>(fn: (auth: GAuth) => Promise<T>): Promise<T> {
  const auth = await authedClient();
  try {
    return await fn(auth);
  } catch (e) {
    if (await markGoogleBroken(e)) {
      const err: any = new Error("Google access expired. Open Settings and reconnect Google.");
      err.status = 409;
      throw err;
    }
    throw e;
  }
}

/** One step of the 12-month import. Call repeatedly until status is "done". */
export async function backfillStep(budgetMs = 45_000): Promise<BackfillState> {
  return withAuth(async (auth) => {
    if (!(await acquireLock("sync", Math.ceil(budgetMs / 1000) + 120))) {
      return (await getSetting<BackfillState>("backfill")) || { status: "running", scanned: 0, found: 0 };
    }
    try {
      const deadline = Date.now() + budgetMs;
      let s = (await getSetting<BackfillState>("backfill")) || { status: "idle", scanned: 0, found: 0 };
      if (s.status !== "running") {
        const cal = await calendlyStatus();
        s = {
          status: "running",
          query: queryFor(Math.floor((Date.now() - 365 * 864e5) / 1000), cal.connected),
          pageToken: null,
          scanned: 0,
          found: 0,
          started_at: new Date().toISOString(),
        };
        const ctx0 = await makeCtx(auth, "backfill");
        await applyBookings(ctx0, new Date(Date.now() - 365 * 864e5).toISOString());
        await setSetting("backfill", s);
      }
      const ctx = await makeCtx(auth, "backfill");
      const gmail = gmailClient(auth);
      while (Date.now() < deadline - 15_000) {
        const page = await listThreadIds(gmail, s.query!, s.pageToken || undefined);
        const r = await processIds(ctx, page.ids);
        s.scanned += r.scanned;
        s.found += r.found;
        s.pageToken = page.nextPageToken;
        if (!page.nextPageToken) {
          s.status = "done";
          s.finished_at = new Date().toISOString();
          await setSetting("last_sync_at", s.started_at);
          break;
        }
        await setSetting("backfill", s);
      }
      await setSetting("backfill", s);
      return s;
    } finally {
      await releaseLock("sync");
    }
  });
}

/** Incremental sync since the last run. Safe to call any time; resumes if a previous run ran out of time. */
export async function dailySync(budgetMs = 200_000) {
  return withAuth(async (auth) => {
    if (!(await acquireLock("sync", Math.ceil(budgetMs / 1000) + 120))) return { skipped: "A sync is already running." };
    try {
      const deadline = Date.now() + budgetMs;
      const ctx = await makeCtx(auth, "daily");
      const cal = await calendlyStatus();
      type Cursor = { query: string; pageToken: string | null; started: string };
      let cursor = await getSetting<Cursor>("sync_cursor");
      if (!cursor) {
        const last = (await getSetting<string>("last_sync_at")) || new Date(Date.now() - 2 * 864e5).toISOString();
        const after = Math.floor((Date.parse(last) - 864e5) / 1000); // 1-day overlap; processed threads are skipped
        cursor = { query: queryFor(after, cal.connected), pageToken: null, started: new Date().toISOString() };
        await applyBookings(ctx, last);
      }
      let scanned = 0;
      let found = 0;
      let done = false;
      const gmail = gmailClient(auth);
      while (Date.now() < deadline - 20_000) {
        const page = await listThreadIds(gmail, cursor.query, cursor.pageToken || undefined);
        const r = await processIds(ctx, page.ids);
        scanned += r.scanned;
        found += r.found;
        cursor.pageToken = page.nextPageToken;
        if (!page.nextPageToken) {
          done = true;
          break;
        }
        await setSetting("sync_cursor", cursor);
      }
      if (done) {
        await setSetting("last_sync_at", cursor.started);
        await q(`delete from settings where key = 'sync_cursor'`);
      } else await setSetting("sync_cursor", cursor);

      // Continue an unfinished 12-month import in the background, too.
      const bf = await getSetting<BackfillState>("backfill");
      const cal2 = await reconcile(auth);
      await setSetting("last_run", { at: new Date().toISOString(), scanned, found, done, calendar: cal2.updated, errors: cal2.errors.slice(0, 5) });
      return { scanned, found, done, calendar: cal2, backfill_running: bf?.status === "running" };
    } finally {
      await releaseLock("sync");
    }
  });
}

export async function reconcileNow(ids?: string[]) {
  return withAuth((auth) => reconcile(auth, ids));
}
