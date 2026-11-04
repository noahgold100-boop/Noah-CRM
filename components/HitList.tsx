"use client";
import { useState } from "react";
import type { HitEntry } from "@/lib/hitlist";
import { HIT_PRIORITIES, type HitPriority } from "@/lib/roles";
import { call } from "./parts";
import type { Status } from "./App";

const CATEGORY_LABELS = ["producers and production companies", "development and studio executives", "managers and agents", "financiers and film funds", "festival, lab and fellowship champions"];
const GROUP_NOTES: Record<HitPriority, string> = {
  very_important: "They've shown interest. These are also in your contacts as Green.",
  warm: "There's a path in through someone you already know.",
  long_shot: "Reach out once you hit the milestone listed.",
};

export default function HitList({
  hits,
  setHits,
  status,
  onSettings,
  onChanged,
}: {
  hits: HitEntry[];
  setHits: (h: HitEntry[]) => void;
  status: Status;
  onSettings: () => void;
  onChanged: () => Promise<void>;
}) {
  const [building, setBuilding] = useState(false);
  const [progress, setProgress] = useState("");
  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");
  const unfinished = status.build?.status === "running";

  async function rebuild() {
    if (!confirm("Replace the hit list with a fresh search based on your current details? Anyone marked Very important stays.")) return;
    setBuilding(true);
    setErr("");
    try {
      const r = await call<{ hits: HitEntry[] }>("/api/hitlist", "POST", { rebuild: true });
      setHits(r.hits);
    } catch (e: any) {
      setErr(e.message);
      setBuilding(false);
      return;
    }
    await build(0);
  }

  async function build(fromStep?: number) {
    setBuilding(true);
    setErr("");
    try {
      const start = fromStep ?? (status.build?.status === "running" ? status.build.step : 0);
      for (let i = 0; i < 8; i++) {
        const step = start + i;
        setProgress(`Researching ${CATEGORY_LABELS[Math.min(step, 4)]} (${Math.min(step + 1, 5)} of 5). Each step takes a minute or two.`);
        const r = await call<{ state: { status: string; step: number; error?: string }; hits: HitEntry[] }>("/api/hitlist", "POST");
        setHits(r.hits);
        if (r.state.error) throw new Error(`${r.state.error} You can press Continue to retry.`);
        if (r.state.status === "done") break;
      }
      await onChanged();
    } catch (e: any) {
      setErr(e.message);
      await onChanged();
    } finally {
      setBuilding(false);
      setProgress("");
    }
  }

  async function changePriority(h: HitEntry, priority: HitPriority) {
    setHits(hits.map((x) => (x.id === h.id ? { ...x, priority } : x)));
    try {
      await call(`/api/hitlist/${h.id}`, "PATCH", { priority });
      if (priority === "very_important") await onChanged();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function remove(h: HitEntry) {
    if (!confirm(`Remove ${h.name} from the hit list?`)) return;
    setHits(hits.filter((x) => x.id !== h.id));
    await call(`/api/hitlist/${h.id}`, "DELETE");
  }

  if (!hits.length) {
    return (
      <div className="empty">
        <p>
          A researched list of producers, executives, managers and financiers who fit your work and could buy or back your scripts later on. Every name is checked against current trade sources.
        </p>
        {!status.profile_filled ? (
          <>
            <p>Add your scripts and credits first so the research fits you.</p>
            <button className="btn primary" onClick={onSettings}>
              Tell the CRM about your work
            </button>
          </>
        ) : (
          <button className="btn primary" disabled={building} onClick={() => build()}>
            {building ? "Building…" : unfinished ? "Continue building" : "Build hit list"}
          </button>
        )}
        {progress && <p className="ok">{progress}</p>}
        {err && <p className="err">{err}</p>}
      </div>
    );
  }

  const needle = search.trim().toLowerCase();
  const shown = hits.filter((h) => !needle || [h.name, h.company, h.role, h.why].some((v) => v && v.toLowerCase().includes(needle)));

  return (
    <>
      <div className="toolbar">
        <input className="field search" type="search" placeholder="Search the hit list" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search the hit list" />
        {unfinished ? (
          <button className="btn" disabled={building} onClick={() => build()}>
            {building ? "Building…" : "Continue building"}
          </button>
        ) : (
          <button className="btn" disabled={building} onClick={rebuild}>
            {building ? "Building…" : "Rebuild list"}
          </button>
        )}
      </div>
      {progress && <p className="ok">{progress}</p>}
      {err && <p className="err">{err}</p>}
      {HIT_PRIORITIES.map((p) => {
        const items = shown.filter((h) => h.priority === p.id);
        if (!items.length) return null;
        return (
          <section className="group" key={p.id}>
            <div className="group-h" style={{ cursor: "default" }}>
              {p.label} <span className="n">{items.length}</span>
            </div>
            <p className="row-meta" style={{ margin: "-4px 0 8px" }}>
              {GROUP_NOTES[p.id]}
            </p>
            <div className="list">
              {items.map((h) => (
                <article className="row hit" key={h.id}>
                  <div className="row-main">
                    <div>
                      <div className="row-name">
                        {h.name}
                        <span className="row-meta">{[h.role, h.company].filter(Boolean).join(", ")}</span>
                      </div>
                      {h.why && <div className="row-sum">{h.why}</div>}
                      <dl>
                        {h.typical_scale && (
                          <>
                            <dt>Works at</dt>
                            <dd>{h.typical_scale}</dd>
                          </>
                        )}
                        {h.notable_work?.length > 0 && (
                          <>
                            <dt>Known for</dt>
                            <dd>{h.notable_work.join(", ")}</dd>
                          </>
                        )}
                        {h.path_in && (
                          <>
                            <dt>Way in</dt>
                            <dd>{h.path_in}</dd>
                          </>
                        )}
                        {h.reach_out_when && (
                          <>
                            <dt>Reach out</dt>
                            <dd>{h.reach_out_when}</dd>
                          </>
                        )}
                      </dl>
                      <div className="sources">
                        {h.sources.map((s) => (
                          <a key={s.url} href={s.url} target="_blank" rel="noreferrer">
                            {s.title}
                          </a>
                        ))}
                        <button className="btn quiet" style={{ padding: "0 4px", fontSize: 12.5 }} onClick={() => remove(h)}>
                          Remove
                        </button>
                      </div>
                    </div>
                    <select className={`prio ${h.priority}`} value={h.priority} onChange={(e) => changePriority(h, e.target.value as HitPriority)} aria-label={`Priority for ${h.name}`}>
                      {HIT_PRIORITIES.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}
