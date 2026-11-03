import { google, type calendar_v3 } from "googleapis";
import type { GAuth } from "./google";
import { baseUrl } from "./env";
import { getSetting, setSetting } from "./db";

const PROP = "noahCrmContactId"; // every event this app creates carries this private property

export function calendarClient(auth: GAuth) {
  return google.calendar({ version: "v3", auth });
}

/** Noah's time zone, read from his primary calendar once and cached. */
export async function getTimezone(auth: GAuth): Promise<string> {
  const cached = await getSetting<string>("timezone");
  if (cached) return cached;
  let tz = "America/Chicago";
  try {
    const res = await calendarClient(auth).events.list({ calendarId: "primary", maxResults: 1 });
    if (res.data.timeZone) tz = res.data.timeZone;
  } catch (e) {
    console.error("timezone lookup failed", e);
  }
  await setSetting("timezone", tz);
  return tz;
}

export type ReminderContact = {
  id: string;
  name: string;
  role: string;
  company: string | null;
  last_contact_summary: string | null;
  remember: string | null;
  gmail_thread_id: string | null;
  calendar_event_id: string | null;
};

function eventBody(c: ReminderContact, date: string, tz: string): calendar_v3.Schema$Event {
  const who = [c.role !== "Other" ? c.role : "", c.company || ""].filter(Boolean).join(", ");
  const lines = [
    c.last_contact_summary && `Last conversation: ${c.last_contact_summary}`,
    c.remember && `Remember: ${c.remember}`,
    c.gmail_thread_id && `Email thread: https://mail.google.com/mail/u/0/#all/${c.gmail_thread_id}`,
    `Open CRM: ${baseUrl()}`,
  ].filter(Boolean);
  return {
    summary: `Follow up: ${c.name}${who ? ` (${who})` : ""}`,
    description: lines.join("\n"),
    start: { dateTime: `${date}T09:00:00`, timeZone: tz },
    end: { dateTime: `${date}T09:15:00`, timeZone: tz },
    transparency: "transparent", // shows as free, never blocks his schedule
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 0 }] },
    extendedProperties: { private: { [PROP]: c.id } },
  };
}

async function findOurEvents(cal: calendar_v3.Calendar, contactId: string) {
  const res = await cal.events.list({ calendarId: "primary", privateExtendedProperty: [`${PROP}=${contactId}`], showDeleted: false, maxResults: 10 });
  return res.data.items || [];
}

function isGone(e: any) {
  const code = e?.code || e?.response?.status;
  return code === 404 || code === 410;
}

/** Create or move the single reminder for a contact. Returns the event id. Never creates duplicates. */
export async function upsertReminder(auth: GAuth, c: ReminderContact, date: string, tz: string): Promise<string> {
  const cal = calendarClient(auth);
  const body = eventBody(c, date, tz);
  if (c.calendar_event_id) {
    try {
      const res = await cal.events.patch({ calendarId: "primary", eventId: c.calendar_event_id, requestBody: body });
      if (res.data.status !== "cancelled") return res.data.id!;
    } catch (e) {
      if (!isGone(e)) throw e;
    }
  }
  const existing = (await findOurEvents(cal, c.id)).filter((e) => e.status !== "cancelled");
  if (existing.length) {
    const [keep, ...extra] = existing;
    for (const x of extra) await cal.events.delete({ calendarId: "primary", eventId: x.id! }).catch(() => {});
    const res = await cal.events.patch({ calendarId: "primary", eventId: keep.id!, requestBody: body });
    return res.data.id!;
  }
  const res = await cal.events.insert({ calendarId: "primary", requestBody: body });
  return res.data.id!;
}

/** Removes this app's reminder for a contact. Only touches events tagged with the contact's id. */
export async function deleteReminder(auth: GAuth, contactId: string, eventId: string | null): Promise<void> {
  const cal = calendarClient(auth);
  const ids = new Set<string>();
  if (eventId) {
    try {
      const ev = await cal.events.get({ calendarId: "primary", eventId });
      if (ev.data.extendedProperties?.private?.[PROP] === contactId) ids.add(eventId);
    } catch (e) {
      if (!isGone(e)) throw e;
    }
  }
  for (const e of await findOurEvents(cal, contactId)) if (e.id) ids.add(e.id);
  for (const id of ids) {
    await cal.events.delete({ calendarId: "primary", eventId: id }).catch((e) => {
      if (!isGone(e)) throw e;
    });
  }
}
