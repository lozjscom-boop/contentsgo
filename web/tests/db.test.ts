import { beforeAll, describe, expect, it } from "vitest";
import { as, createDb, rejects, signUp, type Db } from "./db-helper";

let db: Db;
let A: { id: string; ws: string };
let B: { id: string; ws: string };

beforeAll(async () => {
  db = await createDb();
  A = await signUp(db, "a@x.com");
  B = await signUp(db, "b@x.com");
}, 60_000);

const wallet = async (ws: string) =>
  (await db.query<{ available: number; reserved: number }>("select available::int available, reserved::int reserved from wallet_accounts where workspace_id=$1", [ws])).rows[0];
const svc = (q: string, p: unknown[] = []) => as(db, "service_role", null, q, p);

describe("가입 / 테넌트 격리 (RLS)", () => {
  it("가입하면 워크스페이스·멤버십·지갑이 자동 생성된다", async () => {
    expect(A.ws).toBeTruthy();
    expect((await wallet(A.ws)).available).toBe(0);
    const m = await db.query("select role from memberships where workspace_id=$1 and user_id=$2", [A.ws, A.id]);
    expect(m.rows[0]).toEqual({ role: "owner" });
  });

  it("다른 사용자의 데이터는 보이지 않고 쓸 수도 없다", async () => {
    const brand = (await as(db, "authenticated", A.id, `insert into brands(workspace_id,name) values ($1,'르오즈') returning id`, [A.ws])).rows[0].id;
    expect((await as(db, "authenticated", B.id, "select count(*)::int c from brands")).rows[0].c).toBe(0);
    expect(await rejects(() => as(db, "authenticated", B.id, `insert into brands(workspace_id,name) values ($1,'침투')`, [A.ws]))).not.toBeNull();
    expect(brand).toBeTruthy();
  });

  it("복합 FK: 다른 워크스페이스의 제품을 내 프로젝트에 연결할 수 없다", async () => {
    const brandA = (await as(db, "authenticated", A.id, `select id from brands where workspace_id=$1`, [A.ws])).rows[0].id;
    const prodA = (await as(db, "authenticated", A.id, `insert into products(workspace_id,brand_id,name) values ($1,$2,'고체향수') returning id`, [A.ws, brandA])).rows[0].id;
    const brandB = (await as(db, "authenticated", B.id, `insert into brands(workspace_id,name) values ($1,'B') returning id`, [B.ws])).rows[0].id;
    const err = await rejects(() =>
      as(db, "authenticated", B.id, `insert into projects(workspace_id,brand_id,product_id,title) values ($1,$2,$3,'x')`, [B.ws, brandB, prodA]),
    );
    expect(err).toMatch(/foreign key|violates/i);
  });

  it("viewer 역할은 읽기만 가능하다", async () => {
    const V = await signUp(db, "v@x.com");
    await db.query(`insert into memberships(workspace_id,user_id,role) values ($1,$2,'viewer')`, [A.ws, V.id]);
    expect((await as(db, "authenticated", V.id, "select count(*)::int c from brands")).rows[0].c).toBe(1);
    expect(await rejects(() => as(db, "authenticated", V.id, `insert into brands(workspace_id,name) values ($1,'x')`, [A.ws]))).not.toBeNull();
  });

  it("정지/탈퇴한 멤버는 즉시 접근이 막힌다", async () => {
    const R = await signUp(db, "r@x.com");
    await db.query(`insert into memberships(workspace_id,user_id,role) values ($1,$2,'editor')`, [A.ws, R.id]);
    expect((await as(db, "authenticated", R.id, "select count(*)::int c from brands")).rows[0].c).toBe(1);
    await db.query(`update memberships set status='removed' where workspace_id=$1 and user_id=$2`, [A.ws, R.id]);
    expect((await as(db, "authenticated", R.id, "select count(*)::int c from brands")).rows[0].c).toBe(0);
  });

  it("기획 부품 → 제작물 연결과 제작물 ID/태그 저장", async () => {
    const q = (s: string, p: unknown[]) => as(db, "authenticated", A.id, s, p);
    const brand = (await q(`select id from brands where workspace_id=$1`, [A.ws])).rows[0].id;
    const prod = (await q(`select id from products where workspace_id=$1`, [A.ws])).rows[0].id;
    const proj = (await q(`insert into projects(workspace_id,brand_id,product_id,title) values ($1,$2,$3,'t') returning id`, [A.ws, brand, prod])).rows[0].id;
    const br = (await q(`insert into briefs(workspace_id,project_id) values ($1,$2) returning id`, [A.ws, proj])).rows[0].id;
    const con = (await q(`insert into concepts(workspace_id,project_id,brief_id,title,appeal,rationale) values ($1,$2,$3,'c','a','r') returning id`, [A.ws, proj, br])).rows[0].id;
    const hook = (await q(`insert into parts(workspace_id,project_id,concept_id,stage,label,content_json) values ($1,$2,$3,'hook','wrist_swipe','{}') returning id`, [A.ws, proj, con])).rows[0].id;
    const d = (await q(`insert into deliverables(workspace_id,project_id,concept_id,type,hook_part_id,tags_json) values ($1,$2,$3,'video',$4,'{"pattern":"use_moment"}') returning id, tags_json`, [A.ws, proj, con, hook])).rows[0];
    expect(d.id).toBeTruthy();
    expect(d.tags_json).toEqual({ pattern: "use_moment" });
  });
});

describe("크레딧 원장 (예약 → 정산)", () => {
  it("사용자는 지갑·원장을 직접 바꿀 수 없다", async () => {
    await as(db, "authenticated", A.id, `update wallet_accounts set available=999999 where workspace_id=$1`, [A.ws]).catch(() => null);
    expect((await wallet(A.ws)).available).toBe(0);
    expect(await rejects(() => as(db, "authenticated", A.id, `insert into credit_ledger(workspace_id,event_key,type,amount) values ($1,'x','GRANT',1000)`, [A.ws]))).toMatch(/permission denied/i);
  });

  it("지급 → 예약 → 부분 정산(성공분만 차감, 나머지 복구)", async () => {
    await svc(`select public.svc_grant_credits($1, 100, 'g1', 'beta')`, [A.ws]);
    await svc(`select public.svc_reserve_credits($1, 30, 'job1:s1')`, [A.ws]);
    expect(await wallet(A.ws)).toEqual({ available: 70, reserved: 30 });
    await svc(`select public.svc_settle_credits($1, 'job1:s1', 20)`, [A.ws]);
    expect(await wallet(A.ws)).toEqual({ available: 80, reserved: 0 });
    const led = await db.query<{ type: string; amount: string }>(
      `select type, amount from credit_ledger where workspace_id=$1 and event_key like 'job1:s1:%' order by event_key`, [A.ws]);
    expect(led.rows.map((r) => [r.type, Number(r.amount)])).toEqual([["CAPTURE", 20], ["RELEASE", 10], ["RESERVE", 30]]);
  });

  it("같은 요청 키는 한 번만 처리된다 (더블클릭/재시도 방어)", async () => {
    await svc(`select public.svc_reserve_credits($1, 10, 'job2:s1')`, [A.ws]);
    await svc(`select public.svc_reserve_credits($1, 10, 'job2:s1')`, [A.ws]);
    expect(await wallet(A.ws)).toEqual({ available: 70, reserved: 10 });
    await svc(`select public.svc_settle_credits($1, 'job2:s1', 10)`, [A.ws]);
    await svc(`select public.svc_settle_credits($1, 'job2:s1', 0)`, [A.ws]); // 재정산은 무시
    expect(await wallet(A.ws)).toEqual({ available: 70, reserved: 0 });
  });

  it("잔액이 부족하면 거부하고 잔액은 그대로다", async () => {
    const err = await rejects(() => svc(`select public.svc_reserve_credits($1, 71, 'job3:s1')`, [A.ws]));
    expect(err).toMatch(/insufficient_credits/);
    expect(await wallet(A.ws)).toEqual({ available: 70, reserved: 0 });
  });

  it("예약보다 큰 정산, 없는 예약 정산은 거부", async () => {
    await svc(`select public.svc_reserve_credits($1, 10, 'job4:s1')`, [A.ws]);
    expect(await rejects(() => svc(`select public.svc_settle_credits($1, 'job4:s1', 11)`, [A.ws]))).toMatch(/invalid_capture_amount/);
    expect(await rejects(() => svc(`select public.svc_settle_credits($1, 'nope', 1)`, [A.ws]))).toMatch(/reservation_not_found/);
    await svc(`select public.svc_settle_credits($1, 'job4:s1', 0)`, [A.ws]); // 전부 실패 → 전액 복구
    expect(await wallet(A.ws)).toEqual({ available: 70, reserved: 0 });
  });

  it("원장은 수정·삭제할 수 없다 (append-only)", async () => {
    expect(await rejects(() => db.query(`update credit_ledger set amount=1`))).toMatch(/append-only/);
    expect(await rejects(() => db.query(`delete from credit_ledger`))).toMatch(/append-only/);
  });

  it("원장과 지갑 캐시를 대조하고, 변조를 감지한다", async () => {
    const recon = async () => (await svc(`select * from public.svc_wallet_reconcile($1)`, [A.ws])).rows[0];
    expect((await recon()).ok).toBe(true);
    await db.query(`update wallet_accounts set available = available + 999 where workspace_id=$1`, [A.ws]);
    expect((await recon()).ok).toBe(false);
    await db.query(`update wallet_accounts set available = available - 999 where workspace_id=$1`, [A.ws]);
    expect((await recon()).ok).toBe(true);
  });

  it("브라우저 권한(authenticated/anon)으로는 크레딧 함수를 호출할 수 없다", async () => {
    for (const call of [
      `select public.svc_grant_credits('${A.ws}', 1000000, 'hack', 'x')`,
      `select public.svc_reserve_credits('${A.ws}', 1, 'hack')`,
      `select public.svc_settle_credits('${A.ws}', 'job1:s1', 0)`,
      `select private.grant_credits('${A.ws}', 1, 'h', 'x')`,
    ]) {
      expect(await rejects(() => as(db, "authenticated", A.id, call))).toMatch(/permission denied/i);
      expect(await rejects(() => as(db, "anon", null, call))).toMatch(/permission denied/i);
    }
  });

  it("예약 내역은 자기 워크스페이스 것만 조회된다", async () => {
    expect((await as(db, "authenticated", A.id, "select count(*)::int c from credit_reservations")).rows[0].c).toBeGreaterThan(0);
    expect((await as(db, "authenticated", B.id, "select count(*)::int c from credit_reservations")).rows[0].c).toBe(0);
  });
});
