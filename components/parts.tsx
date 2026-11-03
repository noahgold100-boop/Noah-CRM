"use client";
import { BUSINESS_ROLES, CREATIVE_ROLES, TIERS, type Side, type Tier } from "@/lib/roles";

export async function call<T = any>(url: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    window.location.href = "/";
    throw new Error("Signed out");
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

const TIER_NAMES: Record<Tier, string> = { green: "Green", yellow: "Yellow", red: "Red" };

/** The colored dot is the tier dropdown (a native select, so it works with keyboard and on phones). */
export function TierPicker({ value, onChange, label }: { value: Tier; onChange: (t: Tier) => void; label: string }) {
  return (
    <span className="picker" title={`${TIER_NAMES[value]}. Change tier`}>
      <span className={`dot ${value}`} aria-hidden />
      <select aria-label={`Tier for ${label}`} value={value} onChange={(e) => onChange(e.target.value as Tier)}>
        {TIERS.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}: {t.meaning}
          </option>
        ))}
      </select>
    </span>
  );
}

export function TierKey() {
  return (
    <div className="key" aria-label="Color key">
      {TIERS.map((t) => (
        <span key={t.id}>
          <i className={`dot ${t.id}`} aria-hidden />
          <span>
            <b style={{ color: "var(--ink)", fontWeight: 600 }}>{t.label}</b> {t.meaning}
          </span>
        </span>
      ))}
    </div>
  );
}

/** Role select with both sides; value encodes the side so "Other" stays unambiguous. */
export function RoleSelect({
  side,
  role,
  onChange,
  className = "field",
  only,
}: {
  side: Side;
  role: string;
  onChange: (side: Side, role: string) => void;
  className?: string;
  only?: Side;
}) {
  const groups: [Side, readonly string[]][] = [
    ["Creative", CREATIVE_ROLES],
    ["Business", BUSINESS_ROLES],
  ];
  return (
    <select
      className={className}
      aria-label="Role"
      value={`${side}|${role}`}
      onChange={(e) => {
        const [s, ...r] = e.target.value.split("|");
        onChange(s as Side, r.join("|"));
      }}
    >
      {groups
        .filter(([s]) => !only || only === s)
        .map(([s, list]) => (
          <optgroup key={s} label={s}>
            {list.map((r) => (
              <option key={r} value={`${s}|${r}`}>
                {r}
              </option>
            ))}
          </optgroup>
        ))}
    </select>
  );
}

const MONTH = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const MONTH_Y = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

function d(iso: string) {
  const [y, m, dd] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd));
}

export function fmtDate(iso: string | null, today: string) {
  if (!iso) return "";
  return iso.slice(0, 4) === today.slice(0, 4) ? MONTH.format(d(iso)) : MONTH_Y.format(d(iso));
}

export function fmtDay(iso: string) {
  return WEEKDAY.format(d(iso));
}

export function daysBetween(a: string, b: string) {
  return Math.round((d(b).getTime() - d(a).getTime()) / 864e5);
}

export function ago(iso: string | null, today: string) {
  if (!iso) return "";
  const n = daysBetween(iso, today);
  if (n <= 0) return "today";
  if (n === 1) return "yesterday";
  if (n < 14) return `${n} days ago`;
  if (n < 60) return `${Math.round(n / 7)} weeks ago`;
  if (n < 365) return `${Math.round(n / 30)} months ago`;
  return `${Math.round(n / 365)}+ years ago`;
}

export function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}
