import type en from "../en/common.ts";

// Keys left out show in English (see i18n/index.ts).
const ko: Partial<Record<keyof typeof en, string>> = {
  "common.save": "저장",
  "common.saving": "저장 중…",
  "common.saved": "저장했어요",
  "common.cancel": "취소",
  "common.delete": "삭제",
  "common.edit": "수정",
  "common.close": "닫기",
  "common.back": "뒤로",
  "common.next": "다음",
  "common.done": "완료",
  "common.retry": "다시 시도",
  "common.loading": "불러오는 중…",
  "common.search": "검색",
  "common.add": "추가",
  "common.remove": "제거",
  "common.copy": "복사",
  "common.copied": "복사했어요",
  "common.confirm": "확인",
  "common.approve": "승인",
  "common.reject": "거절",
  "common.yes": "예",
  "common.no": "아니요",
  "common.on": "켜짐",
  "common.off": "꺼짐",
  "common.optional": "선택",
  "common.none": "없음",
  "common.unknown": "알 수 없음",
  "common.error": "문제가 생겼어요.",
};

export default ko;
