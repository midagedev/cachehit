/* cachehit — 콘텐츠 서빙 퀴즈
 *
 * 학습 설계(AUTHORING.md §0):
 *  - 답 선택 → 확신도 → 즉시 채점. 확신했는데 틀린 것을 따로 표시한다(hypercorrection).
 *  - 정답 해설뿐 아니라 "고른 오답이 왜 틀렸는지"를 함께 보여준다.
 *  - 틀린 문항만 다시 푸는 라운드를 제공한다(교정 직후 재인출).
 */

const QUIZ_LENGTH = 20
const STORE_KEY = 'cachehit.best.v1'
const SITE_URL = 'https://midagedev.github.io/cachehit'

const TOPIC_LABEL = {
  cdn: 'CDN',
  caching: 'HTTP 캐싱',
  image: '이미지',
  video: '동영상',
  storage: '스토리지',
}

const GRADES = [
  { min: 90, name: 'ORIGIN SHIELD', line: '오리진까지 갈 일이 거의 없군요. 이 정도면 설계를 맡깁니다.' },
  { min: 75, name: 'CACHE HIT', line: '대부분 엣지에서 끝냅니다. 실무에서 바로 통하는 수준이에요.' },
  { min: 55, name: 'STALE WHILE REVALIDATE', line: '일단 응답은 나갑니다. 뒤에서 조용히 갱신할 부분이 남았네요.' },
  { min: 35, name: 'TTL EXPIRED', line: '알던 것들이 조금씩 만료됐습니다. 재검증할 때가 됐어요.' },
  { min: 0, name: 'CACHE MISS', line: '전부 오리진까지 갔습니다. 여기서부터 채우면 됩니다.' },
]

const $ = (s) => document.querySelector(s)
const $$ = (s) => Array.from(document.querySelectorAll(s))

const state = {
  pool: [],       // 전체 문항
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
  const n = Math.min(QUIZ_LENGTH, state.pool.length)
  $('#intro-count').textContent = n
  $('#intro-minutes').textContent = Math.max(3, Math.round(n * 0.5))

  const best = localStorage.getItem(STORE_KEY)
  if (best) {
    const el = $('#best-record')
    el.querySelector('b').textContent = `${best}%`
    el.classList.remove('hidden')
  }

  $('#btn-start').addEventListener('click', () => startRound(pickQuestions(n)))
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
      guess: '틀렸습니다<small>모르는 자리를 찾았습니다. 찍은 것을 정직하게 눌러 두면 결과에서 따로 모아 드립니다.</small>',
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
  $('#source').textContent = q.source ? `근거: ${q.source}` : ''

  $('#btn-next').textContent = state.idx === state.queue.length - 1 ? '결과 보기' : '다음'
  $('#feedback').classList.remove('hidden')
  $('#feedback').scrollIntoView({ behavior: 'smooth', block: 'nearest' })
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
    ? `${total}문항 중 ${hits}문항 — 찍어서 맞은 ${lucky}문항을 빼면 ${solidRate}% · ${g.line}`
    : `${total}문항 중 ${hits}문항 — ${g.line}`

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
    ? `나의 캐시 히트율은 ${rate}% — ${g.name}\n찍어서 맞은 걸 빼면 ${solidRate}%\nCDN·이미지·동영상 서빙 퀴즈`
    : `나의 캐시 히트율은 ${rate}% — ${g.name}\nCDN·이미지·동영상 서빙 퀴즈`
  $('#btn-tweet').href =
    `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(SITE_URL)}`

  state._last = { rate, grade: g, hits, total, byTopic, lucky, solidRate }
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
    ? `${total}문항 중 ${hits}문항 정답 · 찍은 것 빼면 ${solidRate}%`
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
$('#btn-share').addEventListener('click', saveCard)
$('#btn-restart').addEventListener('click', () => {
  state.isRetry = false
  show('#screen-intro')
})
$('#btn-retry-wrong').addEventListener('click', () => {
  const weak = weakAnswers().map((a) => a.q)
  if (!weak.length) return
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
