import { neon } from "@neondatabase/serverless";
import { env } from "./env";

type Row = Record<string, any>;

let _sql: ReturnType<typeof neon> | null = null;
function sql() {
  if (!_sql) _sql = neon(env.databaseUrl);
  return _sql;
}

let schemaReady: Promise<void> | null = null;

const SCHEMA = [
  `create table if not exists settings (
     key text primary key,
     value jsonb not null,
     updated_at timestamptz not null default now()
   )`,
  `create table if not exists contacts (
     id uuid primary key default gen_random_uuid(),
     name text not null,
     emails text[] not null default '{}',
     phone text,
     side text not null default 'Creative',
     role text not null default 'Other',
     company text,
     tier text not null default 'yellow',
     status text not null default 'active',
     tier_locked boolean not null default false,
     last_contact_date date,
     last_contact_summary text,
     remember text,
     next_followup_date date,
     calendar_event_id text,
     calendar_dirty boolean not null default true,
     gmail_thread_id text,
     source text not null default 'Manual',
     hit_list_id uuid,
     created_at timestamptz not null default now(),
     updated_at timestamptz not null default now()
   )`,
  `create index if not exists contacts_emails_idx on contacts using gin (emails)`,
  `create table if not exists processed_threads (
     thread_id text primary key,
     last_message_id text not null,
     processed_at timestamptz not null default now()
   )`,
  `create table if not exists hit_list (
     id uuid primary key default gen_random_uuid(),
     name text not null,
     role text,
     company text,
     category text,
     why text,
     typical_scale text,
     notable_work text[] not null default '{}',
     path_in text,
     reach_out_when text,
     priority text not null default 'long_shot',
     sources jsonb not null default '[]',
     contact_id uuid,
     verified_at timestamptz not null default now(),
     created_at timestamptz not null default now()
   )`,
];

export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      for (const stmt of SCHEMA) await sql().query(stmt);
    })().catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  return schemaReady;
}

/** Parameterized query. Always use $1, $2… placeholders — never interpolate values. */
export async function q<T extends Row = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  await ensureSchema();
  return (await sql().query(text, params as any[])) as unknown as T[];
}

export async function getSetting<T = any>(key: string): Promise<T | null> {
  const rows = await q<{ value: T }>(`select value from settings where key = $1`, [key]);
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await q(
    `insert into settings (key, value, updated_at) values ($1, $2::jsonb, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}

export async function deleteSetting(key: string): Promise<void> {
  await q(`delete from settings where key = $1`, [key]);
}

/** Simple lease lock so a cron run and a manual sync never overlap. */
export async function acquireLock(name: string, seconds: number): Promise<boolean> {
  const key = `lock:${name}`;
  const until = new Date(Date.now() + seconds * 1000).toISOString();
  const rows = await q(
    `insert into settings (key, value, updated_at) values ($1, jsonb_build_object('until', $2::text), now())
     on conflict (key) do update set value = excluded.value, updated_at = now()
       where (settings.value->>'until')::timestamptz < now()
     returning key`,
    [key, until],
  );
  return rows.length > 0;
}

export async function releaseLock(name: string): Promise<void> {
  await deleteSetting(`lock:${name}`);
}
