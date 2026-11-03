import { getSetting, setSetting } from "./db";

export { DEFAULT_PROFILE, PROFILE_FIELDS, type Profile } from "./profile-fields";
import { DEFAULT_PROFILE, PROFILE_FIELDS, type Profile } from "./profile-fields";

export async function getProfile(): Promise<Profile> {
  const p = await getSetting<Partial<Profile>>("profile");
  return { ...DEFAULT_PROFILE, ...(p || {}) };
}

export async function saveProfile(input: Partial<Profile>): Promise<Profile> {
  const current = await getProfile();
  const next = { ...current };
  for (const f of PROFILE_FIELDS) {
    if (typeof input[f.key] === "string") next[f.key] = input[f.key]!.slice(0, 4000);
  }
  await setSetting("profile", next);
  return next;
}

export function profileFilled(p: Profile): boolean {
  return p.projects.trim().length > 0;
}

export function profileText(p: Profile): string {
  return [
    `Company: ${p.company} (${p.website})`,
    `Films: ${p.films}`,
    p.projects && `Scripts/projects: ${p.projects}`,
    p.credits && `Credits/recognition: ${p.credits}`,
    p.location && `Based in: ${p.location}`,
    p.representation && `Representation: ${p.representation}`,
    p.affiliations && `School/hometown/communities: ${p.affiliations}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Lowercased names/emails Noah said never to track. */
export function doNotTrackList(p: Profile): string[] {
  return p.do_not_contact
    .split(/[,;\n]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
