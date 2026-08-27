#!/usr/bin/env node
// 문항이 인용한 RFC 절 번호가 실제로 존재하고, 괄호에 적은 이름이 그 절의 실제
// 제목과 맞는지 원문과 대조한다.
//
// 왜 필요한가: 틀린 절 번호는 화면에서 맞는 번호와 구분되지 않는다. 클릭 한 번으로
// 확인되는 종류의 오류이므로, 하나만 있어도 나머지 인용 전체의 신뢰가 같이 떨어진다.
// 실측(2026-08-27): 세 문항이 Vary 를 RFC 9110 §12.5.1(실제는 Accept)로, 한 문항이
// If-Range 를 §13.1.4(실제는 If-Unmodified-Since)로 인용하고 있었다. 사람의 눈으로
// 잡힌 것이 아니라 위임 라운드가 목차를 열어 보고 발견했다 — 즉 이 축은 비어 있었다.
//
// 네트워크를 타므로 validate.mjs(오프라인 게이트)와 섞지 않는다. check-links.mjs 와
// 같은 계열이고, 링크의 생존이 아니라 인용의 정확성을 본다.
//
// 사용: node tools/check-rfc-sections.mjs [--verbose]
//   --verbose  인용 31건 전부의 실제 절 제목을 출력한다(눈으로 훑을 때)
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const QDIR = join(ROOT, 'data', 'questions')
const CACHE = join(tmpdir(), 'cachehit-rfc-cache')
const VERBOSE = process.argv.includes('--verbose')

// 괄호 안이 절 제목인지 산문인지 가른다. 한글이 섞이면 우리가 쓴 설명이므로 제목
// 대조를 하지 않는다 — 그걸 제목으로 오해하면 게이트가 멀쩡한 인용을 잡는다.
const isHeaderName = (s) => s && !/[가-힣]/.test(s)

async function rfcText(num) {
  mkdirSync(CACHE, { recursive: true })
  const p = join(CACHE, `rfc${num}.txt`)
  if (existsSync(p)) return readFileSync(p, 'utf8')
  const res = await fetch(`https://www.rfc-editor.org/rfc/rfc${num}.txt`, {
    redirect: 'follow', signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`RFC ${num} 을 받을 수 없다 (HTTP ${res.status})`)
  const body = await res.text()
  writeFileSync(p, body, 'utf8')
  return body
}

// 본문의 절 헤더만 읽는다(목차는 들여쓰기가 있으므로 행 시작 기준으로 걸러진다).
function sectionTitles(body) {
  const map = new Map()
  for (const line of body.split('\n')) {
    const m = /^(\d+(?:\.\d+)*)\.?\s+(\S.*?)\s*$/.exec(line)
    if (!m) continue
    if (!map.has(m[1])) map.set(m[1], m[2])
  }
  return map
}

const questions = []
for (const f of readdirSync(QDIR).filter((f) => f.endsWith('.json')))
  questions.push(...JSON.parse(readFileSync(join(QDIR, f), 'utf8')))

// 'RFC 9110 §13.1.5 (If-Range), §8.8 (Validator Fields)' 처럼 두 번째 인용이 RFC 번호를
// 생략하는 표기를 쓴다. 번호 있는 인용만 보면 그 연속 인용이 통째로 검사 밖으로 빠진다
// (실측: §8.8 을 "(Validators)" 로 잘못 적은 두 문항 중 한 건만 잡혔다).
const CITE = /(?:RFC\s*(\d{3,5})\s*)?§\s*(\d+(?:\.\d+)*)(?:\s*\(([^)]*)\))?/g
const cites = []
for (const q of questions) {
  let last = null
  for (const m of (q.source || '').matchAll(CITE)) {
    const rfc = m[1] || last
    if (!rfc) continue // 어떤 RFC 인지 알 수 없는 § 표기는 이 게이트의 대상이 아니다
    last = rfc
    cites.push({ id: q.id, rfc, sec: m[2], label: (m[3] || '').trim() })
  }
}

const rfcs = [...new Set(cites.map((c) => c.rfc))]
console.log(`절 인용 ${cites.length}건 · RFC ${rfcs.length}종 대조 중…\n`)

const titles = new Map()
for (const n of rfcs) titles.set(n, sectionTitles(await rfcText(n)))

const missing = []
const mismatched = []
for (const c of cites) {
  const t = titles.get(c.rfc).get(c.sec)
  if (!t) { missing.push({ ...c, actual: null }); continue }
  if (VERBOSE) console.log(`  RFC ${c.rfc} §${c.sec} = "${t}"   ${c.id}`)
  if (!isHeaderName(c.label)) continue
  const a = t.toLowerCase()
  const b = c.label.toLowerCase()
  if (!a.includes(b) && !b.includes(a)) mismatched.push({ ...c, actual: t })
}

console.log(`\n인용 ${cites.length} · 존재하지 않는 절 ${missing.length} · 제목 불일치 ${mismatched.length}`)

if (missing.length) {
  console.log('\n존재하지 않는 절:')
  for (const c of missing) console.log(`  ${c.id}: RFC ${c.rfc} §${c.sec}`)
}
if (mismatched.length) {
  console.log('\n괄호의 이름이 그 절의 제목이 아님:')
  for (const c of mismatched)
    console.log(`  ${c.id}: RFC ${c.rfc} §${c.sec} 을 "(${c.label})" 로 적었지만 실제 제목은 "${c.actual}"`)
}
if (missing.length || mismatched.length) {
  console.log('\n실패 — 틀린 절 번호는 근거가 아니라 근거처럼 보이는 것이다.')
  process.exit(1)
}
console.log('\nRFC 절 인용 검사 통과')
