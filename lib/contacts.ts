import { q } from "./db";
import type { GAuth } from "./google";
import { deleteReminder, getTimezone, upsertReminder } from "./calendar";
import { ruleDate, scheduleDate, todayIn } from "./dates";
import { normalizeRole, normalizeSide, normalizeTier, sideForRole, type Side, type Status, type Tier } from "./roles";

export type Contact = {
  id: string;
  name: string;
  emails: string[];
  phone: string | null;
  side: Side;
  role: string;
  company: string | null;
  tier: Tier;
  status: Status;
  tier_locked: boolean;
  last_contact_date: string | null;
  last_contact_summary: string | null;
  remember: string | null;
  next_followup_date: string | null;
  calendar_event_id: string | null;
  calendar_dirty: boolean;
  gmail_thread_id: string | null;
  source: string;
  hit_list_id: string | null;
  updated_at: string;
};

const COLS = `id, name, emails, phone, side, role, company, tier, status, tier_locked,
  to_char(last_contact_date, 'YYYY-MM-DD') as last_contact_date, last_contact_summary, remember,
  to_char(next_followup_date, 'YYYY-MM-DD') as next_followup_date, calendar_event_id, calendar_dirty,
  gmail_thread_id, source, hit_list_id, updated_at`;

export async function listContacts(): Promise<Contact[]> {
  return q<Contact>(`select ${COLS} from contacts order by next_followup_date nulls last, name`);
}

export async function getContact(id: string): Promise<Contact | null> {
  return (await q<Contact>(`select ${COLS} from contacts where id = $1`, [id]))[0] || null;
}

export async function findByEmail(email: string): Promise<Contact | null> {
  return (await q<Contact>(`select ${COLS} from contacts where $1 = any(emails) limit 1`, [email.toLowerCase()]))[0] || null;
}

export async function findByEmails(emails: string[]): Promise<Contact[]> {
  if (!emails.length) return [];
  return q<Contact>(`select ${COLS} from contacts where emails && $1::text[]`, [emails.map((e) => e.toLowerCase())]);
}

export async function findByName(name: string, company: string): Promise<Contact | null> {
  const rows = await q<Contact>(
    `select ${COLS} from contacts where lower(name) = lower($1) and (company is null or company = '' or $2 = '' or lower(company) = lower($2)) limit 2`,
    [name, company],
  );
  return rows.length === 1 ? rows[0] : null; // ambiguous → don't merge
}

export type NewContact = {
  name: string;
  emails: string[];
  phone?: string | null;
  side: Side;
  role: string;
  company?: string | null;
  tier: Tier;
  status: Status;
  tier_locked: boolean;
  last_contact_date: string | null;
  last_contact_summary?: string | null;
  remember?: string | null;
  gmail_thread_id?: string | null;
  source: string;
  hit_list_id?: string | null;
};

export async function createContact(c: NewContact): Promise<Contact> {
  const side = sideForRole(c.role, normalizeSide(c.side));
  const rows = await q<Contact>(
    `insert into contacts (name, emails, phone, side, role, company, tier, status, tier_locked, last_contact_date,
       last_contact_summary, remember, gmail_thread_id, source, hit_list_id, calendar_dirty)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,true)
     returning ${COLS}`,
    [
      c.name.trim(),
      Array.from(new Set(c.emails.map((e) => e.trim().toLowerCase()).filter(Boolean))),
      c.phone || null,
      side,
      normalizeRole(side, c.role),
      c.company || null,
      normalizeTier(c.tier),
      c.status,
      c.tier_locked,
      c.last_contact_date,
      c.last_contact_summary || null,
      c.remember || null,
      c.gmail_thread_id || null,
      c.source,
      c.hit_list_id || null,
    ],
  );
  return rows[0];
}

const EDITABLE = [
  "name",
  "emails",
  "phone",
  "side",
  "role",
  "company",
  "tier",
  "status",
  "tier_locked",
  "last_contact_date",
  "last_contact_summary",
  "remember",
  "gmail_thread_id",
  "source",
  "hit_list_id",
] as const;
type Editable = (typeof EDITABLE)[number];

/** Update fields; anything that affects the reminder marks the calendar dirty. */
export async function updateContact(id: string, patch: Partial<Pick<Contact, Editable>>): Promise<Contact | null> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const k of EDITABLE) {
    if (!(k in patch)) continue;
    let v: any = (patch as any)[k];
    if (k === "emails") v = Array.from(new Set((v as string[]).map((e) => e.trim().toLowerCase()).filter(Boolean)));
    if (k === "tier") v = normalizeTier(v);
    vals.push(v);
    sets.push(`${k} = $${vals.length}`);
  }
  if (!sets.length) return getContact(id);
  vals.push(id);
  const rows = await q<Contact>(
    `update contacts set ${sets.join(", ")}, calendar_dirty = true, updated_at = now() where id = $${vals.length} returning ${COLS}`,
    vals,
  );
  return rows[0] || null;
}

export async function deleteContact(auth: GAuth | null, id: string) {
  const c = await getContact(id);
  if (!c) return;
  if (auth) await deleteReminder(auth, c.id, c.calendar_event_id);
  await q(`delete from contacts where id = $1`, [id]);
  await q(`update hit_list set contact_id = null where contact_id = $1`, [id]);
}

/**
 * Bring Google Calendar in line with the CRM for the given contacts (or every dirty one).
 * Green → 3 weeks after last contact, Yellow → 2 months, Red/pending → no reminder.
 */
export async function reconcile(auth: GAuth, ids?: string[]): Promise<{ updated: number; errors: string[] }> {
  const tz = await getTimezone(auth);
  const today = todayIn(tz);
  const rows = ids
    ? await q<Contact>(`select ${COLS} from contacts where id = any($1::uuid[])`, [ids])
    : await q<Contact>(`select ${COLS} from contacts where calendar_dirty = true order by last_contact_date desc nulls last limit 200`);
  if (!rows.length) return { updated: 0, errors: [] };

  const loadRows = await q<{ d: string; n: number }>(
    `select to_char(next_followup_date,'YYYY-MM-DD') d, count(*)::int n from contacts
     where status <> 'pending' and tier <> 'red' and next_followup_date is not null and not (id = any($1::uuid[]))
     group by next_followup_date`,
    [rows.map((r) => r.id)],
  );
  const load = new Map(loadRows.map((r) => [r.d, r.n]));
  const errors: string[] = [];
  let updated = 0;

  for (const c of rows) {
    try {
      const wantsReminder = c.status !== "pending" && c.tier !== "red" && !!c.last_contact_date;
      let next: string | null = null;
      let eventId: string | null = null;
      if (wantsReminder) {
        next = scheduleDate(ruleDate(c.tier, c.last_contact_date), today, c.calendar_event_id ? c.next_followup_date : null, load);
      }
      if (next) eventId = await upsertReminder(auth, c, next, tz);
      else if (c.calendar_event_id) await deleteReminder(auth, c.id, c.calendar_event_id);
      await q(`update contacts set next_followup_date = $1, calendar_event_id = $2, calendar_dirty = false where id = $3`, [next, eventId, c.id]);
      updated++;
    } catch (e: any) {
      errors.push(`${c.name}: ${e?.message || e}`);
    }
  }
  return { updated, errors };
}
