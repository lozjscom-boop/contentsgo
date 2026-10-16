import TabPlan from "@/components/tab-plan";
export default function Page() {
  return <TabPlan title="프로젝트" summary="내가 만든 기획과 제작물이 모여 있어요." items={["프로젝트 목록 / 상태", "기획(콘셉트·부품)과 제작물 함께 보기", "제작물별 ID·태그 (이후 광고 성과 연결용)", "삭제·복제"]} />;
}
