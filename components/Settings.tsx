"use client";
import { useState } from "react";
import { PROFILE_FIELDS } from "@/lib/profile-fields";
import { call } from "./parts";
import type { Status } from "./App";

export default function Settings({
  status,
  onClose,
  onChanged,
  onImport,
  importing,
}: {
  status: Status;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onImport: () => void;
  importing: boolean;
}) {
  const [profile, setProfile] = useState<Record<string, string>>(status.profile);
  const [saved, setSaved] = useState("");
  const [token, setToken] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");

  async function run(name: string, fn: () => Promise<void>) {
    setBusy(name);
    setMsg("");
    try {
      await fn();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy("");
    }
  }

  const lastRun = status.last_run?.at ? new Date(status.last_run.at).toLocaleString() : "Not yet";

  return (
    <div className="scrim" onClick={onClose}>
      <aside className="panel" role="dialog" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <h2>
          Settings
          <button className="btn quiet" onClick={onClose}>
            Close
          </button>
        </h2>

        <h3>Connections</h3>
        <div className="conn">
          <div>
            <div>Google</div>
            <div className="s">
              {status.google.connected ? `Gmail (read-only) and Calendar, as ${status.google.email}` : "Not connected. Email and reminders are paused."}
            </div>
          </div>
          <a className={`btn ${status.google.connected ? "" : "primary"}`} href="/api/auth/google">
            {status.google.connected ? "Reconnect" : "Connect Google"}
          </a>
        </div>
        <div className="conn">
          <div>
            <div>Calendly</div>
            <div className="s">{status.calendly.connected ? `Booked meetings are logged automatically (${status.calendly.name}).` : "Optional. Logs meetings people book with you."}</div>
          </div>
          {status.calendly.connected ? (
            <button className="btn" disabled={busy === "cal"} onClick={() => run("cal", async () => { await call("/api/settings", "DELETE"); await onChanged(); })}>
              Disconnect
            </button>
          ) : null}
        </div>
        {!status.calendly.connected && (
          <form
            className="form"
            style={{ marginTop: 10 }}
            onSubmit={(e) => {
              e.preventDefault();
              run("cal", async () => {
                await call("/api/settings", "POST", { calendly_token: token });
                setToken("");
                await onChanged();
              });
            }}
          >
            <label>
              Calendly token
              <input className="field" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Paste token" autoComplete="off" />
              <span className="hint">
                <a href="https://calendly.com/integrations/api_webhooks" target="_blank" rel="noreferrer">
                  Open Calendly
                </a>
                , choose Generate new token, copy it, and paste it here.
              </span>
            </label>
            <div>
              <button className="btn" disabled={!token || busy === "cal"}>
                {busy === "cal" ? "Connecting…" : "Connect Calendly"}
              </button>
            </div>
          </form>
        )}

        <h3>Email sync</h3>
        <div className="conn">
          <div>
            <div>Checks your email every morning</div>
            <div className="s">Last run: {lastRun}</div>
          </div>
          <button
            className="btn"
            disabled={!!busy || !status.google.connected}
            onClick={() =>
              run("sync", async () => {
                const r = await call<any>("/api/sync", "POST", { mode: "daily" });
                setMsg(r.skipped || `Done. Read ${r.scanned} threads, updated ${r.found} contacts.`);
                await onChanged();
              })
            }
          >
            {busy === "sync" ? "Syncing…" : "Sync now"}
          </button>
        </div>
        <div className="conn">
          <div>
            <div>Import the last 12 months</div>
            <div className="s">
              {status.backfill?.status === "done"
                ? `Done. Read ${status.backfill.scanned.toLocaleString()} threads.`
                : status.backfill?.status === "running"
                  ? "Partly done. It also continues each morning on its own."
                  : "Not started."}
            </div>
          </div>
          {status.backfill?.status !== "done" && (
            <button className="btn" disabled={importing || !status.google.connected} onClick={onImport}>
              {importing ? "Importing…" : status.backfill?.status === "running" ? "Continue" : "Start"}
            </button>
          )}
        </div>
        {msg && <p className={/^Done/.test(msg) ? "ok" : "err"}>{msg}</p>}
        {!!status.last_run?.errors?.length && <p className="err">Some reminders didn't update: {status.last_run.errors.join("; ")}</p>}

        <h3>About your work</h3>
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            run("profile", async () => {
              await call("/api/settings", "PUT", { profile });
              setSaved("Saved.");
              await onChanged();
            });
          }}
        >
          {PROFILE_FIELDS.map((f) => (
            <label key={f.key}>
              {f.label}
              {f.long ? (
                <textarea className="field" rows={4} value={profile[f.key] || ""} onChange={(e) => { setSaved(""); setProfile({ ...profile, [f.key]: e.target.value }); }} />
              ) : (
                <input className="field" value={profile[f.key] || ""} onChange={(e) => { setSaved(""); setProfile({ ...profile, [f.key]: e.target.value }); }} />
              )}
              {f.hint && <span className="hint">{f.hint}</span>}
            </label>
          ))}
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button className="btn primary" disabled={busy === "profile"}>
              {busy === "profile" ? "Saving…" : "Save"}
            </button>
            {saved && <span className="ok">{saved}</span>}
          </div>
        </form>

        <h3>Account</h3>
        <form method="post" action="/api/auth/logout">
          <button className="btn">Sign out</button>
        </form>
      </aside>
    </div>
  );
}
