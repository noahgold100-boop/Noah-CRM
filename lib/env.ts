function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}. See README.md → Environment variables.`);
  return v;
}

export const env = {
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  get googleClientId() {
    return required("GOOGLE_CLIENT_ID");
  },
  get googleClientSecret() {
    return required("GOOGLE_CLIENT_SECRET");
  },
  get anthropicKey() {
    return required("ANTHROPIC_API_KEY");
  },
  get sessionSecret() {
    const s = required("SESSION_SECRET");
    if (s.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters.");
    return s;
  },
  get cronSecret() {
    return process.env.CRON_SECRET || "";
  },
  get ownerEmail() {
    return (process.env.OWNER_EMAIL || "noahgold100@gmail.com").trim().toLowerCase();
  },
  get ownerName() {
    return process.env.OWNER_NAME || "Noah Gold";
  },
  get appUrl() {
    return (process.env.APP_URL || "").replace(/\/$/, "");
  },
  get model() {
    return process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
  },
};

/** Public base URL of the app. APP_URL wins; otherwise derived from the request. */
export function baseUrl(req?: Request): string {
  if (env.appUrl) return env.appUrl;
  if (req) return new URL(req.url).origin;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return "http://localhost:3000";
}
