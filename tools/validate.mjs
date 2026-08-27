#!/usr/bin/env node
// 문항 품질 게이트. AUTHORING.md §1 불변식과 §3 금지 사항을 기계적으로 검사한다.
// 사용: node tools/validate.mjs [--json] [--topic <name>] [--defect-stems]
//   --topic <name>   해당 주제 파일만 검사한다. 병렬 저작 시 자기 트랙만 보기 위한 것.
//   --defect-stems   결함을 묻는 발문의 id 목록(§3-11 자기점검 대상)을 함께 출력한다.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const QDIR = join(ROOT, 'data', 'questions')

const TOPICS = ['cdn', 'caching', 'image', 'video', 'storage']
const DISTRACTOR_TYPES = [
  'adjacent', 'inverted', 'overgeneralized', 'one-step-short',
  'vendor-mixup', 'outdated', 'plausible-number',
]

// §3-1 정답 길이는 오답 평균의 이 배수를 넘지 않는다
const LENGTH_RATIO_MAX = 1.4
// §3-2 저작 회피 신호
const BANNED_OPTION_PATTERNS = [/위의?\s*모두/, /모두\s*맞/, /정답\s*없/, /해당\s*없/, /위\s*전부/]
// §3-4 절대 표현
const ABSOLUTE_WORDS = ['항상', '절대', '모든', '반드시', '무조건', '결코']
// §3-6 부정형 발문 비율 상한
const NEGATIVE_RATIO_MAX = 0.2
const NEGATIVE_PATTERNS = [/않은\s*것/, /아닌\s*것/, /틀린\s*것/, /옳지\s*않/]

// §3-9 발문이 결함·사고를 전제하는 형태. 이때 "문제 없다"류 오답은 발문과 모순되어 즉시 소거된다.
const PREMISE_DEFECT_PATTERNS = [
  /결함/, /무엇이\s*깨/, /무엇이\s*문제/, /왜\s*실패/, /왜\s*깨/,
  /사고가\s*(발생|났)/, /장애가\s*(발생|났)/, /버그/, /틀렸/, /잘못/,
  /실질적\s*문제/, /지적될\s*문제/, /문제점/, /문제는\s*\?/,
]
// 결함을 전제하면서도 **처방**을 묻는 발문은 위 두 검사에서 제외한다. 그때는 오답이
// 처방 형태인 것이 정상이고(§3-11 은 "결함을 물었는데 결함을 말한 보기가 하나"를 잡는다),
// "문제 없다"류 보기도 "손댈 필요 없다"는 유효한 판단으로 경쟁할 수 있다.
const PRESCRIPTION_PATTERNS = [/대응은/, /해법은/, /해결은/, /무엇을\s*해야/, /옳은\s*조치/, /어떻게\s*(고쳐|바꿔)/]
// 그 전제를 부정하는 보기 = 죽은 보기
const PREMISE_DENIAL_PATTERNS = [
  /문제\s*없/, /이상\s*없/, /결함\s*(이|은)?\s*없/, /문제(가|되)?\s*(되지|하지)\s*않/,
  /영향\s*(이|은)?\s*없/, /차이\s*(가|는)?\s*없/, /아무\s*(일|문제|영향)/,
  /정상\s*(이다|동작|작동)/, /괜찮/, /손해가\s*없/, /비용이\s*들지\s*않/,
]

// ── 기계로 잡히지 않는 축 (2026-08-27 실측, 지우지 말 것) ──────────────
// 블라인드 감사가 지목한 결함 유형 중 두 가지는 이 파일로 환원되지 않는다.
//
//   ① 발문 어휘 반복 — 발문이 원인을 이미 진단해 주고 정답이 그것을 되풀이한다
//   ② 구체성 격차   — 정답만 수치·고유명사를 달고 있어 "자세한 쪽이 정답"이 된다
//
// 둘 다 토큰 겹침·구체성 마커 카운트로 근사해 구현하고, 감사자가 지목한 12건과
// 미지목 8건의 격차 분포를 비교했다. 결과: 지목군의 격차 최대 +1, 대조군에도 +1이
// 존재해 두 군이 전혀 분리되지 않았다(전체 77건 격차 최대 2). 감사자가 본 것은
// 토큰 겹침이 아니라 의미적 반복이므로, 임계를 낮추면 오탐만 늘고 진짜는 못 잡는다.
//
// 세 번째 축도 같은 결론이었다(2026-08-27):
//
//   ③ why ↔ text 불일치 — 오답의 `why` 가 자기 보기가 아니라 다른 보기(또는 아무 보기도
//      아닌) 이야기를 한다. 편집 중 문장이 뒤섞여 생기고, 화면에서는 정상으로 보인다.
//
// 위임 감사 라운드가 실제로 4건을 지목했다(storage-consistency-cdn-001 의 보기 둘,
// image-vmaf-still-001, image-gif-loop-001). 근사 지표로 "why 가 자기 text 와 겹치는
// 토큰 수 − 남의 text 와 겹치는 최대 토큰 수"를 596개 보기 전부에 계산했다. 결과:
// 겹침 0인 보기가 249개(42%)였고 지목된 4건은 그 덩어리 한가운데(228~249위)였다.
// 오답의 why 는 원래 보기 텍스트를 되풀이하지 않고 그 오해를 설명하는 글이므로,
// 어휘 겹침이 낮은 것이 정상이다 — 즉 이 축에는 신호가 없다.
//
// 무력한 게이트는 "통과"를 "결함 없음"으로 잘못 읽히게 만들기 때문에 제거했다.
// 이 축들의 유일한 유효 계측기는 블라인드 감사 라운드다
// (tools/blind.mjs → 외부 풀이자 → tools/grade-blind.mjs). AUTHORING.md §6.2 참조.
// 문항을 추가·수정한 뒤에는 이 게이트가 녹색이어도 블라인드 감사를 다시 돌려야 한다.

const errors = []
const warnings = []
// §3-11 자기점검 대상. 게이트는 이 축을 판정하지 않고 봐야 할 문항만 모아 준다.
const defectStemIds = []
const err = (id, msg) => errors.push({ id, msg })
const warn = (id, msg) => warnings.push({ id, msg })

function loadAll() {
  if (!existsSync(QDIR)) {
    console.error(`문항 디렉터리가 없습니다: ${QDIR}`)
    process.exit(2)
  }
  // --topic <name> 은 그 주제 파일만 검사한다. 여러 사람이 주제별로 나눠 문항을 쓸 때,
  // 옆 주제의 편집 중간 상태 때문에 자기 게이트가 실패하는 것을 막는다.
  // 병합 전 최종 확인은 항상 주제 한정 없이 전체로 돌린다.
  const ti = process.argv.indexOf('--topic')
  const only = ti >= 0 ? process.argv[ti + 1] : null
  let files = readdirSync(QDIR).filter((f) => f.endsWith('.json'))
  if (only) {
    files = files.filter((f) => f === `${only}.json`)
    if (!files.length) {
      console.error(`그런 주제 파일이 없습니다: ${only}.json`)
      process.exit(2)
    }
  }
  const out = []
  for (const f of files) {
    const path = join(QDIR, f)
    let parsed
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8'))
    } catch (e) {
      err(f, `JSON 파싱 실패: ${e.message}`)
      continue
    }
    if (!Array.isArray(parsed)) {
      err(f, '최상위는 문항 배열이어야 합니다')
      continue
    }
    parsed.forEach((q, i) => out.push({ ...q, __file: f, __index: i }))
  }
  return out
}

function checkQuestion(q) {
  const id = q.id || `${q.__file}#${q.__index}`

  // ── §1 불변식 ────────────────────────────────────────────────
  if (!q.id) err(id, 'id 누락')
  if (!q.topic) err(id, 'topic 누락')
  else if (!TOPICS.includes(q.topic)) err(id, `topic이 허용값이 아님: ${q.topic}`)
  if (!q.question || q.question.trim().length < 10) err(id, '발문이 없거나 너무 짧음')
  if (typeof q.difficulty !== 'number' || q.difficulty < 1 || q.difficulty > 3)
    err(id, 'difficulty는 1~3 정수여야 함')
  if (!q.explanation || q.explanation.trim().length < 30)
    err(id, 'explanation이 없거나 너무 짧음(30자 이상)')
  if (!q.source || !q.source.trim()) err(id, 'source 누락 — 검증 가능한 근거가 필요함')

  const opts = q.options
  if (!Array.isArray(opts) || opts.length !== 4) {
    err(id, `options는 정확히 4개여야 함 (현재 ${Array.isArray(opts) ? opts.length : '없음'})`)
    return
  }

  const correct = opts.filter((o) => o.correct === true)
  if (correct.length !== 1) err(id, `정답은 정확히 1개여야 함 (현재 ${correct.length}개)`)

  const wrong = opts.filter((o) => !o.correct)
  for (const [i, o] of opts.entries()) {
    if (!o.text || !o.text.trim()) err(id, `보기 ${i}: text 누락`)
    // §2.3 핵심 게이트 — 모든 보기에 why가 있어야 한다
    if (!o.why || o.why.trim().length < 5)
      err(id, `보기 ${i}: why 누락 — "이 보기를 고른 사람은 무엇을 오해했는가"를 쓸 수 없으면 버려야 함`)
    if (!o.correct) {
      if (!o.distractorType) err(id, `보기 ${i}: distractorType 누락`)
      else if (!DISTRACTOR_TYPES.includes(o.distractorType))
        err(id, `보기 ${i}: distractorType이 허용값이 아님: ${o.distractorType}`)
    }
    // §3-2 금지 보기
    if (o.text && BANNED_OPTION_PATTERNS.some((re) => re.test(o.text)))
      err(id, `보기 ${i}: 금지된 보기 형태("위의 모든 것"류)`)
  }

  // §2.2 오답 유형 다양성 — 3개가 전부 같은 타입이면 안 됨
  const types = new Set(wrong.map((o) => o.distractorType).filter(Boolean))
  if (wrong.length === 3 && types.size < 2)
    err(id, `오답 3개의 distractorType이 ${types.size}종뿐 — 최소 2종을 섞어야 함`)

  // §3-1 길이 편향
  if (correct.length === 1 && wrong.length === 3) {
    const cLen = correct[0].text.length
    const wAvg = wrong.reduce((s, o) => s + o.text.length, 0) / wrong.length
    if (wAvg > 0 && cLen / wAvg > LENGTH_RATIO_MAX)
      err(id, `길이 편향: 정답 ${cLen}자 / 오답 평균 ${wAvg.toFixed(1)}자 = ${(cLen / wAvg).toFixed(2)}배 (상한 ${LENGTH_RATIO_MAX})`)
  }

  // 문체: 사용자 노출 문자열의 엠대시 금지 (2026-08-27 래칫)
  // "한국어가 좀 이상해요"라는 실사용자 피드백을 받고 문항 전체를 교정한 라운드에서
  // 엠대시 116건을 콜론·접속 표현으로 바꿔 0으로 만들었다. 엠대시는 앞뒤 관계를 지나치게
  // 함축해서 번역체로 읽히는 주범이었다. source 는 인용 문자열이라 검사하지 않는다.
  for (const [k, s] of [['question', q.question], ['explanation', q.explanation]]) {
    if (s && s.includes('—')) err(id, `${k} 에 엠대시(—) — 콜론이나 접속 표현으로 풀어 쓸 것`)
  }
  for (const [i, o] of opts.entries()) {
    if (o.text && o.text.includes('—')) err(id, `보기 ${i} text 에 엠대시(—) — 콜론이나 접속 표현으로 풀어 쓸 것`)
    if (o.why && o.why.includes('—')) err(id, `보기 ${i} why 에 엠대시(—) — 콜론이나 접속 표현으로 풀어 쓸 것`)
  }

  // §3-4 절대 표현이 오답에만 몰리는지
  const hasAbs = (t) => ABSOLUTE_WORDS.some((w) => t.includes(w))
  const wrongAbs = wrong.filter((o) => hasAbs(o.text || '')).length
  const correctAbs = correct.length === 1 && hasAbs(correct[0].text || '')
  if (wrongAbs >= 2 && !correctAbs)
    warn(id, `절대 표현("항상/모든/반드시"류)이 오답 ${wrongAbs}개에만 있음 — 단어만 보고 소거 가능`)

  // §3-3 문법 단서 — 보기 어미가 정답만 다른 경우
  const tail = (t) => (t || '').trim().slice(-2)
  const tails = opts.map((o) => tail(o.text))
  if (correct.length === 1) {
    const cTail = tail(correct[0].text)
    const sameAsCorrect = tails.filter((t) => t === cTail).length
    if (sameAsCorrect === 1 && new Set(wrong.map((o) => tail(o.text))).size === 1)
      warn(id, `문법 단서 의심: 오답 3개의 어미가 동일하고 정답만 다름("${cTail}")`)
  }

  // §3-7 복합 질문
  if (q.question && (q.question.match(/\?/g) || []).length > 1)
    warn(id, '발문에 물음표가 2개 이상 — 한 문항에 두 가지를 묻고 있지 않은지 확인')

  if (correct.length !== 1 || wrong.length !== 3) return

  // §3-9 발문이 결함을 전제하는데 그 전제를 부정하는 오답 — 읽자마자 소거되는 죽은 보기
  const premisesDefect =
    PREMISE_DEFECT_PATTERNS.some((re) => re.test(q.question || '')) &&
    !PRESCRIPTION_PATTERNS.some((re) => re.test(q.question || ''))
  if (premisesDefect) {
    // §3-11 이 발문 형태는 그 자체로 위험하다. 결함을 묻는 발문의 오답은 방어·처방·부정으로
    // 쓰기가 쉽고, 그러면 "결함을 서술한 보기"가 정답 하나뿐이라 문형만으로 답이 특정된다.
    // 결함 서술 여부는 기계로 판정할 수 없으므로 여기서는 **대상만 지목**한다 — 판정하는
    // 척하는 게이트를 만들지 않는 것이 §3-9 아래의 실측 기록이 말하는 교훈이다.
    defectStemIds.push(id)
    for (const [i, o] of opts.entries()) {
      if (o.correct) continue
      if (PREMISE_DENIAL_PATTERNS.some((re) => re.test(o.text || '')))
        err(id, `보기 ${i}: 발문이 결함을 전제하는데 이 보기는 그 전제를 부정함 — 읽자마자 소거되는 죽은 보기 ("${o.text.slice(0, 40)}…")`)
    }
  }

}

function checkGlobal(qs) {
  // id 유일성
  const seen = new Map()
  for (const q of qs) {
    if (!q.id) continue
    if (seen.has(q.id)) err(q.id, `id 중복 (${seen.get(q.id)} 와 ${q.__file})`)
    else seen.set(q.id, q.__file)
  }

  // 발문 중복
  const norm = (s) => (s || '').replace(/\s+/g, '').toLowerCase()
  const byQ = new Map()
  for (const q of qs) {
    const k = norm(q.question)
    if (!k) continue
    if (byQ.has(k)) warn(q.id, `발문이 ${byQ.get(k)} 와 동일`)
    else byQ.set(k, q.id)
  }

  // §3-6 부정형 발문 비율
  const neg = qs.filter((q) => NEGATIVE_PATTERNS.some((re) => re.test(q.question || '')))
  if (qs.length >= 10) {
    const ratio = neg.length / qs.length
    if (ratio > NEGATIVE_RATIO_MAX)
      err('GLOBAL', `부정형 발문이 ${neg.length}/${qs.length} = ${(ratio * 100).toFixed(0)}% (상한 ${NEGATIVE_RATIO_MAX * 100}%)`)
  }

  // §3-5 정답 위치 편중 (원본 데이터 기준)
  if (qs.length >= 20) {
    const pos = [0, 0, 0, 0]
    for (const q of qs) {
      const i = (q.options || []).findIndex((o) => o.correct)
      if (i >= 0 && i < 4) pos[i]++
    }
    const expected = qs.length / 4
    const chi = pos.reduce((s, o) => s + (o - expected) ** 2 / expected, 0)
    // df=3, p=0.01 임계 11.34
    if (chi > 11.34)
      warn('GLOBAL', `정답 위치 편중 (분포 ${pos.join('/')}, chi²=${chi.toFixed(2)}) — 런타임 셔플이 있지만 원본도 고르게`)
  }

  return { total: qs.length, negatives: neg.length }
}

// ── 실행 ────────────────────────────────────────────────────────
const onlyIdx = process.argv.indexOf('--only')
const only = onlyIdx > -1 ? process.argv[onlyIdx + 1] : null
if (only && !TOPICS.includes(only)) {
  console.error(`--only 값이 허용된 topic이 아닙니다: ${only} (${TOPICS.join(', ')})`)
  process.exit(2)
}

let questions = loadAll()
if (only) questions = questions.filter((q) => q.topic === only)
for (const q of questions) checkQuestion(q)
const stats = checkGlobal(questions)

// OG 카드가 데이터와 어긋났는지. 카드에는 "N문항"이 새겨져 있고, 그 N을 PNG 의 tEXt
// 청크에도 넣어 둔다(tools/make-og.py). 이 카드는 macOS 시스템 폰트로 그려지므로 CI 는
// 재생성해 대조할 수 없다 — 그래서 재생성이 아니라 스탬프 대조가 유일한 검출 경로다.
// 실측: 89문항 시절 카드가 문항이 149로 늘어난 뒤에도 그대로 배포돼 있었고, 소셜 카드는
// 화면 어디에도 나오지 않아 아무 게이트에도 걸리지 않았다.
function checkOgStamp(total) {
  const p = join(ROOT, 'assets', 'og.png')
  if (!existsSync(p)) return warn('og.png', 'OG 카드가 없다 — twitter:card 가 렌더되지 않는다')
  const buf = readFileSync(p)
  let stamped = null
  for (let i = 8; i + 8 <= buf.length; ) {
    const len = buf.readUInt32BE(i)
    const type = buf.toString('ascii', i + 4, i + 8)
    if (type === 'tEXt') {
      const [k, v] = buf.toString('latin1', i + 8, i + 8 + len).split('\0')
      if (k === 'cachehit:questions') stamped = Number(v)
    }
    if (type === 'IEND') break
    i += 12 + len
  }
  if (stamped === null)
    return warn('og.png', '문항 수 스탬프가 없다 — python3 tools/make-og.py 로 다시 만들어라')
  if (stamped !== total)
    err('og.png', `OG 카드는 ${stamped}문항으로 그려졌는데 지금은 ${total}문항이다 — python3 tools/make-og.py`)
}
// --only/--topic 로 일부만 검사할 때는 총계가 아니므로 대조하지 않는다
if (!only && !process.argv.includes('--topic')) checkOgStamp(stats.total)

const byTopic = {}
const byDiff = { 1: 0, 2: 0, 3: 0 }
const byType = {}
for (const q of questions) {
  byTopic[q.topic] = (byTopic[q.topic] || 0) + 1
  if (byDiff[q.difficulty] !== undefined) byDiff[q.difficulty]++
  for (const o of q.options || []) if (o.distractorType) byType[o.distractorType] = (byType[o.distractorType] || 0) + 1
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ stats, byTopic, byDiff, byType, errors, warnings }, null, 2))
} else {
  console.log(`문항 ${stats.total}건 검사`)
  console.log(`  주제별: ${Object.entries(byTopic).map(([k, v]) => `${k} ${v}`).join(' / ') || '-'}`)
  console.log(`  난이도: 1=${byDiff[1]} 2=${byDiff[2]} 3=${byDiff[3]}`)
  console.log(`  오답유형: ${Object.entries(byType).map(([k, v]) => `${k} ${v}`).join(' / ') || '-'}`)
  console.log(`  부정형 발문: ${stats.negatives}건`)
  console.log(`  결함형 발문: ${defectStemIds.length}건 — §3-11 자기점검 대상 (목록: --defect-stems)`)
  if (process.argv.includes('--defect-stems'))
    for (const i of defectStemIds) console.log(`    · ${i}`)
  if (warnings.length) {
    console.log(`\n경고 ${warnings.length}건`)
    for (const w of warnings) console.log(`  ⚠ [${w.id}] ${w.msg}`)
  }
  if (errors.length) {
    console.log(`\n실패 ${errors.length}건`)
    for (const e of errors) console.log(`  ✗ [${e.id}] ${e.msg}`)
    console.log('\n게이트 실패 — 위 항목을 고치기 전에는 병합하지 않는다.')
  } else {
    console.log('\n게이트 통과')
  }
}

process.exit(errors.length ? 1 : 0)
