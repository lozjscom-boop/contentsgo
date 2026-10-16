/** 커서(keyset) 페이지네이션: (정렬값, id) 쌍을 base64url 로 감싼 불투명 커서. OFFSET 을 쓰지 않아 데이터가 많아도 느려지지 않는다. */
export type Cursor = { t: string; id: string };

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Cursor;
    if (typeof c.t === "string" && typeof c.id === "string" && !Number.isNaN(Date.parse(c.t)) && /^[0-9a-f-]{36}$/i.test(c.id)) return c;
  } catch {}
  return null;
}

/** limit+1 개를 조회한 뒤 다음 커서를 계산한다. */
export function pageOf<T extends { id: string; updated_at: string }>(rows: T[], limit: number) {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items, next: rows.length > limit && last ? encodeCursor({ t: last.updated_at, id: last.id }) : null };
}

/** PostgREST or-필터: updated_at < t  또는  (updated_at = t 이고 id < id) */
export function afterFilter(c: Cursor): string {
  return `updated_at.lt.${c.t},and(updated_at.eq.${c.t},id.lt.${c.id})`;
}
