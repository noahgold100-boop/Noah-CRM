// Pure date helpers. All dates are calendar dates (YYYY-MM-DD) in Noah's time zone.
import type { Tier } from "./roles";

export const GREEN_DAYS = 21; // 3 weeks
export const YELLOW_MONTHS = 2;
export const MAX_PER_DAY = 3; // overdue reminders are spread out so nothing piles up

function parse(d: string): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: string, n: number): string {
  const x = parse(d);
  x.setUTCDate(x.getUTCDate() + n);
  return fmt(x);
}

/** Same day-of-month n months later; clamps to the last day when that day doesn't exist (Dec 31 → Feb 28/29). */
export function addMonthsClamped(d: string, n: number): string {
  const x = parse(d);
  const day = x.getUTCDate();
  const target = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return fmt(target);
}

export function isWeekend(d: string): boolean {
  const w = parse(d).getUTCDay();
  return w === 0 || w === 6;
}

/** Saturday/Sunday reminders move to Monday. */
export function toWeekday(d: string): string {
  let x = d;
  while (isWeekend(x)) x = addDays(x, 1);
  return x;
}

/** The date the tier rules say to follow up, before weekend/overdue adjustments. Red → null. */
export function ruleDate(tier: Tier, lastContact: string | null): string | null {
  if (tier === "red" || !lastContact) return null;
  return tier === "green" ? addDays(lastContact, GREEN_DAYS) : addMonthsClamped(lastContact, YELLOW_MONTHS);
}

/** Today's date in an IANA time zone. */
export function todayIn(tz: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Decide the actual reminder date.
 * - On time: the rule date (moved off weekends).
 * - Overdue (rule date is today or earlier): keep an already-scheduled future date if there is one,
 *   otherwise take the first weekday from tomorrow with fewer than MAX_PER_DAY reminders.
 * `load` counts reminders already on each date and is updated in place.
 */
export function scheduleDate(
  rule: string | null,
  today: string,
  current: string | null,
  load: Map<string, number>,
): string | null {
  if (!rule) return null;
  const tomorrow = addDays(today, 1);
  let chosen: string;
  if (rule >= tomorrow) {
    chosen = toWeekday(rule);
  } else if (current && current >= tomorrow) {
    return current; // already slotted; don't keep moving it
  } else {
    let d = toWeekday(tomorrow);
    while ((load.get(d) || 0) >= MAX_PER_DAY) d = toWeekday(addDays(d, 1));
    chosen = d;
  }
  load.set(chosen, (load.get(chosen) || 0) + 1);
  return chosen;
}
