#!/usr/bin/env node
// data/sources.json 의 URL 과 문항이 만들어 내는 RFC 링크가 실제로 살아 있는지 확인한다.
//
// 왜 별도 도구인가: 죽은 링크는 지어낸 근거와 화면에서 구분되지 않는다. 이 퀴즈의
// 주장은 "모든 오답에 출처가 있다"이므로, 그 출처가 404 면 주장 자체가 무너진다.
// 네트워크를 타므로 validate.mjs(오프라인 게이트)와 섞지 않는다.
//
// 사용: node tools/check-links.mjs [--verbose]
//
// 403 은 실패로 보지 않는다. Medium·ISO·Cloudflare 는 curl 류 클라이언트를 차단하지만
// 사람이 열면 정상이다. 이걸 실패로 읽으면 멀쩡한 링크를 지우게 된다.
import { readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { linksFor, REGISTRY } from './sources.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const QDIR = join(ROOT, 'data', 'questions')
const VERBOSE = process.argv.includes('--verbose')
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 cachehit-link-check'

const urls = new Map() // url -> 라벨
for (const e of REGISTRY) urls.set(e.url, e.label)

const questions = []
for (const f of readdirSync(QDIR).filter((f) => f.endsWith('.json')))
  questions.push(...JSON.parse(readFileSync(join(QDIR, f), 'utf8')))

// 문항이 실제로 만들어 내는 링크(RFC 앵커 포함)까지 검사 대상에 넣는다
const unlinked = []
for (const q of questions) {
  const ls = linksFor(q.source)
  if (!ls.length) unlinked.push(q.id)
  for (const l of ls) if (!urls.has(l.url)) urls.set(l.url, l.label)
}

// 레지스트리에 있으나 어느 문항도 쓰지 않는 항목 — 오타이거나 죽은 규칙이다
const used = new Set(questions.flatMap((q) => linksFor(q.source).map((l) => l.url)))
const orphans = REGISTRY.filter((e) => !used.has(e.url)).map((e) => e.match)

// 연결 오류는 curl 로 한 번 더 본다. 계측기를 한 번 의심하는 자리다 — itu.int 와
// ijg.org 는 curl 로 200 을 주면서 node fetch 에는 ETIMEDOUT 을 냈다(2026-08-27 실측).
// fetch 만 믿었으면 멀쩡한 링크 둘을 죽었다고 판정해 지웠을 것이다.
function curlStatus(url) {
  try {
    return Number(execFileSync('curl',
      ['-sL', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '25', '-A', UA, url],
      { encoding: 'utf8' }).trim())
  } catch {
    return null
  }
}

async function head(url) {
  try {
    // 일부 문서 사이트는 HEAD 를 막아 두므로 GET 으로 확인하되 본문은 버린다
    const res = await fetch(url, {
      method: 'GET', redirect: 'follow',
      signal: AbortSignal.timeout(20000),
      headers: { 'user-agent': UA },
    })
    res.body?.cancel?.()
    return res.status
  } catch (e) {
    const viaCurl = curlStatus(url)
    if (viaCurl) return viaCurl
    return `ERR ${e.name === 'TimeoutError' ? 'timeout' : (e.cause?.code || e.message)}`
  }
}

const list = [...urls.entries()]
console.log(`URL ${list.length}개 확인 중…\n`)

const dead = []
const blocked = []
const CONCURRENCY = 6
for (let i = 0; i < list.length; i += CONCURRENCY) {
  const batch = list.slice(i, i + CONCURRENCY)
  const results = await Promise.all(batch.map(async ([url, label]) => [url, label, await head(url)]))
  for (const [url, label, status] of results) {
    const ok = status >= 200 && status < 300
    const isBlocked = status === 403 || status === 401 || status === 429
    if (ok) { if (VERBOSE) console.log(`  ${status} ${url}`) }
    else if (isBlocked) { blocked.push([status, url, label]); console.log(`  ${status} (봇 차단으로 봄) ${url}`) }
    else { dead.push([status, url, label]); console.log(`  ${status} ✗ ${url}`) }
  }
}

console.log(`\n확인 ${list.length} · 정상 ${list.length - dead.length - blocked.length} · 봇차단 ${blocked.length} · 죽음 ${dead.length}`)
if (unlinked.length) console.log(`원문 링크가 없는 문항 ${unlinked.length}건: ${unlinked.join(', ')}`)
if (orphans.length) console.log(`어느 문항도 쓰지 않는 레지스트리 항목 ${orphans.length}건: ${orphans.join(' / ')}`)

if (dead.length) {
  console.log('\n죽은 링크:')
  for (const [s, url, label] of dead) console.log(`  [${s}] ${label}\n        ${url}`)
  console.log('\n실패 — 죽은 링크는 지어낸 근거와 구분되지 않는다. 고치거나 레지스트리에서 빼라.')
  process.exit(1)
}
console.log('\n링크 검사 통과')
