/* cachehit — 콘텐츠 서빙 퀴즈
 *
 * 학습 설계(AUTHORING.md §0):
 *  - 답 선택 → 확신도 → 즉시 채점. 확신했는데 틀린 것을 따로 표시한다(hypercorrection).
 *  - 정답 해설뿐 아니라 "고른 오답이 왜 틀렸는지"를 함께 보여준다.
 *  - 틀린 문항만 다시 푸는 라운드를 제공한다(교정 직후 재인출).
 */

const LENGTHS = [10, 20]
const DEFAULT_LENGTH = 10
const STORE_KEY = 'cachehit.best.v1'
const LEN_KEY = 'cachehit.len.v1'
const SITE_URL = 'https://cachehit.pages.dev'

const TOPIC_LABEL = {
  cdn: 'CDN',
  caching: 'HTTP 캐싱',
  image: '이미지',
  video: '동영상',
  storage: '스토리지',
}

const GRADES = [
  { min: 90, name: 'ORIGIN SHIELD', line: '오리진까지 갈 일이 거의 없군요. 이 정도면 설계를 맡겨도 되겠습니다.' },
  { min: 75, name: 'CACHE HIT', line: '대부분 엣지에서 끝냅니다. 실무에서 바로 통하는 수준이에요.' },
  { min: 55, name: 'STALE WHILE REVALIDATE', line: '일단 응답은 나갑니다. 뒤에서 조용히 갱신할 부분이 남았네요.' },
  { min: 35, name: 'TTL EXPIRED', line: '알던 것들이 조금씩 만료됐습니다. 재검증할 때가 됐어요.' },
  { min: 0, name: 'CACHE MISS', line: '전부 오리진까지 갔습니다. 여기서부터 채우면 됩니다.' },
]

const $ = (s) => document.querySelector(s)
const $$ = (s) => Array.from(document.querySelectorAll(s))

/* ── 익명 집계 ─────────────────────────────────────── */
// 무엇을 어떻게 세는지는 functions/collect.js 와 README 에 공개돼 있고, 저장되는 것은
// 카운터 증가뿐이다(식별자 없음). 수집은 배포 호스트에서만 한다 — 로컬 실행과
// E2E(cachehit.test)는 이 게이트에서 걸러진다.
const ANALYTICS_HOSTS = ['cachehit.pages.dev', 'cachehit.midagedev.com']
function track(t, extra) {
  try {
    if (!ANALYTICS_HOSTS.includes(location.hostname)) return
    const body = JSON.stringify({ t, ...extra })
    // sendBeacon: 페이지 이탈 중에도 유실되지 않는 전송 경로. 거부되면 keepalive fetch 로.
    if (!navigator.sendBeacon('/collect', new Blob([body], { type: 'application/json' })))
      fetch('/collect', { method: 'POST', body, keepalive: true }).catch(() => {})
  } catch { /* 집계는 실패해도 퀴즈를 막지 않는다 */ }
}
function trackPageview() {
  try {
    const day = new Date().toISOString().slice(0, 10)
    if (localStorage.getItem('cachehit.pv.v1') === day) return // 브라우저당 하루 한 번
    localStorage.setItem('cachehit.pv.v1', day)
  } catch { /* 저장이 막힌 브라우저에서는 방문마다 집계된다 — 근사치의 한계로 받아들인다 */ }
  track('pageview')
}

const state = {
  pool: [],       // 전체 문항
  length: DEFAULT_LENGTH,
  queue: [],      // 이번 라운드 문항
  idx: 0,
  answers: [],    // { q, pickedIdx, correct, confidence }
  isRetry: false,
}

/* ── 유틸 ──────────────────────────────────────────── */
function shuffle(arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function show(id) {
  $$('.screen').forEach((s) => s.classList.add('hidden'))
  $(id).classList.remove('hidden')
  window.scrollTo({ top: 0, behavior: 'instant' })
}

function gradeFor(rate) {
  return GRADES.find((g) => rate >= g.min) || GRADES[GRADES.length - 1]
}

/* ── 로딩 ──────────────────────────────────────────── */
async function load() {
  let data = []
  try {
    const res = await fetch('data/questions.json', { cache: 'no-cache' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    data = await res.json()
  } catch (e) {
    $('#screen-intro').innerHTML =
      `<div class="hero"><h1>문항을 불러오지 못했습니다</h1>
       <p class="lede">잠시 후 다시 시도해 주세요.<br><small>${String(e.message || e)}</small></p></div>`
    return
  }

  state.pool = data.filter((q) => Array.isArray(q.options) && q.options.length === 4)

  const saved = Number(localStorage.getItem(LEN_KEY))
  setLength(LENGTHS.includes(saved) ? saved : DEFAULT_LENGTH)
  $$('.btn-len').forEach((b) =>
    b.addEventListener('click', () => setLength(Number(b.dataset.len))))

  const best = localStorage.getItem(STORE_KEY)
  if (best) {
    const el = $('#best-record')
    el.querySelector('b').textContent = `${best}%`
    el.classList.remove('hidden')
  }

  $('#btn-start').addEventListener('click', () => startRound(pickQuestions(state.length)))

  trackPageview()
}

/* 라운드 길이. 20문항은 길다는 실사용 피드백이 있어 10을 기본으로 둔다 —
   짧은 라운드를 끝내고 한 번 더 하는 편이, 긴 라운드를 중간에 놓는 것보다 낫다. */
function setLength(n) {
  state.length = Math.min(n, state.pool.length)
  localStorage.setItem(LEN_KEY, String(n))
  $$('.btn-len').forEach((b) =>
    b.setAttribute('aria-pressed', String(Number(b.dataset.len) === n)))
  $('#intro-minutes').textContent = Math.max(2, Math.round(state.length * 0.5))
}

/* 주제가 골고루 나오도록 라운드로빈으로 뽑는다 */
function pickQuestions(n) {
  const byTopic = {}
  for (const q of shuffle(state.pool)) (byTopic[q.topic] ||= []).push(q)
  const topics = shuffle(Object.keys(byTopic))
  const out = []
  let i = 0
  while (out.length < n && topics.some((t) => byTopic[t].length)) {
    const t = topics[i++ % topics.length]
    if (byTopic[t].length) out.push(byTopic[t].pop())
  }
  // 쉬운 것부터 배치한다. 첫 문항이 난이도 3이면 이탈하고, 인출 연습은 성공 경험이
  // 먼저 와야 효과가 있다. sort 는 안정 정렬이라 같은 난이도 안에서는 셔플이 유지된다.
  return shuffle(out).sort((a, b) => (a.difficulty || 2) - (b.difficulty || 2))
}

function startRound(questions) {
  state.queue = questions
  state.idx = 0
  state.answers = []
  show('#screen-quiz')
  renderQuestion()
}

/* ── 문항 렌더 ─────────────────────────────────────── */
function renderQuestion() {
  const q = state.queue[state.idx]
  const total = state.queue.length

  $('#progress-bar').style.width = `${(state.idx / total) * 100}%`
  $('#q-counter').textContent = `${state.idx + 1} / ${total}`
  $('#q-topic').textContent = TOPIC_LABEL[q.topic] || q.topic
  const diffEl = $('#q-diff')
  diffEl.textContent = ['쉬움', '보통', '어려움'][q.difficulty - 1] || '보통'
  diffEl.dataset.d = q.difficulty
  $('#q-text').textContent = q.question

  // 보기 셔플 — 원본 순서에 의존하지 않게
  const opts = shuffle(q.options.map((o, i) => ({ ...o, _orig: i })))
  q._shuffled = opts

  const list = $('#q-options')
  list.innerHTML = ''
  opts.forEach((o, i) => {
    const li = document.createElement('li')
    const btn = document.createElement('button')
    btn.className = 'opt'
    btn.type = 'button'
    btn.innerHTML = `<span class="opt-key">${'ABCD'[i]}</span><span>${escapeHtml(o.text)}</span>`
    btn.addEventListener('click', () => pick(i))
    li.appendChild(btn)
    list.appendChild(li)
  })

  $('#confidence').classList.add('hidden')
  $('#feedback').classList.add('hidden')
  state.pending = null
}

// 근거 줄. 텍스트만 있던 자리에 원문 링크를 함께 놓는다 — 해설을 읽고 바로 원문으로
// 넘어갈 수 있어야 퀴즈가 학습의 입구가 된다. 링크는 빌드 때 source 텍스트에서 유도된다.
function renderSource(q) {
  const el = $('#source')
  el.innerHTML = ''
  if (!q.source) return
  const txt = document.createElement('span')
  txt.textContent = `근거: ${q.source}`
  el.appendChild(txt)
  for (const l of q.sourceLinks || []) {
    const a = document.createElement('a')
    a.className = 'source-link'
    a.href = l.url
    a.target = '_blank'
    a.rel = 'noopener'
    a.textContent = l.label
    el.appendChild(a)
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

/* 1단계: 보기 선택 → 확신도 묻기 */
function pick(i) {
  state.pending = i
  $$('#q-options .opt').forEach((b, j) => {
    b.dataset.state = j === i ? 'picked' : ''
  })
  $('#confidence').classList.remove('hidden')
  $('#confidence').scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

/* 2단계: 확신도 → 채점 */
function grade(confidence) {
  const q = state.queue[state.idx]
  const picked = q._shuffled[state.pending]
  const isCorrect = picked.correct === true

  state.answers.push({ q, picked, correct: isCorrect, confidence })
  // opt 는 셔플 전 원본 인덱스로 보낸다 — 집계는 원본 데이터의 보기 순서 기준이다.
  track('answer', { qid: q.id, opt: q.options.indexOf(picked), confidence, correct: isCorrect })

  $$('#q-options .opt').forEach((b, j) => {
    b.disabled = true
    const o = q._shuffled[j]
    if (o.correct) b.dataset.state = 'correct'
    else if (j === state.pending) b.dataset.state = 'wrong'
    else b.dataset.state = 'dim'
  })

  $('#confidence').classList.add('hidden')

  // 찍어서 맞은 것은 채점상 정답이지만 아는 것이 아니다. 맞았다는 표시 때문에 그냥
  // 넘기기 가장 쉬운 문항이라, 여기서 한 번 더 붙잡는다.
  const VERDICT = {
    ok: {
      sure: '정답입니다',
      unsure: '정답입니다<small>확신이 없었다면, 해설을 한 번 더 읽어두세요.</small>',
      guess: '정답입니다<small>다만 찍어서 맞았습니다. 지금 해설을 읽지 않으면 다음에는 틀립니다.</small>',
    },
    bad: {
      sure: '틀렸습니다<small>확신했던 문항입니다. 이런 문항이 가장 오래 기억에 남습니다.</small>',
      unsure: '틀렸습니다',
      guess: '틀렸습니다<small>모르는 부분을 하나 찾았습니다. 찍었다고 정직하게 표시해 두면 결과에서 따로 모아 드립니다.</small>',
    },
  }
  const verdict = $('#verdict')
  verdict.dataset.r = isCorrect ? 'ok' : 'bad'
  verdict.innerHTML = VERDICT[isCorrect ? 'ok' : 'bad'][confidence]

  const yours = $('#why-yours')
  if (!isCorrect) {
    yours.querySelector('p').textContent = picked.why || ''
    yours.classList.remove('hidden')
  } else {
    yours.classList.add('hidden')
  }

  const correctOpt = q._shuffled.find((o) => o.correct)
  $('#why-correct').querySelector('p').textContent =
    `${correctOpt.text} — ${correctOpt.why || ''}`

  $('#explanation').textContent = q.explanation || ''
  renderSource(q)

  $('#btn-next').textContent = state.idx === state.queue.length - 1 ? '결과 보기' : '다음'
  $('#feedback').classList.remove('hidden')
  $('#feedback').scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

/* ── 문항 복사 ─────────────────────────────────────── */

// 채점이 끝난 문항을 마크다운으로 옮긴다. 붙여넣는 곳은 대개 대화형 모델이라,
// 보기·정답·오답 해설을 모두 담고 마지막에 무엇을 물어볼지까지 적어 둔다 —
// 문항만 붙여넣으면 "정답이 뭐야"를 다시 묻게 되고 그건 이미 아는 것이다.
function questionMarkdown(q, picked) {
  const opts = q._shuffled || q.options
  const lines = []
  lines.push(`## ${TOPIC_LABEL[q.topic] || q.topic} — ${q.question}`, '')
  opts.forEach((o, i) => {
    const mark = o.correct ? ' ✅' : (o === picked ? ' ← 내가 고른 답' : '')
    lines.push(`${'ABCD'[i]}. ${o.text}${mark}`)
  })
  lines.push('')

  const right = opts.find((o) => o.correct)
  lines.push(`**정답**: ${'ABCD'[opts.indexOf(right)]}. ${right.text}`)
  if (right.why) lines.push(`> ${right.why}`)
  if (q.explanation) lines.push('', q.explanation)

  const wrong = opts.filter((o) => !o.correct && o.why)
  if (wrong.length) {
    lines.push('', '**오답이 오답인 이유**')
    for (const o of wrong) lines.push(`- ${'ABCD'[opts.indexOf(o)]}. ${o.text} — ${o.why}`)
  }
  if (q.source) lines.push('', `근거: ${q.source}`)
  // 링크는 마크다운으로 — 붙여넣은 쪽에서 그대로 눌러 원문까지 갈 수 있어야 한다
  for (const l of q.sourceLinks || []) lines.push(`- [${l.label}](${l.url})`)

  lines.push(
    '',
    '---',
    '',
    picked && !picked.correct
      ? '위 문항에서 제가 고른 답이 왜 틀렸는지, 제가 어떤 전제를 잘못 잡고 있었을지 짚어 주세요. 그리고 같은 오해가 실무에서 어떤 사고로 이어지는지 사례를 들어 설명해 주세요.'
      : '위 문항의 개념을 실무 맥락에서 더 깊이 설명해 주세요. 제가 놓쳤을 인접 개념과, 이걸 안다고 착각하기 쉬운 지점도 함께 짚어 주세요.',
    '',
    `출처: cachehit — ${SITE_URL}`,
  )
  return lines.join('\n')
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // clipboard API 는 보안 컨텍스트에서만 동작한다. file:// 로 열었을 때의 폴백.
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0'
    document.body.appendChild(ta)
    ta.select()
    let ok = false
    try { ok = document.execCommand('copy') } catch { ok = false }
    ta.remove()
    return ok
  }
}

function next() {
  state.idx++
  if (state.idx >= state.queue.length) renderResult()
  else renderQuestion()
}

/* ── 결과 ──────────────────────────────────────────── */

// 재도전 대상. 틀린 것만 다시 푸는 것으로는 부족하다 — 찍어서 맞은 문항은 채점이
// 정답이라 복습에서 조용히 빠지는데, 실제로 모르는 자리라는 점에서는 오답과 같다.
function weakAnswers() {
  return state.answers.filter((a) => !a.correct || a.confidence === 'guess')
}

function renderResult() {
  const total = state.answers.length
  const hits = state.answers.filter((a) => a.correct).length
  const rate = Math.round((hits / total) * 100)
  const g = gradeFor(rate)

  // 찍어서 맞은 것을 뺀 점수. 등급은 히트율로 매기고 이 숫자는 나란히 보여준다 —
  // 등급까지 두 개로 만들면 무엇이 자기 점수인지 알 수 없어진다.
  const lucky = state.answers.filter((a) => a.correct && a.confidence === 'guess').length
  const solidRate = Math.round(((hits - lucky) / total) * 100)

  $('#result-rate').innerHTML = `${rate}<span>%</span>`
  $('#result-grade').textContent = g.name
  $('#result-line').textContent = lucky
    ? `${total}문항 중 ${hits}문항을 맞혔습니다. 찍어서 맞은 ${lucky}문항을 빼면 ${solidRate}%입니다. ${g.line}`
    : `${total}문항 중 ${hits}문항을 맞혔습니다. ${g.line}`

  // 이전 최고 기록 (재도전 라운드는 기록하지 않는다)
  if (!state.isRetry) {
    const prev = Number(localStorage.getItem(STORE_KEY) || 0)
    if (rate > prev) localStorage.setItem(STORE_KEY, String(rate))
  }

  // 영역별
  const byTopic = {}
  for (const a of state.answers) {
    const t = a.q.topic
    byTopic[t] ||= { n: 0, ok: 0 }
    byTopic[t].n++
    if (a.correct) byTopic[t].ok++
  }
  const bars = $('#topic-bars')
  bars.innerHTML = ''
  Object.entries(byTopic)
    .sort((a, b) => b[1].ok / b[1].n - a[1].ok / a[1].n)
    .forEach(([t, v]) => {
      const pct = Math.round((v.ok / v.n) * 100)
      const row = document.createElement('div')
      row.className = 'tbar'
      row.innerHTML =
        `<span class="tbar-name">${TOPIC_LABEL[t] || t}</span>
         <span class="tbar-track"><span class="tbar-fill" style="width:${pct}%"></span></span>
         <span class="tbar-val">${v.ok}/${v.n}</span>`
      bars.appendChild(row)
    })

  // 확신했는데 틀린 문항 — 가장 값진 학습 지점
  const hyper = state.answers.filter((a) => !a.correct && a.confidence === 'sure')
  const hb = $('#hyper-block')
  if (hyper.length) {
    $('#hyper-list').innerHTML = hyper
      .map((a) => `<li>${escapeHtml(a.q.question)}</li>`)
      .join('')
    hb.classList.remove('hidden')
  } else {
    hb.classList.add('hidden')
  }

  // 찍어서 맞은 문항 — 맞았다는 표시에 가려 복습에서 빠지는 자리
  const guessed = state.answers.filter((a) => a.correct && a.confidence === 'guess')
  const gb = $('#guess-block')
  if (guessed.length) {
    $('#guess-list').innerHTML = guessed
      .map((a) => `<li>${escapeHtml(a.q.question)}</li>`)
      .join('')
    gb.classList.remove('hidden')
  } else {
    gb.classList.add('hidden')
  }

  // 전체 복습
  $('#review-list').innerHTML = state.answers
    .map((a) => {
      const c = a.q._shuffled.find((o) => o.correct)
      return `<li><span class="rv-mark ${a.correct ? 'ok' : 'bad'}">${a.correct ? '○' : '✕'}</span>
              <span class="rv-q">${escapeHtml(a.q.question)}</span>
              <span class="rv-a">정답: ${escapeHtml(c.text)}</span></li>`
    })
    .join('')

  const weak = weakAnswers()
  const retry = $('#btn-retry-wrong')
  retry.classList.toggle('hidden', weak.length === 0)
  retry.textContent = guessed.length
    ? `틀린 문항과 찍은 문항 ${weak.length}개 다시 풀기`
    : `틀린 문항 ${weak.length}개 다시 풀기`

  const text = lucky
    ? `나의 캐시 히트율은 ${rate}% (${g.name})\n찍어서 맞은 것을 빼면 ${solidRate}%\nCDN·이미지·동영상 서빙 퀴즈`
    : `나의 캐시 히트율은 ${rate}% (${g.name})\nCDN·이미지·동영상 서빙 퀴즈`
  $('#btn-tweet').href =
    `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(SITE_URL)}`

  state._last = { rate, grade: g, hits, total, byTopic, lucky, solidRate }
  track('finish', { len: total })
  show('#screen-result')
}

/* ── 결과 카드 PNG ─────────────────────────────────── */
function drawCard() {
  const { rate, grade: g, hits, total, byTopic, lucky, solidRate } = state._last
  const c = $('#card-canvas')
  const x = c.getContext('2d')
  const W = c.width, H = c.height

  x.fillStyle = '#0c0e12'
  x.fillRect(0, 0, W, H)

  // 은은한 그리드
  x.strokeStyle = 'rgba(111,155,255,.07)'
  x.lineWidth = 1
  for (let i = 0; i < W; i += 40) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, H); x.stroke() }
  for (let i = 0; i < H; i += 40) { x.beginPath(); x.moveTo(0, i); x.lineTo(W, i); x.stroke() }

  const F = '-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif'

  x.fillStyle = '#6f7787'
  x.font = `700 30px ${F}`
  x.fillText('cache', 80, 100)
  const wlogo = x.measureText('cache').width
  x.fillStyle = '#6f9bff'
  x.fillText('hit', 80 + wlogo, 100)

  x.fillStyle = '#a2abbb'
  x.font = `400 34px ${F}`
  x.fillText('나의 캐시 히트율', 80, 210)

  x.fillStyle = '#6f9bff'
  x.font = `800 190px ${F}`
  x.fillText(`${rate}%`, 74, 380)

  x.fillStyle = '#e9ecf1'
  x.font = `700 46px ${F}`
  x.fillText(g.name, 80, 452)

  x.fillStyle = '#6f7787'
  x.font = `400 28px ${F}`
  x.fillText(lucky
    ? `${total}문항 중 ${hits}문항 정답 · 찍은 것을 빼면 ${solidRate}%`
    : `${total}문항 중 ${hits}문항 정답`, 80, 500)

  // 영역별 미니 바
  let by = 190
  const bx = 700
  x.font = `500 24px ${F}`
  Object.entries(byTopic).slice(0, 5).forEach(([t, v]) => {
    const pct = v.ok / v.n
    x.fillStyle = '#a2abbb'
    x.fillText(TOPIC_LABEL[t] || t, bx, by + 8)
    x.fillStyle = '#242932'
    x.fillRect(bx + 140, by - 8, 300, 12)
    x.fillStyle = '#6f9bff'
    x.fillRect(bx + 140, by - 8, 300 * pct, 12)
    x.fillStyle = '#6f7787'
    x.fillText(`${v.ok}/${v.n}`, bx + 460, by + 8)
    by += 56
  })

  x.fillStyle = '#6f7787'
  x.font = `500 26px ${F}`
  x.fillText(SITE_URL.replace('https://', ''), 80, H - 60)

  return c
}

function saveCard() {
  const c = drawCard()
  c.toBlob((blob) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cachehit-${state._last.rate}.png`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, 'image/png')
}

/* ── 이벤트 ────────────────────────────────────────── */
$$('.btn-conf').forEach((b) =>
  b.addEventListener('click', () => grade(b.dataset.conf)))
$('#btn-next').addEventListener('click', next)
$('#btn-copy-q').addEventListener('click', async (e) => {
  const q = state.queue[state.idx]
  if (!q) return
  // currentTarget 은 await 이후 null 이 된다(이벤트 객체가 디스패치 후 초기화된다).
  const b = e.currentTarget
  const picked = q._shuffled?.[state.pending]
  const ok = await copyText(questionMarkdown(q, picked))
  if (ok) track('copy')
  b.textContent = ok ? '복사했습니다' : '복사 실패'
  b.dataset.done = ok ? '1' : ''
  clearTimeout(b._t)
  b._t = setTimeout(() => { b.textContent = '문항 복사'; b.dataset.done = '' }, 1800)
})
$('#btn-share').addEventListener('click', () => { track('share'); saveCard() })
$('#btn-tweet').addEventListener('click', () => track('share'))
$('#btn-restart').addEventListener('click', () => {
  state.isRetry = false
  show('#screen-intro')
})
$('#btn-retry-wrong').addEventListener('click', () => {
  const weak = weakAnswers().map((a) => a.q)
  if (!weak.length) return
  track('retry')
  state.isRetry = true
  startRound(shuffle(weak))
})

// 키보드: 1~4로 보기 선택, Enter로 다음
document.addEventListener('keydown', (e) => {
  if ($('#screen-quiz').classList.contains('hidden')) return
  if (!$('#feedback').classList.contains('hidden')) {
    if (e.key === 'Enter') { e.preventDefault(); next() }
    return
  }
  if (!$('#confidence').classList.contains('hidden')) {
    if (e.key === 'y' || e.key === '1') grade('sure')
    if (e.key === 'n' || e.key === '2') grade('unsure')
    if (e.key === '?' || e.key === '3') grade('guess')
    return
  }
  const n = Number(e.key)
  if (n >= 1 && n <= 4) {
    const btns = $$('#q-options .opt')
    if (btns[n - 1]) btns[n - 1].click()
  }
})

load()
