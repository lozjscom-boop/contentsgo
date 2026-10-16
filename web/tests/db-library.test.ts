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

describe("탐색 / 영상 분석 / 자산 경로 안전장치", () => {
  it("자산 경로는 자기 워크스페이스 폴더여야 한다 (다른 테넌트 파일 끼워넣기 차단)", async () => {
    const own = `${A.ws}/uploads/a.mp4`;
    await as(db, "authenticated", A.id, `insert into assets(workspace_id,kind,object_key,mime,bytes) values ($1,'reference',$2,'video/mp4',10)`, [A.ws, own]);
    const stolen = await rejects(() => as(db, "authenticated", A.id, `insert into assets(workspace_id,kind,object_key,mime,bytes) values ($1,'reference',$2,'video/mp4',10)`, [A.ws, `${B.ws}/uploads/secret.mp4`]));
    expect(stolen).toMatch(/assets_key_prefix|check/i);
  });

  it("탐색 항목: 내 워크스페이스만 보이고 타인은 쓸 수 없다", async () => {
    await as(db, "authenticated", A.id, `insert into reference_items(workspace_id,title,url,platform,tags) values ($1,'경쟁사 훅','https://x.com/a','meta','{hook,sniff}')`, [A.ws]);
    expect((await as(db, "authenticated", A.id, "select count(*)::int c from reference_items")).rows[0].c).toBe(1);
    expect((await as(db, "authenticated", B.id, "select count(*)::int c from reference_items")).rows[0].c).toBe(0);
    expect(await rejects(() => as(db, "authenticated", B.id, `insert into reference_items(workspace_id,title) values ($1,'침투')`, [A.ws]))).not.toBeNull();
    expect(await rejects(() => as(db, "authenticated", A.id, `insert into reference_items(workspace_id,title,platform) values ($1,'x','naver')`, [A.ws]))).toMatch(/check/i);
  });

  it("영상 분석 결과는 사용자가 직접 쓸 수 없고(서버만), 멤버는 조회만 한다", async () => {
    const asset = (await db.query<{ id: string }>(`select id from assets where workspace_id=$1 limit 1`, [A.ws])).rows[0].id;
    expect(await rejects(() => as(db, "authenticated", A.id, `insert into video_analyses(workspace_id,asset_id,request_key) values ($1,$2,'k')`, [A.ws, asset]))).toMatch(/permission denied/i);
    await as(db, "service_role", null, `insert into video_analyses(workspace_id,asset_id,request_key,status) values ($1,$2,'k','done')`, [A.ws, asset]);
    expect((await as(db, "authenticated", A.id, "select count(*)::int c from video_analyses")).rows[0].c).toBe(1);
    expect((await as(db, "authenticated", B.id, "select count(*)::int c from video_analyses")).rows[0].c).toBe(0);
  });

  it("같은 요청 키로 분석을 두 번 만들 수 없다 (중복 제출 방지)", async () => {
    const asset = (await db.query<{ id: string }>(`select id from assets where workspace_id=$1 limit 1`, [A.ws])).rows[0].id;
    expect(await rejects(() => as(db, "service_role", null, `insert into video_analyses(workspace_id,asset_id,request_key) values ($1,$2,'k')`, [A.ws, asset]))).toMatch(/unique|duplicate/i);
  });
});
