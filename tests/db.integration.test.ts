// Runs the real SQL against a local Postgres. The Neon HTTP driver and Google Calendar are mocked.
// Usage: TEST_PG_URL=postgres://postgres@localhost:54329/postgres node --test --experimental-test-module-mocks --experimental-strip-types tests/db.integration.test.ts
import { test, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

const url = process.env.TEST_PG_URL;
const pool = url ? new pg.Pool({ connectionString: url }) : null;

const calls: string[] = [];
let eventSeq = 0;

if (pool) {
  mock.module("@neondatabase/serverless", {
    namedExports: {
      neon: () => ({ query: async (text: string, params: any[] = []) => (await pool.query(text, params)).rows }),
    },
  });
  mock.module("../lib/calendar.ts", {
    namedExports: {
      getTimezone: async () => "America/Chicago",
      upsertReminder: async (_a: any, c: any, date: string) => {
        calls.push(`upsert ${c.name} ${date}`);
        return c.calendar_event_id || `ev${++eventSeq}`;
      },
      deleteReminder: async (_a: any, id: string) => void calls.push(`delete ${id}`),
    },
  });
}

process.env.DATABASE_URL = "mocked";
process.env.SESSION_SECRET = "x".repeat(40);

const skip = !pool;

before(async () => {
  if (pool) await pool.query("drop table if exists settings, contacts, processed_threads, hit_list");
});
after(async () => pool?.end());

test("schema, contacts, merge lookups and reminders", { skip }, async () => {
  const db = await import("../lib/db.ts");
  const C = await import("../lib/contacts.ts");
  const { todayIn, addDays } = await import("../lib/dates.ts");
  const today = todayIn("America/Chicago");

  await db.setSetting("timezone", "America/Chicago");
  assert.equal(await db.getSetting("timezone"), "America/Chicago");

  const jane = await C.createContact({ name: "Jane Doe", emails: ["Jane@Prod.com"], side: "Creative", role: "Producer", company: "Prod Co", tier: "green", status: "active", tier_locked: true, last_contact_date: today, source: "Manual" });
  assert.deepEqual(jane.emails, ["jane@prod.com"]);
  assert.equal((await C.findByEmail("jane@prod.com"))?.id, jane.id);
  assert.equal((await C.findByEmails(["nobody@x.com", "jane@prod.com"])).length, 1);
  assert.equal((await C.findByName("jane doe", "prod co"))?.id, jane.id);
  assert.equal(await C.findByName("jane doe", "Other Co"), null);

  // role decides side
  const agent = await C.createContact({ name: "Al Agent", emails: ["al@caa.com"], side: "Creative", role: "Literary Agent", tier: "yellow", status: "new", tier_locked: false, last_contact_date: addDays(today, -10), source: "Gmail" });
  assert.equal(agent.side, "Business");

  const pend = await C.createContact({ name: "Pat Pending", emails: ["p@x.com"], side: "Creative", role: "Writer", tier: "green", status: "pending", tier_locked: false, last_contact_date: today, source: "Gmail" });
  const old = await C.createContact({ name: "Old Green", emails: ["o@x.com"], side: "Creative", role: "Director", tier: "green", status: "active", tier_locked: true, last_contact_date: addDays(today, -200), source: "Gmail" });

  const auth: any = {};
  const r1 = await C.reconcile(auth);
  assert.deepEqual(r1.errors, []);
  const j = (await C.getContact(jane.id))!;
  const expected = addDays(today, 21);
  assert.equal(j.calendar_dirty, false);
  assert.ok(j.next_followup_date! >= expected, "green follow-up ≥ 21 days");
  assert.ok(j.calendar_event_id);
  const a = (await C.getContact(agent.id))!;
  assert.ok(a.next_followup_date && a.next_followup_date > today, "yellow gets a date");
  assert.equal((await C.getContact(pend.id))!.calendar_event_id, null, "pending gets no reminder");
  const o = (await C.getContact(old.id))!;
  assert.ok(o.next_followup_date! > today && o.next_followup_date! <= addDays(today, 4), "overdue is slotted into the next few weekdays");

  // switching to red removes the reminder
  calls.length = 0;
  await C.updateContact(jane.id, { tier: "red" });
  await C.reconcile(auth, [jane.id]);
  const jr = (await C.getContact(jane.id))!;
  assert.equal(jr.next_followup_date, null);
  assert.equal(jr.calendar_event_id, null);
  assert.ok(calls.some((c) => c.startsWith("delete")));

  // re-running reconcile on an already-slotted overdue contact keeps its date
  const before = (await C.getContact(old.id))!.next_followup_date;
  await C.updateContact(old.id, { remember: "Likes thrillers" });
  await C.reconcile(auth, [old.id]);
  assert.equal((await C.getContact(old.id))!.next_followup_date, before);

  await C.deleteContact(null, pend.id);
  assert.equal(await C.getContact(pend.id), null);
});

test("locks, hit list priority and interest", { skip }, async () => {
  const db = await import("../lib/db.ts");
  assert.equal(await db.acquireLock("sync", 60), true);
  assert.equal(await db.acquireLock("sync", 60), false, "second holder is refused");
  await db.releaseLock("sync");
  assert.equal(await db.acquireLock("sync", 60), true);
  await db.releaseLock("sync");

  const H = await import("../lib/hitlist.ts");
  await db.q(`insert into hit_list (name, role, company, category, why, sources) values ('Big Shot', 'President', 'Studio X', 'execs', 'Fits', '[{"title":"t","url":"https://x.com"}]')`);
  const [h] = await H.listHits();
  assert.equal(h.priority, "long_shot");
  assert.deepEqual(h.notable_work, []);
  const idx = await H.hitListIndex();
  assert.equal(idx.match("big shot", "")?.id, h.id);
  assert.equal(idx.match("Small Shot", ""), null);

  const res: any = await H.setPriority(h.id, "very_important");
  assert.ok(res.created_contact, "very important creates a green contact");
  const C = await import("../lib/contacts.ts");
  const c = (await C.getContact(res.created_contact))!;
  assert.equal(c.tier, "green");
  assert.equal(c.side, "Business");
  assert.equal(c.role, "Development Executive");
  const again: any = await H.setPriority(h.id, "very_important");
  assert.equal(again.created_contact, undefined, "no duplicate contact");

  await H.markHitInterest(h.id, c.id, false);
  assert.equal((await H.listHits())[0].priority, "very_important");
});

test("profile save and defaults", { skip }, async () => {
  const P = await import("../lib/profile.ts");
  const p = await P.getProfile();
  assert.equal(p.company, "Little Cinema Productions");
  const s = await P.saveProfile({ projects: "Morpho — feature, drama", do_not_contact: "mom@family.com, Uncle Bob" } as any);
  assert.equal(s.projects, "Morpho — feature, drama");
  assert.deepEqual(P.doNotTrackList(s), ["mom@family.com", "uncle bob"]);
  assert.equal(P.profileFilled(s), true);
});
