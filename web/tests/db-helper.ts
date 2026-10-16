import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";

const MIGRATIONS = path.resolve(__dirname, "../../supabase/migrations");

/** Supabase 환경(roles, auth.users, auth.uid())을 흉내낸 로컬 Postgres에 마이그레이션을 순서대로 적용한다. */
export async function createDb() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    grant usage on schema public to authenticated, anon, service_role;
  `);
  for (const f of fs.readdirSync(MIGRATIONS).filter((x) => x.endsWith(".sql")).sort()) {
    if (f.includes("supabase_only")) continue; // storage 스키마 등 Supabase 전용 마이그레이션은 로컬 검증에서 제외
    await db.exec(fs.readFileSync(path.join(MIGRATIONS, f), "utf8"));
  }
  return db;
}

export type Db = Awaited<ReturnType<typeof createDb>>;

/** 해당 역할/사용자로 쿼리를 실행한다 (RLS·권한이 실제로 적용되는 경로) */
export async function as(db: Db, role: "authenticated" | "anon" | "service_role", uid: string | null, q: string, params: unknown[] = []) {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${uid ?? ""}',false);`);
  try {
    return await db.query<Record<string, unknown>>(q, params);
  } finally {
    await db.exec("reset role;");
  }
}

export async function signUp(db: Db, email: string) {
  const id = (await db.query<{ id: string }>(`insert into auth.users(email) values ($1) returning id`, [email])).rows[0].id;
  const ws = (await db.query<{ id: string }>(`select id from workspaces where owner_id=$1`, [id])).rows[0].id;
  return { id, ws };
}

export async function rejects(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return String((e as Error).message ?? e);
  }
}
