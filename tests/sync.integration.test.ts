// End-to-end sync against local Postgres with Gmail, Claude, Calendar and Calendly mocked.
import { test, mock, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

const url = process.env.TEST_PG_URL;
const pool = url ? new pg.Pool({ connectionString: url }) : null;
const skip = !pool;
const owner = "noahgold100@gmail.com";

const realGmail: any = pool ? await import("../lib/gmail.ts?real") : {};

const day = (iso: string) => new Date(iso + "T17:00:00Z");
const m = (id: string, date: string, from: string, to: string[], body: string, automated = false) => ({
  id, date: day(date), from: { name: from.split("@")[0], email: from }, to: to.map((e) => ({ name: "", email: e })), cc: [], subject: "Re: Morpho", body, automated,
});
const THREADS: Record<string, any> = {
  t1: { id: "t1", lastMessageId: "a2", subject: "Morpho", messages: [m("a1", "2026-10-20", owner, ["jane@prod.com"], "Here's Morpho."), m("a2", "2026-10-28", "jane@prod.com", [owner], "Loved it, let's meet Thursday.")] },
  t2: { id: "t2", lastMessageId: "b1", subject: "Sale", messages: [m("b1", "2026-10-29", "deals@shop.com", [owner], "50% off", true)] },
  t3: { id: "t3", lastMessageId: "c1", subject: "Dinner", messages: [m("c1", "2026-10-29", "mom@family.com", [owner], "Dinner Sunday?")] },
  t4: { id: "t4", lastMessageId: "d1", subject: "Intro", messages: [m("d1", "2026-10-30", "big@studiox.com", [owner], "Would love to read your next script.")] },
};
let pageCalls = 0;
const classified: string[] = [];

if (pool) {
  mock.module("@neondatabase/serverless", { namedExports: { neon: () => ({ query: async (t: string, p: any[] = []) => (await pool.query(t, p)).rows }) } });
  mock.module("../lib/google.ts", {
    namedExports: { authedClient: async () => ({}), markGoogleBroken: async () => false, SCOPES: [] },
  });
  mock.module("../lib/gmail.ts", {
    namedExports: {
      ...realGmail,
      gmailClient: () => ({}),
      listThreadIds: async (_g: any, q: string) => {
        pageCalls++;
        assert.match(q, /after:\d+/);
        return { ids: Object.keys(THREADS), nextPageToken: null };
      },
      getThreadHead: async (_g: any, id: string) => THREADS[id].lastMessageId,
      getThread: async (_g: any, id: string) => THREADS[id],
    },
  });
  mock.module("../lib/claude.ts", {
    namedExports: {
      classifyThread: async ({ threadText }: any) => {
        classified.push(threadText.match(/Subject: (.*)/)[1]);
        if (threadText.includes("jane@prod.com"))
          return { is_business: true, people: [{ name: "Jane Doe", email: "jane@prod.com", side: "Creative", role: "Producer", company: "Prod Co", summary: "She loved Morpho and wants to meet Thursday.", remember: "Producer at Prod Co.", suggested_tier: "green", interest: true }] };
        if (threadText.includes("big@studiox.com"))
          return { is_business: true, people: [{ name: "Big Shot", email: "big@studiox.com", side: "Business", role: "Studio Executive", company: "Studio X", summary: "Asked to read his next script.", remember: "", suggested_tier: "green", interest: true }] };
        return { is_business: false, people: [] };
      },
      researchWithWebSearch: async () => "",
      extractJson: () => null,
    },
  });
  mock.module("../lib/calendar.ts", {
    namedExports: {
      getTimezone: async () => "America/Chicago",
      upsertReminder: async (_a: any, c: any) => c.calendar_event_id || "ev-" + c.id.slice(0, 6),
      deleteReminder: async () => {},
    },
  });
  mock.module("../lib/calendly.ts", { namedExports: { calendlyStatus: async () => ({ connected: false }), newBookings: async () => null } });
}

process.env.DATABASE_URL = "mocked";
process.env.SESSION_SECRET = "x".repeat(40);
after(async () => pool?.end());

test("backfill imports as pending, filters junk, honors do-not-track and hit-list interest", { skip }, async () => {
  await pool!.query("drop table if exists settings, contacts, processed_threads, hit_list");
  const db = await import("../lib/db.ts");
  const P = await import("../lib/profile.ts");
  await P.saveProfile({ projects: "Morpho", do_not_contact: "family.com" } as any);
  await db.q(`insert into hit_list (name, company, category, sources) values ('Big Shot','Studio X','execs','[]')`);

  const S = await import("../lib/sync.ts");
  const s = await S.backfillStep(30_000);
  assert.equal(s.status, "done");

  // shop mail (bulk) and family (do-not-track) never reach Claude
  assert.deepEqual(classified.sort(), ["Intro", "Morpho"]);

  const rows = (await pool!.query("select name, status, tier, tier_locked, to_char(last_contact_date,'YYYY-MM-DD') d, last_contact_summary, source from contacts order by name")).rows;
  assert.equal(rows.length, 2);
  const jane = rows.find((r) => r.name === "Jane Doe");
  assert.equal(jane.status, "pending");
  assert.equal(jane.d, "2026-10-28", "last contact = her latest message");
  const big = rows.find((r) => r.name === "Big Shot");
  assert.equal(big.tier, "green");
  assert.equal(big.tier_locked, true);
  assert.equal(big.source, "Hit List");
  const hit = (await pool!.query("select priority, contact_id from hit_list")).rows[0];
  assert.equal(hit.priority, "very_important");
  assert.ok(hit.contact_id);

  // running again does not reclassify or duplicate
  classified.length = 0;
  await db.q(`delete from settings where key = 'backfill'`);
  await S.backfillStep(30_000);
  assert.equal(classified.length, 0);
  assert.equal((await pool!.query("select count(*)::int n from contacts")).rows[0].n, 2);
});

test("daily sync: new thread message updates the existing contact and keeps Noah's tier", { skip }, async () => {
  const C = await import("../lib/contacts.ts");
  const jane = (await C.findByEmail("jane@prod.com"))!;
  await C.updateContact(jane.id, { status: "active", tier: "yellow", tier_locked: true }); // Noah chose yellow

  THREADS.t1 = { ...THREADS.t1, lastMessageId: "a3", messages: [...THREADS.t1.messages, { ...THREADS.t1.messages[0], id: "a3", date: day("2026-11-01"), body: "Thursday works." }] };
  classified.length = 0;
  const S = await import("../lib/sync.ts");
  const r: any = await S.dailySync(30_000);
  assert.equal(r.done, true);
  assert.deepEqual(classified, ["Morpho"], "only the changed thread is re-read");

  const j = (await C.getContact(jane.id))!;
  assert.equal(j.last_contact_date, "2026-11-01");
  assert.equal(j.tier, "yellow", "manual tier is never overridden");
  assert.equal(j.next_followup_date, "2027-01-01", "yellow = 2 months after last contact");
  assert.ok(j.calendar_event_id);
  const big = (await pool!.query("select status, to_char(next_followup_date,'YYYY-MM-DD') d from contacts where name='Big Shot'")).rows[0];
  assert.equal(big.status, "pending", "still waiting for review → no reminder yet");
  assert.equal(big.d, null);
});
