import { decrypt, encrypt } from "./crypto";
import { deleteSetting, getSetting, setSetting } from "./db";

type CalendlySetting = { token: string; user_uri: string; name: string; connected_at: string; last_sync?: string };

const API = "https://api.calendly.com";

async function call(token: string, url: string) {
  const res = await fetch(url.startsWith("http") ? url : API + url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const e: any = new Error(res.status === 401 ? "Calendly token was rejected. Create a new one and reconnect." : `Calendly error ${res.status}`);
    e.status = res.status === 401 ? 400 : 502;
    throw e;
  }
  return res.json();
}

export async function connectCalendly(token: string) {
  const t = token.trim();
  const me = await call(t, "/users/me");
  await setSetting("calendly", {
    token: encrypt(t),
    user_uri: me.resource.uri,
    name: me.resource.name,
    connected_at: new Date().toISOString(),
  } satisfies CalendlySetting);
  return { name: me.resource.name as string };
}

export async function disconnectCalendly() {
  await deleteSetting("calendly");
}

export async function calendlyStatus() {
  const c = await getSetting<CalendlySetting>("calendly");
  return c ? { connected: true, name: c.name, last_sync: c.last_sync || null } : { connected: false };
}

export type Booking = { name: string; email: string; eventName: string; start: string; booked: string };

/** Meetings booked since the last sync (or `sinceIso` the first time). */
export async function newBookings(sinceIso: string): Promise<Booking[] | null> {
  const c = await getSetting<CalendlySetting>("calendly");
  if (!c) return null;
  const token = decrypt(c.token);
  const since = c.last_sync || sinceIso;
  const out: Booking[] = [];
  let url: string | null =
    `/scheduled_events?user=${encodeURIComponent(c.user_uri)}&min_start_time=${encodeURIComponent(since)}&status=active&count=100&sort=start_time:asc`;
  let pages = 0;
  while (url && pages++ < 10) {
    const page: any = await call(token, url);
    for (const ev of page.collection || []) {
      const inv: any = await call(token, `${ev.uri}/invitees?count=100`);
      for (const i of inv.collection || []) {
        if (!i.email) continue;
        out.push({ name: i.name || i.email, email: String(i.email).toLowerCase(), eventName: ev.name, start: ev.start_time, booked: i.created_at || ev.created_at });
      }
    }
    url = page.pagination?.next_page || null;
  }
  await setSetting("calendly", { ...c, last_sync: new Date().toISOString() });
  return out;
}
