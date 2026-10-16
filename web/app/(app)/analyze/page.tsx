import TabPlan from "@/components/tab-plan";
export default function Page() {
  return <TabPlan title="영상 분석" summary="영상을 올리면 훅·구성·장면별로 뜯어서 왜 먹히는지 정리해줘요." items={["영상 업로드 (MP4)", "훅(0~3초) / 브랜드 한 줄 / 본문 / 전환 구간 분해", "장면별 설명, 사용된 소구 패턴 태그", "분석 결과를 내 기획으로 가져오기"]} />;
}
