/** 도메인 오류: HTTP 상태와 고객에게 보여줄 한국어 메시지를 함께 가진다. */
export class DomainError extends Error {
  constructor(public readonly code: string, public readonly status: number, message: string) {
    super(message);
    this.name = "DomainError";
  }
}

const PG_MAP: { match: RegExp; code: string; status: number; message: (m: RegExpMatchArray) => string }[] = [
  { match: /insufficient_credits/, code: "insufficient_credits", status: 402, message: () => "크레딧이 부족해요." },
  { match: /too_many_pending/, code: "too_many_pending", status: 429, message: () => "진행 중인 작업이 너무 많아요. 완료된 뒤 다시 시도해주세요." },
  { match: /plan_limit_exceeded:(\w+)/, code: "plan_limit_exceeded", status: 403, message: (m) => `현재 플랜의 ${LIMIT_LABEL[m[1]] ?? m[1]} 한도를 넘었어요.` },
  { match: /allowance_exceeded:(\w+)/, code: "allowance_exceeded", status: 429, message: () => "이번 달 사용 한도를 넘었어요." },
  { match: /idempotency_conflict/, code: "idempotency_conflict", status: 409, message: () => "같은 요청 키로 다른 내용이 들어왔어요. 새로고침 후 다시 시도해주세요." },
  { match: /invitation_not_found/, code: "invitation_not_found", status: 404, message: () => "초대를 찾을 수 없어요." },
  { match: /invitation_expired/, code: "invitation_expired", status: 410, message: () => "초대가 만료됐어요. 다시 초대를 요청해주세요." },
  { match: /invitation_not_pending/, code: "invitation_not_pending", status: 409, message: () => "이미 사용했거나 취소된 초대예요." },
  { match: /invitation_email_mismatch/, code: "invitation_email_mismatch", status: 403, message: () => "초대받은 이메일 계정으로 로그인해주세요." },
  { match: /last_owner/, code: "last_owner", status: 409, message: () => "마지막 소유자는 변경하거나 내보낼 수 없어요." },
  { match: /not_workspace_owner/, code: "forbidden", status: 403, message: () => "워크스페이스 소유자만 할 수 있어요." },
  { match: /forbidden/, code: "forbidden", status: 403, message: () => "권한이 없어요." },
];

export const LIMIT_LABEL: Record<string, string> = {
  brands: "브랜드 수", products: "제품 수", seats: "팀 좌석", proposals: "제안", exports: "출력",
};

/** DB(plpgsql)에서 올라온 예외 메시지를 도메인 오류로 바꾼다. 알 수 없는 오류는 null. */
export function fromDbMessage(message: string | undefined | null): DomainError | null {
  if (!message) return null;
  for (const rule of PG_MAP) {
    const m = message.match(rule.match);
    if (m) return new DomainError(rule.code, rule.status, rule.message(m));
  }
  return null;
}

export function isMissingRelation(err: { code?: string; message?: string } | null | undefined): boolean {
  return !!err && (err.code === "42P01" || err.code === "PGRST205" || err.code === "PGRST202" || /schema cache|does not exist/i.test(err.message ?? ""));
}

/** Supabase 응답의 error를 던질 때 도메인 오류로 정규화 */
export function raise(error: { message: string; code?: string } | null | undefined): void {
  if (!error) return;
  const d = fromDbMessage(error.message);
  if (d) throw d;
  if (isMissingRelation(error)) throw new DomainError("schema_missing", 503, "DB 업데이트가 아직 적용되지 않았어요. 운영자에게 알려주세요.");
  throw new Error(error.message);
}
