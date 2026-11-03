import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";
import { BUSINESS_ROLES, CREATIVE_ROLES, normalizeRole, normalizeSide, normalizeTier, sideForRole, type Side, type Tier } from "./roles";

let _client: Anthropic | null = null;
export function claude() {
  if (!_client) _client = new Anthropic({ apiKey: env.anthropicKey, maxRetries: 3 });
  return _client;
}

export type KnownContact = { email: string; name: string; role: string; company: string | null; tier: Tier; remember: string | null };

export type ExtractedPerson = {
  name: string;
  email: string;
  side: Side;
  role: string;
  company: string;
  summary: string;
  remember: string;
  suggested_tier: Tier;
  interest: boolean;
};

const ALL_ROLES = Array.from(new Set([...CREATIVE_ROLES, ...BUSINESS_ROLES]));

const RECORD_TOOL: Anthropic.Tool = {
  name: "record_thread",
  description: "Record whether this email thread is film/TV business and who Noah is dealing with in it.",
  input_schema: {
    type: "object",
    properties: {
      is_business: {
        type: "boolean",
        description:
          "True only if this is about Noah's film/TV/creative career or business: scripts, projects, financing, festivals, distribution, representation, legal, crew, collaborations, meetings, intros. False for family, friends' personal chat, school admin, shopping, medical, banking, newsletters, cold sales pitches with no reply from Noah.",
      },
      people: {
        type: "array",
        description: "Each external person Noah has a working relationship with in this thread. Exclude Noah. Empty if is_business is false.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Full name as best known." },
            email: { type: "string", description: "Their email address exactly as in the headers. If an assistant writes on someone's behalf, record the principal; use the principal's address if it appears, otherwise the assistant's." },
            side: { type: "string", enum: ["Creative", "Business"] },
            role: { type: "string", enum: ALL_ROLES, description: "Closest role. Use Other if unclear." },
            company: { type: "string", description: "Company or affiliation, or empty string." },
            summary: {
              type: "string",
              description: "ONE plain sentence (max 25 words) on what the latest exchange with this person was about and where it left off. Factual, no hype.",
            },
            remember: {
              type: "string",
              description:
                "ONE plain sentence (max 20 words): the most useful thing to remember about them (what they want, what they're working on, who referred them, a detail they shared, assistant's name). Keep the existing note if nothing better appears. Never include health, money amounts owed, ID numbers or other sensitive personal data.",
            },
            suggested_tier: {
              type: "string",
              enum: ["green", "yellow", "red"],
              description:
                "green: active back-and-forth, asked to read something, meeting set, intro offered, clear next step. yellow: polite and open but no next step, or warm but gone quiet. red: clear pass, no fit, or they are selling a service to Noah.",
            },
            interest: { type: "boolean", description: "True if they expressed real interest in Noah or his work (want to read, meet, hear more, stay in touch about a project)." },
          },
          required: ["name", "email", "side", "role", "company", "summary", "remember", "suggested_tier", "interest"],
        },
      },
    },
    required: ["is_business", "people"],
  },
};

export async function classifyThread(input: {
  threadText: string;
  ownerName: string;
  ownerEmails: string[];
  profile: string;
  known: KnownContact[];
  hitListNames: string[];
}): Promise<{ is_business: boolean; people: ExtractedPerson[] }> {
  const known = input.known.length
    ? input.known.map((k) => `- ${k.email}: ${k.name}, ${k.role}${k.company ? ` at ${k.company}` : ""}, tier ${k.tier}${k.remember ? `. Existing note: ${k.remember}` : ""}`).join("\n")
    : "(none)";
  const system = `You maintain a private relationship CRM for ${input.ownerName}, a filmmaker. You read one email thread at a time and record who he is dealing with professionally.
Write like a sharp assistant taking notes: plain, specific, no filler or hype. Never invent facts that aren't in the thread.

About ${input.ownerName}:
${input.profile}

His addresses: ${input.ownerEmails.join(", ")}

People in this thread already in the CRM:
${known}

Hit-list targets (long-shot industry names he hopes to reach): ${input.hitListNames.length ? input.hitListNames.join("; ") : "(none)"}`;

  const res = await claude().messages.create({
    model: env.model,
    max_tokens: 1500,
    system,
    tools: [RECORD_TOOL],
    tool_choice: { type: "tool", name: "record_thread" },
    messages: [{ role: "user", content: `Email thread:\n\n${input.threadText}` }],
  });

  const block = res.content.find((b) => b.type === "tool_use") as Anthropic.ToolUseBlock | undefined;
  const raw = (block?.input || {}) as any;
  const people: ExtractedPerson[] = (Array.isArray(raw.people) ? raw.people : [])
    .map((p: any) => {
      const role = String(p.role || "Other");
      const side = sideForRole(role, normalizeSide(p.side));
      return {
        name: String(p.name || "").trim().slice(0, 120),
        email: String(p.email || "").trim().toLowerCase(),
        side,
        role: normalizeRole(side, role),
        company: String(p.company || "").trim().slice(0, 120),
        summary: oneSentence(p.summary, 220),
        remember: oneSentence(p.remember, 180),
        suggested_tier: normalizeTier(p.suggested_tier),
        interest: !!p.interest,
      };
    })
    .filter((p: ExtractedPerson) => p.name && p.email.includes("@") && !input.ownerEmails.includes(p.email));
  return { is_business: !!raw.is_business && people.length > 0, people };
}

function oneSentence(v: unknown, max: number): string {
  const s = String(v || "").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1).replace(/\s+\S*$/, "") + "…" : s;
}

/**
 * Runs a prompt with server-side web search and returns the final text.
 * Handles pause_turn by resending the paused assistant turn.
 */
export async function researchWithWebSearch(system: string, prompt: string, maxSearches = 10, timeoutMs = 240_000): Promise<string> {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];
  const started = Date.now();
  for (let i = 0; i < 6; i++) {
    const res = await claude().messages.create(
      {
        model: env.model,
        max_tokens: 8000,
        system,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: maxSearches } as any],
        messages,
      },
      { timeout: Math.max(30_000, timeoutMs - (Date.now() - started)) },
    );
    if (res.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: res.content });
      continue;
    }
    return res.content
      .filter((b) => b.type === "text")
      .map((b) => (b as Anthropic.TextBlock).text)
      .join("\n");
  }
  throw new Error("Research took too many steps. Try again.");
}

/** Pulls the JSON payload out of <json>…</json> (or the first {...} / [...] block). */
export function extractJson<T = any>(text: string): T | null {
  const tagged = text.match(/<json>([\s\S]*?)<\/json>/i);
  const candidate = tagged ? tagged[1] : text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? text.slice(Math.min(...["{", "["].map((c) => (text.indexOf(c) < 0 ? Infinity : text.indexOf(c)))));
  try {
    return JSON.parse(candidate.trim());
  } catch {
    return null;
  }
}
