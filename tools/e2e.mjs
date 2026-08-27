// 퀴즈 흐름의 회귀 테스트. 20문항을 자동으로 풀어 확신도 3단계와 결과 집계를 검증한다.
//
// 왜 있는가: 확신도 축의 집계(찍어서 맞은 문항, 그것을 뺀 점수, 재도전 대상)는 화면을
// 끝까지 진행해야 나타나는 상태라 손으로 확인하기 번거롭고, 그래서 조용히 회귀한다.
// `validate.mjs` 는 문항 데이터만 보고 앱 로직은 보지 않는다.
//
// 실행:  npx playwright install chromium   (한 번)
//        이 레포는 package.json 이 없다(순수 node + 정적 사이트). 로컬에서는 playwright 가
//        있는 다른 레포를 붙이는 것으로 충분하다 — `ln -s <다른레포>/node_modules node_modules`
//        (.gitignore 에 있으므로 커밋되지 않는다). CI 는 워크플로에서 직접 설치한다.
//        node tools/e2e.mjs
//
// 로컬 HTTP 서버를 띄우지 않고 playwright 라우팅으로 파일을 서빙한다 — 리스닝 소켓이
// 막힌 환경에서도 돌아야 하고, 포트 충돌도 없다.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
}

let chromium
try {
  ({ chromium } = await import('playwright'))
} catch {
  console.log('playwright 가 없어 건너뜁니다. 설치: npm i -D playwright && npx playwright install chromium')
  process.exit(0)
}

const ROUNDS = 20
const CONF = ['sure', 'unsure', 'guess']

// 정답을 미리 알고 클릭한다. 무작위로 고르면 '찍어서 맞음'이 0건인 라운드가 나오고,
// 그러면 검증하려는 경로가 실행되지 않은 채 통과한다.
const ANSWER = new Map(
  JSON.parse(fs.readFileSync(path.join(ROOT, 'data/questions.json'), 'utf8'))
    .map((q) => [q.question, q.options.find((o) => o.correct).text]))

const SITE_MARK = 'cachehit.pages.dev'

const browser = await chromium.launch()
// https 로 서빙한다 — clipboard API 는 보안 컨텍스트에서만 존재하고, 문항 복사가
// 실제로 쓰는 경로가 그것이다. 라우팅으로 응답을 만들어 주므로 진짜 TLS 는 없다.
const context = await browser.newContext({
  viewport: { width: 900, height: 1200 },
  permissions: ['clipboard-read', 'clipboard-write'],
  ignoreHTTPSErrors: true,
})
const page = await context.newPage()
const jsErrors = []
page.on('pageerror', (e) => jsErrors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') jsErrors.push('console: ' + m.text()) })

// 집계 비컨은 배포 호스트에서만 나가야 한다(assets/app.js 의 ANALYTICS_HOSTS 게이트).
// 테스트 호스트에서 한 건이라도 나가면 게이트가 뚫린 것이다 — 이 검사가 없으면
// 로컬 실행·E2E 가 실데이터를 오염시키는 회귀를 아무도 눈치채지 못한다.
const beacons = []
page.on('request', (r) => { if (r.url().includes('/collect')) beacons.push(r.url()) })

await page.route('**/*', (route) => {
  const u = new URL(route.request().url())
  const file = path.join(ROOT, u.pathname === '/' ? '/index.html' : u.pathname)
  if (!file.startsWith(ROOT) || !fs.existsSync(file))
    return route.fulfill({ status: 404, body: 'not found' })
  route.fulfill({
    status: 200,
    contentType: MIME[path.extname(file)] || 'application/octet-stream',
    body: fs.readFileSync(file),
  })
})

await page.goto('https://cachehit.test/', { waitUntil: 'networkidle' })

// 길이 선택: 기본이 10인지 확인하고, 본 검증은 20문항 라운드로 돌린다
const defaultLen = await page.getAttribute('.btn-len[data-len="10"]', 'aria-pressed')
if (defaultLen !== 'true') throw new Error('기본 라운드 길이가 10문항이 아니다')
await page.click(`.btn-len[data-len="${ROUNDS}"]`)
await page.click('#btn-start')
const counter = await page.textContent('#q-counter')
if (!counter.includes(`/ ${ROUNDS}`)) throw new Error(`라운드 길이가 ${ROUNDS} 이 아니다: ${counter}`)

const tally = { hits: 0, luckyHits: 0, sureWrong: 0, guessWrong: 0, withLinks: 0 }

for (let i = 0; i < ROUNDS; i++) {
  await page.waitForSelector('#q-options .opt:not([disabled])')
  const opts = await page.$$('#q-options .opt')
  const stem = (await page.textContent('#q-text')).trim()
  const answer = ANSWER.get(stem)
  if (!answer) throw new Error(`발문을 questions.json 에서 못 찾음: ${stem.slice(0, 50)}`)
  const texts = await Promise.all(opts.map((o) => o.textContent()))
  const ci = texts.findIndex((t) => t.includes(answer))
  if (ci < 0) throw new Error(`정답 보기를 화면에서 못 찾음: ${answer.slice(0, 50)}`)

  // 확신도를 순환시키고, 절반은 맞히고 절반은 틀리게 골라 네 조합을 모두 만든다
  const aimCorrect = i % 2 === 0
  await opts[aimCorrect ? ci : (ci + 1) % opts.length].click()

  await page.waitForSelector('#confidence:not(.hidden)')
  const conf = CONF[i % 3]
  await page.click(`.btn-conf[data-conf="${conf}"]`)

  await page.waitForSelector('#feedback:not(.hidden)')
  const ok = (await page.getAttribute('#verdict', 'data-r')) === 'ok'
  if (ok) tally.hits++
  if (ok && conf === 'guess') tally.luckyHits++
  if (!ok && conf === 'guess') tally.guessWrong++
  if (!ok && conf === 'sure') tally.sureWrong++

  if (i === 0) {
    await page.click('#btn-copy-q')
    await page.waitForFunction(() => document.querySelector('#btn-copy-q').dataset.done === '1', null, { timeout: 3000 })
    const md = await page.evaluate(() => navigator.clipboard.readText())
    for (const need of ['## ', '**정답**', stem.slice(0, 20), SITE_MARK])
      if (!md.includes(need)) throw new Error(`복사된 마크다운에 "${need.slice(0, 24)}" 가 없다`)
    if (md.split('\n').filter((l) => /^[ABCD]\. /.test(l)).length !== 4)
      throw new Error('복사된 마크다운의 보기가 4개가 아니다')
  }

  // 원문 링크가 렌더되는지. 빌드가 sourceLinks 를 붙이지 않으면 조용히 사라지는 자리다.
  const links = await page.$$eval('#source .source-link',
    (as) => as.map((a) => ({ href: a.href, text: a.textContent.trim() })))
  if (links.length) {
    tally.withLinks++
    for (const l of links) {
      if (!/^https:\/\//.test(l.href)) throw new Error(`원문 링크가 https 가 아니다: ${l.href}`)
      if (!l.text) throw new Error('원문 링크에 라벨이 없다')
    }
  }

  const verdict = await page.textContent('#verdict')
  if (conf === 'guess' && ok && !verdict.includes('찍어서 맞았습니다'))
    throw new Error('찍어서 맞은 문항에 그 사실을 알리는 문구가 없다')

  await page.click('#btn-next')
}

await page.waitForSelector('#screen-result:not(.hidden)')
const got = {
  line: (await page.textContent('#result-line')).trim(),
  retry: (await page.textContent('#btn-retry-wrong')).trim(),
  guessShown: !(await page.getAttribute('#guess-block', 'class')).includes('hidden'),
  guessCount: (await page.$$('#guess-list li')).length,
  hyperCount: (await page.$$('#hyper-list li')).length,
  tweet: decodeURIComponent((await page.getAttribute('#btn-tweet', 'href')).split('text=')[1].split('&')[0]),
  // 영역별 바가 실제로 화면을 차지하는지. 정답이 있는 주제의 채움 폭이 0 이면
  // 바는 DOM 에 있고 CSS 도 유효한데 보이지 않는 상태다(인라인 요소는 width 를
  // 무시한다). 값·클래스만 확인하는 단언으로는 이 부류가 통째로 빠져나간다.
  bars: await page.$$eval('#topic-bars .tbar', (rows) => rows.map((r) => ({
    label: r.querySelector('.tbar-name')?.textContent?.trim(),
    val: r.querySelector('.tbar-val')?.textContent?.trim(),
    trackPx: Math.round(r.querySelector('.tbar-track')?.getBoundingClientRect().width || 0),
    fillPx: Math.round(r.querySelector('.tbar-fill')?.getBoundingClientRect().width || 0),
    fillH: Math.round(r.querySelector('.tbar-fill')?.getBoundingClientRect().height || 0),
  }))),
}

const fails = []
const solid = Math.round(((tally.hits - tally.luckyHits) / ROUNDS) * 100)
const weak = (ROUNDS - tally.hits) + tally.luckyHits

if (!tally.luckyHits) fails.push('찍어서 맞은 사례가 만들어지지 않아 검증이 성립하지 않았다')
if (got.guessCount !== tally.luckyHits) fails.push(`찍어서 맞은 목록 ${got.guessCount} ≠ ${tally.luckyHits}`)
if (tally.luckyHits && !got.guessShown) fails.push('찍어서 맞은 블록이 숨겨져 있다')
if (got.hyperCount !== tally.sureWrong) fails.push(`확신 오답 목록 ${got.hyperCount} ≠ ${tally.sureWrong}`)
if (tally.luckyHits && !got.line.includes(`${solid}%`)) fails.push(`결과 줄에 확신 점수 ${solid}% 가 없다`)
if (tally.luckyHits && !got.tweet.includes(`${solid}%`)) fails.push('공유 문구에 확신 점수가 없다')
if (tally.luckyHits && !got.retry.includes('찍은')) fails.push('재도전 버튼이 찍은 문항을 포함한다고 알리지 않는다')
if (!got.retry.includes(String(weak))) fails.push(`재도전 대상 수 ${weak} 미표기: "${got.retry}"`)
// 88/89 문항에 링크가 붙어 있으므로 20문항이면 거의 전부여야 한다. 크게 모자라면
// 빌드가 sourceLinks 를 붙이지 않았거나 렌더가 끊긴 것이다.
if (tally.withLinks < ROUNDS - 3) fails.push(`원문 링크가 보인 문항 ${tally.withLinks}/${ROUNDS} — 너무 적다`)

// 영역별 바 — 폭·높이를 실측한다. 0/N 인 주제는 채움이 0 이어야 정상이므로 제외한다.
if (!got.bars.length) fails.push('영역별 바가 하나도 렌더되지 않았다')
for (const b of got.bars) {
  const [ok] = (b.val || '0/0').split('/').map(Number)
  if (b.trackPx < 20) fails.push(`영역별 바 트랙에 폭이 없다: ${b.label} ${b.trackPx}px`)
  if (b.fillH < 4) fails.push(`영역별 바 채움에 높이가 없다: ${b.label} ${b.fillH}px`)
  if (ok > 0 && b.fillPx < 2) fails.push(`영역별 바 채움이 보이지 않는다: ${b.label} ${b.val} 인데 ${b.fillPx}px`)
}

// 결과 카드 PNG 가 그려지는지 (canvas 렌더는 예외가 나도 조용해서 여기서만 잡힌다)
await page.click('#btn-share')
await page.waitForTimeout(500)

// 눈으로 볼 필요가 있을 때만 — 게이트는 위의 실측으로 판정하고, 이건 사람이 보는 용도다.
if (process.env.E2E_SHOT) {
  await page.screenshot({ path: process.env.E2E_SHOT, fullPage: true })
  console.log(`결과 화면 캡처 → ${process.env.E2E_SHOT}`)
}

await browser.close()

console.log(`${ROUNDS}문항 진행 — 정답 ${tally.hits} / 찍어서 맞음 ${tally.luckyHits} / 확신 오답 ${tally.sureWrong}`)
console.log(`  ${got.line}`)
console.log(`  재도전: ${got.retry}`)
console.log(`  원문 링크가 보인 문항: ${tally.withLinks}/${ROUNDS}`)
if (beacons.length)
  fails.push(`테스트 호스트에서 집계 비컨이 ${beacons.length}건 나갔다 — ANALYTICS_HOSTS 게이트가 뚫렸다: ${beacons[0]}`)
if (jsErrors.length) {
  console.log(`\nJS 오류 ${jsErrors.length}건`)
  for (const e of jsErrors) console.log(`  ✗ ${e}`)
}
if (fails.length) {
  console.log(`\n실패 ${fails.length}건`)
  for (const f of fails) console.log(`  ✗ ${f}`)
  console.log('\nE2E 실패')
} else {
  console.log('\nE2E 통과')
}
process.exit(fails.length || jsErrors.length ? 1 : 0)
