import { google, type gmail_v1 } from "googleapis";
import type { GAuth } from "./google";

export type Addr = { name: string; email: string };
export type SimpleMessage = {
  id: string;
  date: Date;
  from: Addr;
  to: Addr[];
  cc: Addr[];
  subject: string;
  body: string;
  automated: boolean;
};
export type SimpleThread = { id: string; lastMessageId: string; subject: string; messages: SimpleMessage[] };

// Everything except promotions/social/forums/updates. Sent mail has no category, so it's included.
export const BASE_QUERY = "-in:chats -in:spam -in:trash -category:promotions -category:social -category:forums -category:updates";

export function gmailClient(auth: GAuth) {
  return google.gmail({ version: "v1", auth });
}

// ---------- pacing ----------
// Gmail allows 15,000 quota units per user per minute and rejects short bursts above ~250 units/second.
// threads.list and threads.get cost 10 units each, so stay under 20 calls/second and 1,200 calls/minute,
// and retry with backoff if Google still says to slow down.
const MAX_PER_SECOND = 20;
const MAX_PER_MINUTE = 1200;
const recent: number[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function takeSlot() {
  for (;;) {
    const now = Date.now();
    while (recent.length && now - recent[0] >= 60_000) recent.shift();
    let lastSecond = 0;
    for (let i = recent.length - 1; i >= 0 && now - recent[i] < 1000; i--) lastSecond++;
    if (recent.length < MAX_PER_MINUTE && lastSecond < MAX_PER_SECOND) {
      recent.push(now);
      return;
    }
    await sleep(recent.length >= MAX_PER_MINUTE ? 60_000 - (now - recent[0]) + 50 : 100);
  }
}

export function isRateLimited(e: any): boolean {
  const status = e?.code ?? e?.status ?? e?.response?.status;
  const msg = String(e?.message || "");
  const reason = String(e?.errors?.[0]?.reason || e?.response?.data?.error?.errors?.[0]?.reason || "");
  return status === 429 || /rateLimitExceeded|userRateLimitExceeded|quotaExceeded/i.test(reason) || /quota exceeded|rate limit/i.test(msg);
}

async function paced<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    await takeSlot();
    try {
      return await fn();
    } catch (e) {
      if (!isRateLimited(e) || attempt >= 5) throw e;
      await sleep(Math.min(30_000, 2000 * 2 ** attempt) + Math.floor(Math.random() * 500));
    }
  }
}

export async function listThreadIds(gmail: gmail_v1.Gmail, query: string, pageToken?: string) {
  const res = await paced(() => gmail.users.threads.list({ userId: "me", q: query, maxResults: 40, pageToken }));
  return { ids: (res.data.threads || []).map((t) => t.id!).filter(Boolean), nextPageToken: res.data.nextPageToken || null };
}

export async function getThreadHead(gmail: gmail_v1.Gmail, id: string) {
  const res = await paced(() => gmail.users.threads.get({ userId: "me", id, format: "minimal" }));
  const msgs = res.data.messages || [];
  return msgs[msgs.length - 1]?.id || "";
}

export async function getThread(gmail: gmail_v1.Gmail, id: string): Promise<SimpleThread> {
  const res = await paced(() => gmail.users.threads.get({ userId: "me", id, format: "full" }));
  const messages = (res.data.messages || []).map(simplifyMessage).sort((a, b) => a.date.getTime() - b.date.getTime());
  return {
    id,
    lastMessageId: res.data.messages?.[res.data.messages.length - 1]?.id || "",
    subject: messages[0]?.subject || "(no subject)",
    messages,
  };
}

// ---------- parsing ----------

export function parseAddressList(header: string | undefined | null): Addr[] {
  if (!header) return [];
  const parts: string[] = [];
  let cur = "";
  let inQuote = false;
  let inAngle = false;
  for (const ch of header) {
    if (ch === '"') inQuote = !inQuote;
    if (ch === "<") inAngle = true;
    if (ch === ">") inAngle = false;
    if (ch === "," && !inQuote && !inAngle) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  const out: Addr[] = [];
  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;
    const angle = p.match(/<([^>]+)>/);
    const email = (angle ? angle[1] : p).trim().replace(/^mailto:/i, "").toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
    const name = angle ? p.slice(0, angle.index).trim().replace(/^"|"$/g, "").trim() : "";
    out.push({ name, email });
  }
  return out;
}

function header(msg: gmail_v1.Schema$Message, name: string): string {
  const h = msg.payload?.headers?.find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value || "";
}

function decode(data?: string | null): string {
  if (!data) return "";
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function collect(part: gmail_v1.Schema$MessagePart | undefined, mime: string, out: string[]) {
  if (!part) return;
  if (part.mimeType === mime && part.body?.data && !part.filename) out.push(decode(part.body.data));
  for (const p of part.parts || []) collect(p, mime, out);
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

/** Drop quoted history so each message is just what was newly written. */
export function stripQuoted(text: string): string {
  const cutters = [
    /\n\s*On [^\n]{0,200}wrote:\s*\n/i,
    /\n\s*-{2,}\s*Original Message\s*-{2,}/i,
    /\n\s*From: [^\n]+\n\s*(Sent|Date): /i,
    /\n\s*-{2,}\s*Forwarded message\s*-{2,}/i,
  ];
  let t = "\n" + text;
  for (const c of cutters) {
    const m = t.match(c);
    if (m && m.index !== undefined && m.index > 0) t = t.slice(0, m.index);
  }
  return t
    .split("\n")
    .filter((l) => !l.trim().startsWith(">"))
    .join("\n")
    .trim();
}

const NOREPLY = /^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounces?|notifications?|notify|alerts?)([+.\-_].*)?@/i;

export function simplifyMessage(msg: gmail_v1.Schema$Message): SimpleMessage {
  const plain: string[] = [];
  collect(msg.payload, "text/plain", plain);
  let body = plain.join("\n");
  if (!body.trim()) {
    const html: string[] = [];
    collect(msg.payload, "text/html", html);
    body = htmlToText(html.join("\n"));
  }
  if (!body.trim() && msg.payload?.body?.data) body = decode(msg.payload.body.data);
  body = stripQuoted(body).slice(0, 1800);

  const from = parseAddressList(header(msg, "From"))[0] || { name: "", email: "" };
  const precedence = header(msg, "Precedence").toLowerCase();
  const automated =
    !!header(msg, "List-Unsubscribe") ||
    !!header(msg, "List-Id") ||
    precedence === "bulk" ||
    precedence === "list" ||
    NOREPLY.test(from.email) ||
    /^auto-(generated|replied)/i.test(header(msg, "Auto-Submitted"));

  return {
    id: msg.id || "",
    date: new Date(Number(msg.internalDate || Date.parse(header(msg, "Date")) || Date.now())),
    from,
    to: parseAddressList(header(msg, "To")),
    cc: parseAddressList(header(msg, "Cc")),
    subject: header(msg, "Subject"),
    body,
    automated,
  };
}

export function isCalendly(m: SimpleMessage) {
  return /@([a-z0-9-]+\.)*calendly\.com$/i.test(m.from.email);
}

/**
 * Cheap filter before anything is sent to Claude.
 * Keep a thread if Noah wrote in it, or anyone wrote to him personally (not bulk/automated).
 * Calendly booking emails are kept so meetings get logged.
 */
export function worthClassifying(t: SimpleThread, ownerEmails: string[], skipList: string[]): boolean {
  const owners = new Set(ownerEmails.map((e) => e.toLowerCase()));
  const participants = new Set<string>();
  let ownerWrote = false;
  let humanToOwner = false;
  for (const m of t.messages) {
    const fromOwner = owners.has(m.from.email);
    if (fromOwner) ownerWrote = true;
    else if (!m.automated || isCalendly(m)) humanToOwner = true;
    for (const a of [m.from, ...m.to, ...m.cc]) if (a.email && !owners.has(a.email)) participants.add(a.email);
  }
  if (participants.size === 0) return false; // notes to self
  const relevant = [...participants].filter((e) => !skipList.some((s) => s && (e === s || e.endsWith("@" + s))));
  if (relevant.length === 0) return false;
  return ownerWrote || humanToOwner;
}

export function threadToText(t: SimpleThread): string {
  const fmt = (a: Addr) => (a.name ? `${a.name} <${a.email}>` : a.email);
  const msgs = t.messages.slice(-8);
  const lines = [`Subject: ${t.subject}`];
  if (t.messages.length > msgs.length) lines.push(`(${t.messages.length - msgs.length} earlier messages omitted)`);
  for (const m of msgs) {
    lines.push(
      `\n--- ${m.date.toISOString().slice(0, 16).replace("T", " ")} UTC` +
        `\nFrom: ${fmt(m.from)}` +
        (m.to.length ? `\nTo: ${m.to.map(fmt).join(", ")}` : "") +
        (m.cc.length ? `\nCc: ${m.cc.map(fmt).join(", ")}` : "") +
        `\n\n${m.body || "(no text)"}`,
    );
  }
  return lines.join("\n");
}

/** Latest message date in which this address appears as sender or recipient. */
export function lastDateFor(t: SimpleThread, email: string): Date | null {
  let best: Date | null = null;
  for (const m of t.messages) {
    const all = [m.from, ...m.to, ...m.cc].map((a) => a.email);
    if (all.includes(email) && (!best || m.date > best)) best = m.date;
  }
  return best;
}
