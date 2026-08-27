-- 집계만 저장한다. 원시 이벤트·IP·UA·식별자는 어떤 형태로도 저장하지 않는다.
-- AUTHORING §7 이 요구하는 두 가지가 이 스키마의 전부다:
--   ① 문항별 보기 선택 분포 (선택률 5% 미만 오답 = 죽은 보기)
--   ② 확신도 × 정답 여부 교차표 (확신했는데 틀린 문항이 가장 가치 있다)
-- 적용: wrangler d1 execute cachehit-analytics --remote --file tools/analytics-schema.sql

-- 보기 선택 카운터. (qid, opt, confidence) 한 칸이 교차표의 한 셀이다.
-- opt 는 셔플 전 원본 데이터 기준 보기 인덱스다.
CREATE TABLE IF NOT EXISTS answers (
  qid        TEXT    NOT NULL,
  opt        INTEGER NOT NULL,
  confidence TEXT    NOT NULL,            -- sure | unsure | guess
  correct    INTEGER NOT NULL,            -- 0/1 (qid+opt 에서 유도 가능하지만 SQL 편의로 저장)
  n          INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (qid, opt, confidence)
);

-- 일 단위 카운터. k 는 "이벤트:YYYY-MM-DD" (예: pageview:2026-08-27).
-- pageview 는 방문자 수가 아니라 브라우저·일 단위 근사치다: 클라이언트가 localStorage 로
-- 하루 한 번만 보낸다. 서버는 아무 식별자도 받지 않으므로 그 이상은 셀 수 없고, 세지 않는다.
CREATE TABLE IF NOT EXISTS counters (
  k TEXT PRIMARY KEY,
  n INTEGER NOT NULL DEFAULT 0
);
