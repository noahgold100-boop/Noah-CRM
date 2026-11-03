"use client";
import { useState } from "react";
import type { Contact } from "@/lib/contacts";
import type { Side, Tier } from "@/lib/roles";
import { call, RoleSelect, TierPicker } from "./parts";

export default function AddContact({ defaultSide, onClose, onAdded }: { defaultSide: Side; onClose: () => void; onAdded: (c: Contact) => void }) {
  const [f, setF] = useState({ name: "", email: "", side: defaultSide, role: defaultSide === "Creative" ? "Producer" : "Manager", tier: "green" as Tier });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  return (
    <div className="scrim center" onClick={onClose}>
      <div className="dialog" role="dialog" aria-label="Add contact" onClick={(e) => e.stopPropagation()}>
        <h2>
          Add contact
          <button className="btn quiet" onClick={onClose}>
            Cancel
          </button>
        </h2>
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setErr("");
            try {
              const r = await call<{ contact: Contact }>("/api/contacts", "POST", f);
              onAdded(r.contact);
            } catch (e: any) {
              setErr(e.message);
              setBusy(false);
            }
          }}
        >
          <label>
            Name
            <input className="field" autoFocus required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </label>
          <label>
            Email
            <input className="field" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="Optional" />
          </label>
          <label>
            Role
            <RoleSelect side={f.side} role={f.role} onChange={(side, role) => setF({ ...f, side, role })} />
          </label>
          <label>
            Color
            <span style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--ink)" }}>
              <TierPicker value={f.tier} label="new contact" onChange={(tier) => setF({ ...f, tier })} />
              {f.tier === "green" ? "Keep talking. Reminder in 3 weeks." : f.tier === "yellow" ? "Potential lead. Reminder in 2 months." : "Not worth your time. No reminder."}
            </span>
          </label>
          {err && <p className="err">{err}</p>}
          <div>
            <button className="btn primary" disabled={busy}>
              {busy ? "Adding…" : "Add contact"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
