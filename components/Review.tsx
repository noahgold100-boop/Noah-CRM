"use client";
import { useState } from "react";
import type { Contact } from "@/lib/contacts";
import type { Side, Tier } from "@/lib/roles";
import { call, RoleSelect, TierPicker } from "./parts";

type Item = { id: string; tier: Tier; side: Side; role: string; remove: boolean };

/** One screen to approve everything found in the import. Tiers are pre-set; change only what's wrong. */
export default function Review({ pending, onClose, onDone }: { pending: Contact[]; onClose: () => void; onDone: () => Promise<void> }) {
  const order: Record<Tier, number> = { green: 0, yellow: 1, red: 2 };
  const sorted = [...pending].sort((a, b) => order[a.tier] - order[b.tier] || (b.last_contact_date || "").localeCompare(a.last_contact_date || ""));
  const [items, setItems] = useState<Record<string, Item>>(() =>
    Object.fromEntries(sorted.map((c) => [c.id, { id: c.id, tier: c.tier, side: c.side, role: c.role, remove: false }])),
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const keep = Object.values(items).filter((i) => !i.remove).length;
  const set = (id: string, p: Partial<Item>) => setItems((x) => ({ ...x, [id]: { ...x[id], ...p } }));

  return (
    <div className="scrim" onClick={onClose}>
      <aside className="panel" role="dialog" aria-label="Review imported contacts" onClick={(e) => e.stopPropagation()}>
        <h2>
          Review contacts
          <button className="btn quiet" onClick={onClose}>
            Close
          </button>
        </h2>
        <p className="ok" style={{ marginTop: -6 }}>
          Colors and roles were suggested from your emails. Fix anything that's off, remove anyone who doesn't belong, then approve. Reminders go on your calendar after you approve.
        </p>
        {sorted.map((c) => {
          const it = items[c.id];
          return (
            <div key={c.id} className={`review-row ${it.remove ? "removed" : ""}`}>
              <TierPicker value={it.tier} label={c.name} onChange={(t) => set(c.id, { tier: t })} />
              <div>
                <div className="row-name">
                  {c.name} {c.company && <span className="row-meta">{c.company}</span>}
                </div>
                {c.last_contact_summary && <div className="row-rem">{c.last_contact_summary}</div>}
              </div>
              <div className="review-side" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <RoleSelect side={it.side} role={it.role} onChange={(side, role) => set(c.id, { side, role })} />
                <button className="btn quiet" onClick={() => set(c.id, { remove: !it.remove })} aria-label={it.remove ? `Keep ${c.name}` : `Remove ${c.name}`}>
                  {it.remove ? "Undo" : "Remove"}
                </button>
              </div>
            </div>
          );
        })}
        {err && <p className="err">{err}</p>}
        <div style={{ position: "sticky", bottom: -60, background: "var(--bg)", padding: "16px 0" }}>
          <button
            className="btn primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setErr("");
              try {
                await call("/api/review", "POST", { items: Object.values(items) });
                await onDone();
              } catch (e: any) {
                setErr(e.message);
                setBusy(false);
              }
            }}
          >
            {busy ? "Approving and setting reminders…" : `Approve ${keep}`}
          </button>
        </div>
      </aside>
    </div>
  );
}
