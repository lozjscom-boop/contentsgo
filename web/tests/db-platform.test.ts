import { beforeAll, describe, expect, it } from "vitest";
import { as, createDb, rejects, signUp, type Db } from "./db-helper";

let db: Db;
let A: { id: string; ws: string };
let B: { id: string; ws: string };
const svc = (q: string, p: unknown[] = []) => as(db, "service_role", null, q, p);
const wallet = async (ws: string) =>
  (await db.query<{ available: number; reserved: number }>("select available::int available, reserved::int reserved from wallet_accounts where workspace_id=$1", [ws])).rows[0];
const recon = async (ws: string) => (await svc(`select * from public.svc_wallet_reconcile($1)`, [ws])).rows[0];

beforeAll(async () => {
  db = await createDb();
  A = await signUp(db, "a@x.com");
  B = await signUp(db, "b@x.com");
}, 60_000);

describe("플랜·권한·한도", () => {
  it("가입하면 체험 권한이 자동 부여된다", async () => {
    const p = (await svc(`select * from private.current_plan($1)`, [A.ws])).rows[0];
    expect(p.code).toBe("trial");
    expect(p.source).toBe("trial");
  });

  it("발행된 플랜 버전은 수정·삭제할 수 없다", async () => {
    expect(await rejects(() => db.query(`update plan_versions set price_krw = 1 where code='starter'`))).toMatch(/immutable/);
    expect(await rejects(() => db.query(`delete from plan_versions where code='starter'`))).toMatch(/cannot be deleted/);
  });

  it("체험 플랜은 브랜드 1개·제품 1개까지, 초과하면 DB가 거부한다", async () => {
    const q = (s: string, p: unknown[] = []) => as(db, "authenticated", B.id, s, p);
    const brand = (await q(`insert into brands(workspace_id,name) values ($1,'b1') returning id`, [B.ws])).rows[0].id;
    expect(await rejects(() => q(`insert into brands(workspace_id,name) values ($1,'b2')`, [B.ws]))).toMatch(/plan_limit_exceeded:brands/);
    await q(`insert into products(workspace_id,brand_id,name) values ($1,$2,'p1')`, [B.ws, brand]);
    expect(await rejects(() => q(`insert into products(workspace_id,brand_id,name) values ($1,$2,'p2')`, [B.ws, brand]))).toMatch(/plan_limit_exceeded:products/);
  });

  it("운영자가 플랜을 바꾸면 한도가 즉시 달라지고 이전 권한은 종료된다 (활성 권한은 항상 1개)", async () => {
    await svc(`select public.svc_set_plan($1,'growth','beta_admin','테스트',null)`, [B.ws]);
    const brand = (await db.query<{ id: string }>(`select id from brands where workspace_id=$1`, [B.ws])).rows[0].id;
    await as(db, "authenticated", B.id, `insert into products(workspace_id,brand_id,name) values ($1,$2,'p2')`, [B.ws, brand]);
    const active = await db.query(`select 1 from entitlements where workspace_id=$1 and status='active'`, [B.ws]);
    expect(active.rows.length).toBe(1);
    expect(await rejects(() => svc(`select public.svc_set_plan($1,'nope','beta_admin','x',null)`, [B.ws]))).toMatch(/plan_not_found/);
  });

  it("고객은 플랜/권한을 직접 바꿀 수 없다", async () => {
    expect(await rejects(() => as(db, "authenticated", A.id, `update entitlements set status='ended'`))).toMatch(/permission denied/i);
    expect(await rejects(() => as(db, "authenticated", A.id, `select public.svc_set_plan('${A.ws}','studio','beta_admin','x',null)`))).toMatch(/permission denied/i);
  });
});

describe("월 한도 카운터", () => {
  it("한도 안에서만 소비하고, 같은 요청 키는 한 번만 소비한다", async () => {
    const use = (k: string) => svc(`select public.svc_consume_allowance($1,'proposals',1,2,$2)`, [A.ws, k]);
    await use("r1");
    await use("r1"); // 재시도: 소비 없음
    await use("r2");
    expect(await rejects(() => use("r3"))).toMatch(/allowance_exceeded/);
    const c = (await db.query<{ used: string }>(`select used::int used from usage_counters where workspace_id=$1 and key='proposals'`, [A.ws])).rows[0];
    expect(Number(c.used)).toBe(2);
  });
});

describe("크레딧 버킷 (만료·소모 순서)", () => {
  it("만료가 빠른 버킷부터 소모한다", async () => {
    const C = await signUp(db, "c@x.com");
    await svc(`select public.svc_grant_credits($1,100,'forever','영구')`, [C.ws]);
    await svc(`select public.svc_grant_credits($1,50,'soon','곧 만료','trial', now() + interval '1 day')`, [C.ws]);
    await svc(`select public.svc_reserve_credits($1,60,'use1')`, [C.ws]);
    const b = (await db.query<{ grant_key: string; reserved: string }>(`select grant_key, reserved::int reserved from credit_buckets where workspace_id=$1 order by grant_key`, [C.ws])).rows;
    expect(Object.fromEntries(b.map((x) => [x.grant_key, Number(x.reserved)]))).toEqual({ forever: 10, soon: 50 });
    await svc(`select public.svc_settle_credits($1,'use1',60)`, [C.ws]);
    expect(await wallet(C.ws)).toEqual({ available: 90, reserved: 0 });
    expect((await recon(C.ws)).ok).toBe(true);
  });

  it("만료된 크레딧은 쓸 수 없고 EXPIRE 원장으로 소멸한다", async () => {
    const D = await signUp(db, "d@x.com");
    await svc(`select public.svc_grant_credits($1,30,'t1','체험','trial', now() + interval '1 day')`, [D.ws]);
    await db.query(`update credit_buckets set expires_at = now() - interval '1 minute' where workspace_id=$1`, [D.ws]);
    await svc(`select public.svc_expire_credits($1)`, [D.ws]);      // 스위퍼/지갑 조회 시 실행되는 정리
    expect(await wallet(D.ws)).toEqual({ available: 0, reserved: 0 });
    expect(await rejects(() => svc(`select public.svc_reserve_credits($1,10,'late')`, [D.ws]))).toMatch(/insufficient_credits/);
    const types = (await db.query<{ type: string }>(`select type from credit_ledger where workspace_id=$1 order by created_at, type`, [D.ws])).rows.map((r) => r.type);
    expect(types).toContain("EXPIRE");
    expect((await recon(D.ws)).ok).toBe(true);
  });

  it("예약 중 만료돼도 예약분은 정산 시점에 정리되고 장부가 맞는다", async () => {
    const E = await signUp(db, "e@x.com");
    await svc(`select public.svc_grant_credits($1,40,'t2','체험','trial', now() + interval '1 day')`, [E.ws]);
    await svc(`select public.svc_reserve_credits($1,30,'inflight')`, [E.ws]);
    await db.query(`update credit_buckets set expires_at = now() - interval '1 minute' where workspace_id=$1`, [E.ws]);
    await svc(`select public.svc_expire_credits($1)`, [E.ws]);           // 예약 안 된 10만 소멸
    expect(await wallet(E.ws)).toEqual({ available: 0, reserved: 30 });
    await svc(`select public.svc_settle_credits($1,'inflight',20)`, [E.ws]); // 20 차감, 10 해제 → 이미 만료라 즉시 소멸
    expect(await wallet(E.ws)).toEqual({ available: 0, reserved: 0 });
    expect((await recon(E.ws)).ok).toBe(true);
  });

  it("같은 지급 키는 한 번만 지급된다", async () => {
    const F = await signUp(db, "f@x.com");
    await svc(`select public.svc_grant_credits($1,100,'dup','x')`, [F.ws]);
    await svc(`select public.svc_grant_credits($1,100,'dup','x')`, [F.ws]);
    expect(await wallet(F.ws)).toEqual({ available: 100, reserved: 0 });
  });

  it("회수는 사용하지 않은 잔량 범위 안에서만 가능하다", async () => {
    const G = await signUp(db, "g@x.com");
    await svc(`select public.svc_grant_credits($1,100,'promo','프로모','beta_grant')`, [G.ws]);
    await svc(`select public.svc_reserve_credits($1,70,'busy')`, [G.ws]);
    const bucket = (await db.query<{ id: string }>(`select id from credit_buckets where workspace_id=$1`, [G.ws])).rows[0].id;
    expect(await rejects(() => svc(`select public.svc_revoke_credits($1,$2,50,'rv1','회수')`, [G.ws, bucket]))).toMatch(/revoke_exceeds_unused/);
    await svc(`select public.svc_revoke_credits($1,$2,30,'rv2','회수')`, [G.ws, bucket]);
    expect(await wallet(G.ws)).toEqual({ available: 0, reserved: 70 });
    expect((await recon(G.ws)).ok).toBe(true);
  });

  it("체험 지급은 계정당 1회만 된다", async () => {
    const H = await signUp(db, "h@x.com");
    const t = () => svc(`select public.svc_claim_trial($1,$2,30,7) as ok`, [H.ws, H.id]);
    expect((await t()).rows[0].ok).toBe(true);
    expect((await t()).rows[0].ok).toBe(false);
    expect(await wallet(H.ws)).toEqual({ available: 30, reserved: 0 });
    // 소유자가 아닌 사용자의 청구는 거부
    expect(await rejects(() => svc(`select public.svc_claim_trial($1,$2,30,7)`, [H.ws, A.id]))).toMatch(/not_workspace_owner/);
  });
});

describe("작업 큐", () => {
  let J: { id: string; ws: string };
  beforeAll(async () => {
    J = await signUp(db, "j@x.com");
    await svc(`select public.svc_grant_credits($1,1000,'j-grant','x')`, [J.ws]);
    await svc(`select public.svc_set_plan($1,'growth','beta_admin','t',null)`, [J.ws]); // concurrent 2, pending 15
  });
  const enqueue = (ws: string, key: string, payload: object = { a: 1 }, credits = 30) =>
    svc(`select * from public.svc_enqueue_job($1,'analysis',null,$2,$3::jsonb,$4)`, [ws, key, JSON.stringify(payload), credits]);

  it("접수는 예약+작업 생성이 한 번에 일어나고, 같은 키는 중복 생성되지 않는다", async () => {
    const r1 = (await enqueue(J.ws, "k1")).rows[0];
    expect(r1.created).toBe(true);
    const r2 = (await enqueue(J.ws, "k1")).rows[0];
    expect(r2.created).toBe(false);
    expect(r2.job_id).toBe(r1.job_id);
    expect(await wallet(J.ws)).toEqual({ available: 970, reserved: 30 });
  });

  it("같은 키에 다른 내용이면 충돌(idempotency_conflict)", async () => {
    expect(await rejects(() => enqueue(J.ws, "k1", { a: 2 }))).toMatch(/idempotency_conflict/);
  });

  it("잔액이 부족하면 작업도 만들어지지 않는다", async () => {
    const before = (await db.query(`select count(*)::int c from jobs where workspace_id=$1`, [J.ws])).rows[0].c;
    expect(await rejects(() => enqueue(J.ws, "big", { a: 3 }, 999999))).toMatch(/insufficient_credits/);
    expect((await db.query(`select count(*)::int c from jobs where workspace_id=$1`, [J.ws])).rows[0].c).toBe(before);
  });

  it("claim은 워크스페이스 동시성 상한(플랜)을 지키고, 임대된 작업은 다시 잡히지 않는다", async () => {
    await enqueue(J.ws, "k2", { n: 2 }); await enqueue(J.ws, "k3", { n: 3 }); await enqueue(J.ws, "k4", { n: 4 });
    const got = (await svc(`select * from public.svc_claim_jobs('w1', 10, 300, 2, 10)`)).rows;
    expect(got.length).toBe(2);                                    // growth: concurrent 2
    const again = (await svc(`select * from public.svc_claim_jobs('w2', 10, 300, 2, 10)`)).rows;
    expect(again.length).toBe(0);                                  // 이미 2개 실행 중
    expect(got.every((r) => r.locked_by === 'w1' && Number(r.attempts) === 1)).toBe(true);
  });

  it("완료는 정산과 상태 변경을 함께 하고, 임대를 잃은 워커는 아무것도 못 바꾼다", async () => {
    const running = (await db.query<{ id: string; locked_by: string }>(`select id, locked_by from jobs where workspace_id=$1 and status='running' limit 1`, [J.ws])).rows[0];
    const before = await wallet(J.ws);
    const wrong = (await svc(`select public.svc_complete_job($1,'intruder','ready',30) as ok`, [running.id])).rows[0].ok;
    expect(wrong).toBe(false);
    expect(await wallet(J.ws)).toEqual(before);
    const ok = (await svc(`select public.svc_complete_job($1,$2,'ready',30) as ok`, [running.id, running.locked_by])).rows[0].ok;
    expect(ok).toBe(true);
    expect((await wallet(J.ws)).reserved).toBe(before.reserved - 30);
    // 이미 끝난 작업에 다시 완료를 시도해도 이중 차감이 없다
    expect((await svc(`select public.svc_complete_job($1,$2,'ready',30) as ok`, [running.id, running.locked_by])).rows[0].ok).toBe(false);
    expect((await recon(J.ws)).ok).toBe(true);
  });

  it("실패 완료는 크레딧을 전액 복구한다", async () => {
    const running = (await db.query<{ id: string; locked_by: string }>(`select id, locked_by from jobs where workspace_id=$1 and status='running' limit 1`, [J.ws])).rows[0];
    const before = await wallet(J.ws);
    await svc(`select public.svc_complete_job($1,$2,'failed',0,'boom')`, [running.id, running.locked_by]);
    expect(await wallet(J.ws)).toEqual({ available: before.available + 30, reserved: before.reserved - 30 });
    expect((await recon(J.ws)).ok).toBe(true);
  });

  it("재시도는 횟수 한도 안에서만 큐로 되돌리고, 소진하면 실패 처리해 크레딧을 복구한다", async () => {
    const K = await signUp(db, "k@x.com");
    await svc(`select public.svc_grant_credits($1,100,'k-grant','x')`, [K.ws]);
    await enqueue(K.ws, "r1");
    let j = (await svc(`select * from public.svc_claim_jobs('w', 5, 300, 2, 10)`)).rows.find((r) => r.workspace_id === K.ws)!;
    expect((await svc(`select public.svc_retry_job($1,'w',0,'tmp') as s`, [j.id])).rows[0].s).toBe("queued");
    j = (await svc(`select * from public.svc_claim_jobs('w', 5, 300, 2, 10)`)).rows.find((r) => r.workspace_id === K.ws)!;
    expect(Number(j.attempts)).toBe(2);
    expect((await svc(`select public.svc_retry_job($1,'w',0,'tmp') as s`, [j.id])).rows[0].s).toBe("failed");
    expect(await wallet(K.ws)).toEqual({ available: 100, reserved: 0 });
  });

  it("임대가 만료되면: 외부 제출 흔적이 없으면 큐로, 있으면 provider_unknown(재실행 금지)", async () => {
    const L = await signUp(db, "l@x.com");
    await svc(`select public.svc_grant_credits($1,200,'l-grant','x')`, [L.ws]);
    await svc(`select public.svc_set_plan($1,'growth','beta_admin','t',null)`, [L.ws]);
    const a = (await enqueue(L.ws, "s1", { n: 1 })).rows[0].job_id;
    const b = (await enqueue(L.ws, "s2", { n: 2 })).rows[0].job_id;
    await svc(`select * from public.svc_claim_jobs('w', 10, 300, 2, 10)`);
    await db.query(`update jobs set lease_until = now() - interval '1 minute' where id in ($1,$2)`, [a, b]);
    await db.query(`insert into generation_attempts(workspace_id, job_id, attempt_no, provider, model_id) values ($1,$2,1,'gemini','m')`, [L.ws, b]);
    const r = (await svc(`select * from public.svc_sweep_jobs()`)).rows[0];
    expect(Number(r.requeued)).toBeGreaterThanOrEqual(1);
    expect(Number(r.unknown)).toBeGreaterThanOrEqual(1);
    const st = Object.fromEntries((await db.query<{ id: string; status: string }>(`select id, status from jobs where id in ($1,$2)`, [a, b])).rows.map((x) => [x.id, x.status]));
    expect(st[a]).toBe("queued");
    expect(st[b]).toBe("provider_unknown");
    // 운영자 복구: 확인 결과 실패 → 크레딧 전액 복구
    const before = await wallet(L.ws);
    await svc(`select public.svc_resolve_unknown_job($1,'failed','공급사 대조: 미접수')`, [b]);
    expect((await wallet(L.ws)).available).toBe(before.available + 30);
    expect((await recon(L.ws)).ok).toBe(true);
  });

  it("플랜의 미완료 작업 상한을 넘으면 접수하지 않는다", async () => {
    const M = await signUp(db, "m@x.com"); // trial: pending 1
    await svc(`select public.svc_grant_credits($1,500,'m-grant','x')`, [M.ws]);
    await enqueue(M.ws, "p1", { n: 1 });
    expect(await rejects(() => enqueue(M.ws, "p2", { n: 2 }))).toMatch(/too_many_pending/);
  });

  it("전역 동시 실행 상한(공급사 쿼터 보호)을 지킨다", async () => {
    const N = await signUp(db, "n@x.com");
    await svc(`select public.svc_grant_credits($1,500,'n-grant','x')`, [N.ws]);
    await svc(`select public.svc_set_plan($1,'studio','beta_admin','t',null)`, [N.ws]);
    for (let i = 0; i < 4; i++) await enqueue(N.ws, `g${i}`, { i });
    const running = Number((await db.query(`select count(*)::int c from jobs where status='running' and lease_until > now()`)).rows[0].c);
    const got = (await svc(`select * from public.svc_claim_jobs('w', 10, 300, 4, $1)`, [running + 1])).rows;
    expect(got.length).toBe(1);
  });

  it("고객은 큐 함수를 호출할 수 없다", async () => {
    for (const call of [
      `select * from public.svc_claim_jobs('x', 1)`,
      `select * from public.svc_enqueue_job('${A.ws}','analysis',null,'z','{}'::jsonb,1)`,
      `select public.svc_complete_job('00000000-0000-0000-0000-000000000000','x','ready',1)`,
    ]) {
      expect(await rejects(() => as(db, "authenticated", A.id, call))).toMatch(/permission denied/i);
    }
  });
});

describe("목록 projection", () => {
  it("장면이 완성되면 제작물의 진행 수와 대표 이미지가 갱신된다", async () => {
    const P = await signUp(db, "p@x.com");
    const q = (s: string, p: unknown[] = []) => as(db, "authenticated", P.id, s, p);
    const brand = (await q(`insert into brands(workspace_id,name) values ($1,'b') returning id`, [P.ws])).rows[0].id;
    const prod = (await q(`insert into products(workspace_id,brand_id,name) values ($1,$2,'p') returning id`, [P.ws, brand])).rows[0].id;
    const proj = (await q(`insert into projects(workspace_id,brand_id,product_id,title) values ($1,$2,$3,'t') returning id`, [P.ws, brand, prod])).rows[0].id;
    const d = (await q(`insert into deliverables(workspace_id,project_id,type) values ($1,$2,'carousel') returning id`, [P.ws, proj])).rows[0].id;
    expect((await db.query(`select deliverable_count c from projects where id=$1`, [proj])).rows[0].c).toBe(1);
    const v = (await q(`insert into creative_versions(workspace_id,deliverable_id,version,document_json) values ($1,$2,1,'{}') returning id`, [P.ws, d])).rows[0].id;
    await q(`update deliverables set current_version_id=$1 where id=$2`, [v, d]);
    const s1 = (await q(`insert into scenes(workspace_id,creative_version_id,scene_key,role) values ($1,$2,'s1','hook') returning id`, [P.ws, v])).rows[0].id;
    await q(`insert into scenes(workspace_id,creative_version_id,scene_key,role) values ($1,$2,'s2','body')`, [P.ws, v]);
    let row = (await db.query(`select scene_total, scene_ready, cover_asset_id from deliverables where id=$1`, [d])).rows[0];
    expect([row.scene_total, row.scene_ready, row.cover_asset_id]).toEqual([2, 0, null]);
    const asset = (await svc(`insert into assets(workspace_id,kind,object_key,mime,bytes,status) values ($1,'generated_image',$2,'image/png',1,'ready') returning id`, [P.ws, `${P.ws}/x.png`])).rows[0].id;
    await svc(`update scenes set asset_id=$1, status='ready' where id=$2`, [asset, s1]);
    row = (await db.query(`select scene_total, scene_ready, cover_asset_id from deliverables where id=$1`, [d])).rows[0];
    expect([row.scene_total, row.scene_ready, row.cover_asset_id]).toEqual([2, 1, asset]);
    expect((await db.query(`select thumbnail_asset_id t from projects where id=$1`, [proj])).rows[0].t).toBe(asset);
  });
});

describe("운영자·감사·문의·알림", () => {
  it("일반 사용자는 운영자 권한을 만들거나 볼 수 없다", async () => {
    expect(await rejects(() => as(db, "authenticated", A.id, `insert into platform_admin_roles(user_id, role) values ('${A.id}','owner')`))).toMatch(/permission denied/i);
    await svc(`insert into platform_admin_roles(user_id, role) values ($1,'support')`, [B.id]);
    expect((await as(db, "authenticated", B.id, `select count(*)::int c from platform_admin_roles`)).rows[0].c).toBe(1);
    expect((await as(db, "authenticated", A.id, `select count(*)::int c from platform_admin_roles`)).rows[0].c).toBe(0);
    expect((await as(db, "authenticated", B.id, `select private.is_platform_admin(array['support']) ok`)).rows[0].ok).toBe(true);
    expect((await as(db, "authenticated", B.id, `select private.is_platform_admin(array['owner']) ok`)).rows[0].ok).toBe(false);
    expect((await as(db, "authenticated", A.id, `select private.is_platform_admin() ok`)).rows[0].ok).toBe(false);
  });

  it("감사 로그는 수정·삭제할 수 없다", async () => {
    await svc(`insert into audit_events(workspace_id, actor_kind, action) values ($1,'admin','test')`, [A.ws]);
    expect(await rejects(() => db.query(`update audit_events set action='x'`))).toMatch(/append-only/);
    expect(await rejects(() => db.query(`delete from audit_events`))).toMatch(/append-only/);
  });

  it("문의: 작성자만 보고, 내부 메모는 고객에게 보이지 않으며, 고객 답변은 티켓을 다시 연다", async () => {
    const q = (uid: string, s: string, p: unknown[] = []) => as(db, "authenticated", uid, s, p);
    const t = (await q(A.id, `insert into support_tickets(workspace_id,category,subject) values ($1,'quality','결과가 이상해요') returning id`, [A.ws])).rows[0].id;
    expect(await rejects(() => q(B.id, `insert into support_tickets(workspace_id,category,subject) values ($1,'quality','침투')`, [A.ws]))).not.toBeNull();
    expect((await q(B.id, `select count(*)::int c from support_tickets`)).rows[0].c).toBe(0);
    await q(A.id, `insert into support_messages(ticket_id,author_id,author_kind,body) values ($1,$2,'customer','첫 문의')`, [t, A.id]);
    await svc(`insert into support_messages(ticket_id,author_kind,visibility,body) values ($1,'staff','internal','내부 메모')`, [t]);
    await svc(`insert into support_messages(ticket_id,author_kind,visibility,body) values ($1,'staff','customer','답변드립니다')`, [t]);
    const seen = (await q(A.id, `select body from support_messages where ticket_id=$1 order by created_at`, [t])).rows.map((r) => r.body);
    expect(seen).toEqual(["첫 문의", "답변드립니다"]);
    expect((await db.query(`select status from support_tickets where id=$1`, [t])).rows[0].status).toBe("waiting_customer");
    await q(A.id, `insert into support_messages(ticket_id,author_id,author_kind,body) values ($1,$2,'customer','추가 질문')`, [t, A.id]);
    expect((await db.query(`select status from support_tickets where id=$1`, [t])).rows[0].status).toBe("open");
    // 고객이 staff 메시지/내부 메모를 직접 쓸 수 없다
    expect(await rejects(() => q(A.id, `insert into support_messages(ticket_id,author_id,author_kind,body) values ($1,$2,'staff','나는 직원')`, [t, A.id]))).not.toBeNull();
    expect(await rejects(() => q(A.id, `insert into support_messages(ticket_id,author_id,author_kind,visibility,body) values ($1,$2,'customer','internal','숨김')`, [t, A.id]))).not.toBeNull();
  });

  it("알림은 본인 것만 보이고 같은 사건은 한 번만 만들어진다", async () => {
    await svc(`select public.svc_notify($1,$2,'job:1:done','success','완료','본문',null)`, [A.id, A.ws]);
    await svc(`select public.svc_notify($1,$2,'job:1:done','success','완료','본문',null)`, [A.id, A.ws]);
    expect((await as(db, "authenticated", A.id, `select count(*)::int c from notifications`)).rows[0].c).toBe(1);
    expect((await as(db, "authenticated", B.id, `select count(*)::int c from notifications`)).rows[0].c).toBe(0);
    await as(db, "authenticated", A.id, `update notifications set read_at = now()`);
    expect(await rejects(() => as(db, "authenticated", A.id, `update notifications set title = '변조'`))).toMatch(/permission denied/i);
  });

  it("사이트 설정은 고객이 읽거나 바꿀 수 없다", async () => {
    expect(await rejects(() => as(db, "authenticated", A.id, `select * from site_settings`))).toMatch(/permission denied/i);
    expect((await svc(`select value_json from site_settings where key='trial'`)).rows[0].value_json.credits).toBe(30);
  });
});

describe("팀 초대·권한", () => {
  const hash = (s: string) => `h-${s}`;
  it("초대는 좌석 한도를 지키고(체험은 1석), 플랜을 올리면 가능하다", async () => {
    const T = await signUp(db, "t@x.com");
    expect(await rejects(() => svc(`select public.svc_create_invitation($1,'new@x.com','editor',$2,$3)`, [T.ws, hash("a"), T.id]))).toMatch(/plan_limit_exceeded:seats/);
    await svc(`select public.svc_set_plan($1,'growth','beta_admin','t',null)`, [T.ws]);
    await svc(`select public.svc_create_invitation($1,'new@x.com','editor',$2,$3)`, [T.ws, hash("a"), T.id]);
    // 같은 이메일 중복 초대 불가
    expect(await rejects(() => svc(`select public.svc_create_invitation($1,'new@x.com','viewer',$2,$3)`, [T.ws, hash("b"), T.id]))).toMatch(/unique|duplicate/i);
  });

  it("수락: 로그인 이메일이 초대와 같아야 하고, 한 번만 수락된다", async () => {
    const T = await signUp(db, "owner2@x.com");
    await svc(`select public.svc_set_plan($1,'growth','beta_admin','t',null)`, [T.ws]);
    await svc(`select public.svc_create_invitation($1,'mate@x.com','editor',$2,$3)`, [T.ws, hash("m"), T.id]);
    const mate = await signUp(db, "mate@x.com");
    expect(await rejects(() => svc(`select public.svc_accept_invitation($1,$2,'other@x.com')`, [hash("m"), mate.id]))).toMatch(/invitation_email_mismatch/);
    await svc(`select public.svc_accept_invitation($1,$2,'mate@x.com')`, [hash("m"), mate.id]);
    expect((await db.query(`select role from memberships where workspace_id=$1 and user_id=$2`, [T.ws, mate.id])).rows[0].role).toBe("editor");
    expect(await rejects(() => svc(`select public.svc_accept_invitation($1,$2,'mate@x.com')`, [hash("m"), mate.id]))).toMatch(/invitation_not_pending/);
    expect(await rejects(() => svc(`select public.svc_accept_invitation('nope',$1,'mate@x.com')`, [mate.id]))).toMatch(/invitation_not_found/);
  });

  it("만료된 초대는 수락할 수 없다", async () => {
    const T = await signUp(db, "owner3@x.com");
    await svc(`select public.svc_set_plan($1,'growth','beta_admin','t',null)`, [T.ws]);
    await svc(`select public.svc_create_invitation($1,'late@x.com','viewer',$2,$3)`, [T.ws, hash("l"), T.id]);
    await db.query(`update invitations set expires_at = now() - interval '1 minute' where token_hash=$1`, [hash("l")]);
    const late = await signUp(db, "late@x.com");
    expect(await rejects(() => svc(`select public.svc_accept_invitation($1,$2,'late@x.com')`, [hash("l"), late.id]))).toMatch(/invitation_expired/);
  });

  it("마지막 owner는 퇴출·강등할 수 없고, admin은 owner를 건드릴 수 없다", async () => {
    const T = await signUp(db, "owner4@x.com");
    await svc(`select public.svc_set_plan($1,'growth','beta_admin','t',null)`, [T.ws]);
    expect(await rejects(() => svc(`select public.svc_change_member($1,$2,$3,null,true)`, [T.ws, T.id, T.id]))).toMatch(/last_owner/);
    const adm = await signUp(db, "adm@x.com");
    await db.query(`insert into memberships(workspace_id,user_id,role) values ($1,$2,'admin')`, [T.ws, adm.id]);
    expect(await rejects(() => svc(`select public.svc_change_member($1,$2,$3,null,true)`, [T.ws, T.id, adm.id]))).toMatch(/forbidden/);
    await svc(`select public.svc_change_member($1,$2,$3,'viewer',false)`, [T.ws, adm.id, T.id]);
    expect((await db.query(`select role from memberships where workspace_id=$1 and user_id=$2`, [T.ws, adm.id])).rows[0].role).toBe("viewer");
    // 역할을 owner로 올리는 것은 이 경로로 불가
    expect(await rejects(() => svc(`select public.svc_change_member($1,$2,$3,'owner',false)`, [T.ws, adm.id, T.id]))).toMatch(/invalid_role/);
  });
});
