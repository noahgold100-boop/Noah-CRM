"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Contact } from "@/lib/contacts";
import type { HitEntry } from "@/lib/hitlist";
import { BUSINESS_ROLES, CREATIVE_ROLES, type Side, type Tier } from "@/lib/roles";
import { addDays, todayIn } from "@/lib/dates";
import { ago, call, fmtDate, fmtDay, GearIcon, RoleSelect, TierKey, TierPicker } from "./parts";
import Settings from "./Settings";
import Review from "./Review";
import HitList from "./HitList";
import AddContact from "./AddContact";

export type Status = {
  google: { connected: boolean; email?: string; error?: string };
  calendly: { connected: boolean; name?: string };
  profile: Record<string, string>;
  profile_filled: boolean;
  backfill: { status: string; scanned: number; found: number } | null;
  build: { status: string; step: number; total: number; error?: string } | null;
  last_run: { at: string; errors?: string[] } | null;
  timezone: string;
};

type Tab = "Creative" | "Business" | "Hit list";
const GROUPS: { tier: Tier; title: string }[] = [
  { tier: "green", title: "Keep talking" },
  { tier: "yellow", title: "Potential leads" },
  { tier: "red", title: "Not worth your time" },
];

export default function App() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [hits, setHits] = useState<HitEntry[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<Tab>("Creative");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [tierFilter, setTierFilter] = useState<"" | Tier>("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ red: true });
  const [panel, setPanel] = useState<null | "settings" | "review" | "add">(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const [rowError, setRowError] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await call<{ contacts: Contact[]; hits: HitEntry[]; status: Status }>("/api/state");
      setContacts(d.contacts);
      setHits(d.hits);
      setStatus(d.status);
      setLoadError("");
    } catch (e: any) {
      setLoadError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const today = useMemo(() => todayIn(status?.timezone || "America/Chicago"), [status?.timezone]);
  const visible = contacts.filter((c) => c.status !== "pending");
  const pending = contacts.filter((c) => c.status === "pending");

  // ---- the 12-month import runs in short steps until done ----
  const stopImport = useRef(false);
  const runImport = useCallback(async () => {
    setImporting(true);
    stopImport.current = false;
    try {
      for (let i = 0; i < 400 && !stopImport.current; i++) {
        const s = await call<{ status: string; scanned: number; found: number }>("/api/sync", "POST", { mode: "backfill" });
        setImportMsg(`Read ${s.scanned.toLocaleString()} email threads, found ${s.found} business contacts so far.`);
        if (s.status === "done") break;
      }
      await load();
      setImportMsg("");
    } catch (e: any) {
      setImportMsg(e.message);
    } finally {
      setImporting(false);
    }
  }, [load]);

  useEffect(() => () => void (stopImport.current = true), []);

  async function changeContact(id: string, patch: Record<string, unknown>) {
    setRowError("");
    const prev = contacts;
    setContacts((cs) => cs.map((c) => (c.id === id ? ({ ...c, ...patch } as Contact) : c)));
    try {
      const r = await call<{ contact: Contact; calendar_error?: string }>(`/api/contacts/${id}`, "PATCH", patch);
      setContacts((cs) => cs.map((c) => (c.id === id ? r.contact : c)));
      if (r.calendar_error) setRowError(`Saved. Calendar will update on the next sync: ${r.calendar_error}`);
    } catch (e: any) {
      setContacts(prev);
      setRowError(e.message);
    }
  }

  async function removeContact(id: string) {
    if (!confirm("Delete this contact and its reminder?")) return;
    await call(`/api/contacts/${id}`, "DELETE");
    setContacts((cs) => cs.filter((c) => c.id !== id));
    setOpenId(null);
  }

  if (!status) {
    return (
      <main className="wrap">
        <p className={loadError ? "err" : "ok"}>{loadError || "Loading…"}</p>
      </main>
    );
  }

  const side: Side | null = tab === "Hit list" ? null : tab;
  const roles = side === "Business" ? BUSINESS_ROLES : CREATIVE_ROLES;
  const needle = search.trim().toLowerCase();
  const filtered = visible.filter(
    (c) =>
      c.side === side &&
      (!roleFilter || c.role === roleFilter) &&
      (!tierFilter || c.tier === tierFilter) &&
      (!needle ||
        [c.name, c.company, c.role, c.last_contact_summary, c.remember, ...c.emails].some((v) => v && v.toLowerCase().includes(needle))),
  );
  const soon = addDays(today, 7);
  const upNext = visible
    .filter((c) => c.tier !== "red" && c.next_followup_date && c.next_followup_date <= soon)
    .sort((a, b) => a.next_followup_date!.localeCompare(b.next_followup_date!));

  const steps = [
    { done: status.profile_filled, label: "Tell the CRM about your work", sub: "Your scripts, credits and connections. Used to sort email and build the hit list.", action: () => setPanel("settings"), cta: "Fill in" },
    { done: status.backfill?.status === "done", label: "Import contacts from your email", sub: "Reads the last 12 months of Gmail (read-only).", action: runImport, cta: importing ? "Importing…" : status.backfill?.status === "running" ? "Continue" : "Start" },
    { done: hits.length > 0, label: "Build your hit list", sub: "Long-shot industry names to reach once you have more credibility.", action: () => setTab("Hit list"), cta: "Open" },
  ];
  const onboarding = steps.some((s) => !s.done);

  return (
    <main className="wrap">
      <header className="top">
        <h1 className="brand">Noah Gold</h1>
        <div className="top-actions">
          <button className="btn" onClick={() => setPanel("add")}>
            Add contact
          </button>
          <button className="btn quiet icon-btn" aria-label="Settings" onClick={() => setPanel("settings")}>
            <GearIcon />
          </button>
        </div>
      </header>

      {!status.google.connected && (
        <div className="notice warn">
          <p>Google access needs to be renewed before email and reminders can update.</p>
          <a className="btn primary" href="/api/auth/google">
            Reconnect Google
          </a>
        </div>
      )}

      {onboarding && (
        <ol className="steps" aria-label="Setup">
          {steps.map((s, i) => (
            <li key={s.label} className={s.done ? "done" : ""}>
              <span className="n">{s.done ? "✓" : i + 1}</span>
              <span className="label">
                {s.label}
                {!s.done && <div className="sub">{i === 1 && importMsg ? importMsg : s.sub}</div>}
              </span>
              {!s.done && (
                <button className="btn" onClick={s.action} disabled={i === 1 && importing}>
                  {s.cta}
                </button>
              )}
            </li>
          ))}
        </ol>
      )}

      {pending.length > 0 && !importing && (
        <div className="notice">
          <p>
            {pending.length === 1 ? "1 contact" : `${pending.length} contacts`} found in your email. Check the colors, then approve to set reminders.
          </p>
          <button className="btn primary" onClick={() => setPanel("review")}>
            Review {pending.length}
          </button>
        </div>
      )}

      <nav className="tabs" role="tablist">
        {(["Creative", "Business", "Hit list"] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            className="tab"
            aria-selected={tab === t}
            onClick={() => {
              setTab(t);
              setRoleFilter("");
              setOpenId(null);
            }}
          >
            {t}
            <span className="count">{t === "Hit list" ? hits.length : visible.filter((c) => c.side === t).length}</span>
          </button>
        ))}
      </nav>

      {tab === "Hit list" ? (
        <HitList hits={hits} setHits={setHits} status={status} onSettings={() => setPanel("settings")} onChanged={load} />
      ) : (
        <>
          <div className="toolbar">
            <input className="field search" type="search" placeholder="Search name, company, notes" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
            <select className="field" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label="Filter by role">
              <option value="">All roles</option>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <select className="field" value={tierFilter} onChange={(e) => setTierFilter(e.target.value as any)} aria-label="Filter by color">
              <option value="">All colors</option>
              <option value="green">Green</option>
              <option value="yellow">Yellow</option>
              <option value="red">Red</option>
            </select>
          </div>
          <TierKey />

          {upNext.length > 0 && (
            <div className="upnext">
              <b>Up next</b>
              {upNext.slice(0, 5).map((c) => (
                <span key={c.id} className={c.next_followup_date! < today ? "late" : ""}>
                  <button
                    onClick={() => {
                      setTab(c.side);
                      setOpenId(c.id);
                      setCollapsed((x) => ({ ...x, [c.tier]: false }));
                      setTimeout(() => document.getElementById(`c-${c.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
                    }}
                  >
                    {c.name}
                  </button>{" "}
                  {c.next_followup_date! < today ? "overdue" : c.next_followup_date === today ? "today" : fmtDay(c.next_followup_date!)}
                </span>
              ))}
              {upNext.length > 5 && <span>+{upNext.length - 5} more</span>}
            </div>
          )}

          {rowError && <p className="err">{rowError}</p>}

          {filtered.length === 0 ? (
            <p className="empty">
              {visible.some((c) => c.side === side)
                ? "No one matches these filters."
                : `No ${side?.toLowerCase()} contacts yet. They'll appear here as your email is read, or add one yourself.`}
            </p>
          ) : (
            GROUPS.map((g) => {
              const items = filtered.filter((c) => c.tier === g.tier);
              if (!items.length) return null;
              const isCollapsed = collapsed[g.tier] && !needle;
              return (
                <section className="group" key={g.tier}>
                  <button className="group-h" aria-expanded={!isCollapsed} onClick={() => setCollapsed((x) => ({ ...x, [g.tier]: !isCollapsed }))}>
                    <i className={`dot ${g.tier}`} aria-hidden />
                    {g.title} <span className="n">{items.length}</span>
                    <span className="chev">{isCollapsed ? "Show" : "Hide"}</span>
                  </button>
                  {!isCollapsed && (
                    <div className="list">
                      {items.map((c) => (
                        <ContactRow
                          key={c.id}
                          c={c}
                          today={today}
                          open={openId === c.id}
                          onToggle={() => setOpenId(openId === c.id ? null : c.id)}
                          onChange={(p) => changeContact(c.id, p)}
                          onDelete={() => removeContact(c.id)}
                        />
                      ))}
                    </div>
                  )}
                </section>
              );
            })
          )}
        </>
      )}

      {panel === "settings" && <Settings status={status} onClose={() => setPanel(null)} onChanged={load} onImport={() => { setPanel(null); runImport(); }} importing={importing} />}
      {panel === "review" && <Review pending={pending} onClose={() => setPanel(null)} onDone={async () => { setPanel(null); await load(); }} />}
      {panel === "add" && (
        <AddContact
          defaultSide={side || "Creative"}
          onClose={() => setPanel(null)}
          onAdded={(c) => {
            setContacts((cs) => [c, ...cs]);
            setTab(c.side);
            setPanel(null);
          }}
        />
      )}
    </main>
  );
}

function ContactRow({
  c,
  today,
  open,
  onToggle,
  onChange,
  onDelete,
}: {
  c: Contact;
  today: string;
  open: boolean;
  onToggle: () => void;
  onChange: (p: Record<string, unknown>) => Promise<void>;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(() => toDraft(c));
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(toDraft(c)), [c, open]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(c));
  const late = c.next_followup_date && c.next_followup_date < today;
  const meta = [c.role !== "Other" ? c.role : "", c.company || ""].filter(Boolean).join(", ");

  return (
    <div className="row" id={`c-${c.id}`}>
      <div className="row-main">
        <TierPicker value={c.tier} label={c.name} onChange={(t) => onChange({ tier: t })} />
        <div className="row-body" onClick={onToggle} role="button" tabIndex={0} aria-expanded={open} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onToggle())}>
          <div className="row-name">
            {c.name}
            {c.status === "new" && <span className="tag new">New</span>}
            {meta && <span className="row-meta">{meta}</span>}
          </div>
          {c.last_contact_summary && <div className="row-sum">{c.last_contact_summary}</div>}
          {c.remember && <div className="row-rem">{c.remember}</div>}
        </div>
        <div className="row-dates">
          {c.last_contact_date && <div>Last talked {ago(c.last_contact_date, today)}</div>}
          {c.tier !== "red" && c.next_followup_date && (
            <div className={late ? "late" : "due"}>{late ? "Follow-up overdue" : `Follow up ${fmtDate(c.next_followup_date, today)}`}</div>
          )}
        </div>
      </div>
      {open && (
        <form
          className="edit"
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            await onChange(draft);
            setSaving(false);
          }}
        >
          <div className="grid">
            <label>
              Name
              <input className="field" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
            </label>
            <label>
              Role
              <RoleSelect side={draft.side} role={draft.role} onChange={(side, role) => setDraft({ ...draft, side, role })} />
            </label>
            <label>
              Company
              <input className="field" value={draft.company} onChange={(e) => setDraft({ ...draft, company: e.target.value })} />
            </label>
            <label>
              Email
              <input className="field" value={draft.emails} onChange={(e) => setDraft({ ...draft, emails: e.target.value })} />
            </label>
          </div>
          <label>
            Last conversation
            <textarea className="field" rows={2} value={draft.last_contact_summary} onChange={(e) => setDraft({ ...draft, last_contact_summary: e.target.value })} />
          </label>
          <label>
            Remember
            <textarea className="field" rows={2} value={draft.remember} onChange={(e) => setDraft({ ...draft, remember: e.target.value })} />
          </label>
          <div className="actions">
            <button className="btn primary" type="submit" disabled={!dirty || saving}>
              {saving ? "Saving…" : "Save changes"}
            </button>
            {c.gmail_thread_id && (
              <a className="btn quiet" href={`https://mail.google.com/mail/u/0/#all/${c.gmail_thread_id}`} target="_blank" rel="noreferrer">
                Open email thread
              </a>
            )}
            <span className="spacer" />
            <button className="btn quiet danger" type="button" onClick={onDelete}>
              Delete
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function toDraft(c: Contact) {
  return {
    name: c.name,
    side: c.side,
    role: c.role,
    company: c.company || "",
    emails: c.emails.join(", "),
    last_contact_summary: c.last_contact_summary || "",
    remember: c.remember || "",
  };
}
