// Pure definitions shared by server and browser.
export type Profile = {
  company: string;
  website: string;
  films: string;
  projects: string; // scripts/projects: title, logline, genre, format, budget, stage
  credits: string; // credits, festivals, awards, fellowships, contests
  location: string;
  representation: string;
  affiliations: string; // school, hometown, communities
  do_not_contact: string;
  dream_names: string;
};

export const DEFAULT_PROFILE: Profile = {
  company: "Little Cinema Productions",
  website: "littlecinemaproductions.com",
  films: "Little Manly, Morpho, Rain Fugue",
  projects: "",
  credits: "",
  location: "",
  representation: "",
  affiliations: "",
  do_not_contact: "",
  dream_names: "",
};

export const PROFILE_FIELDS: { key: keyof Profile; label: string; hint: string; long?: boolean }[] = [
  { key: "projects", label: "Scripts and projects", hint: "Title, one-line logline, genre, feature/series/short, rough budget, stage", long: true },
  { key: "credits", label: "Credits and recognition", hint: "Festival selections, awards, fellowships, contests", long: true },
  { key: "location", label: "Based in", hint: "City, state" },
  { key: "representation", label: "Representation", hint: "Agent, manager or attorney — or none yet" },
  { key: "affiliations", label: "School, hometown, communities", hint: "Anything that creates a shared connection" },
  { key: "do_not_contact", label: "Never track or contact", hint: "Names or email addresses, comma separated" },
  { key: "dream_names", label: "Dream names", hint: "People you already want on the hit list" },
  { key: "company", label: "Company", hint: "" },
  { key: "films", label: "Films", hint: "" },
  { key: "website", label: "Website", hint: "" },
];
