export const CREATIVE_ROLES = [
  "Producer",
  "Executive Producer",
  "Director",
  "Writer",
  "Showrunner",
  "Actor",
  "Cinematographer / DP",
  "Editor",
  "Composer",
  "Casting Director",
  "Production Designer",
  "Department Head / Crew",
  "Mentor",
  "Other",
] as const;

export const BUSINESS_ROLES = [
  "Literary Agent",
  "Talent Agent",
  "Manager",
  "Entertainment Attorney",
  "Development Executive",
  "Studio Executive",
  "Streamer / Network Executive",
  "Production Company Executive",
  "Financier / Investor",
  "Film Fund / Equity Fund",
  "Completion Bond / Insurance",
  "Sales Agent",
  "Distributor",
  "Festival Programmer / Director",
  "Publicist / PR",
  "Marketing / Release Strategist",
  "Business Manager / Accountant",
  "Brand Partnerships",
  "Grant / Foundation Officer",
  "Film Commission / Incentives",
  "Guild / Union Rep",
  "Contest / Fellowship Org",
  "Other",
] as const;

export type Side = "Creative" | "Business";
export type Tier = "green" | "yellow" | "red";
export type Status = "pending" | "new" | "active";
export type HitPriority = "very_important" | "warm" | "long_shot";

export const TIERS: { id: Tier; label: string; meaning: string }[] = [
  { id: "green", label: "Green", meaning: "Keep talking. Reminder in 3 weeks." },
  { id: "yellow", label: "Yellow", meaning: "Potential lead. Reminder in 2 months." },
  { id: "red", label: "Red", meaning: "Not worth your time. No reminder." },
];

export const HIT_PRIORITIES: { id: HitPriority; label: string }[] = [
  { id: "very_important", label: "Very important" },
  { id: "warm", label: "Warm" },
  { id: "long_shot", label: "Long shot" },
];

export function rolesFor(side: Side): readonly string[] {
  return side === "Business" ? BUSINESS_ROLES : CREATIVE_ROLES;
}

export function normalizeSide(v: unknown): Side {
  return v === "Business" ? "Business" : "Creative";
}

export function normalizeRole(side: Side, role: unknown): string {
  const list = rolesFor(side);
  const r = String(role || "").trim();
  return (list as readonly string[]).includes(r) ? r : "Other";
}

export function normalizeTier(v: unknown, fallback: Tier = "yellow"): Tier {
  return v === "green" || v === "yellow" || v === "red" ? v : fallback;
}

/** If the role only exists on one side, that decides the side. */
export function sideForRole(role: string, fallback: Side): Side {
  const inC = (CREATIVE_ROLES as readonly string[]).includes(role);
  const inB = (BUSINESS_ROLES as readonly string[]).includes(role);
  if (inC && !inB) return "Creative";
  if (inB && !inC) return "Business";
  return fallback;
}
