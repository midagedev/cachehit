#!/usr/bin/env node
// 블라인드 풀이 결과를 채점해 "오답이 실제로 경쟁하는가"를 판정한다 (AUTHORING.md §6.2).
//
// 사용: node tools/grade-blind.mjs --key <정답키> --answers <응답파일>
//
// 응답파일 형식:
// [ { "id": "...", "answer": "B", "heuristicOnly": true|false, "note": "..." }, ... ]
//
// 판정 기준
//  - 정답률이 높은 문항  → 오답이 약하다(경쟁하지 않는다). 교체 후보.
//  - heuristicOnly=true → 지식 없이 요령으로 풀린다. 재작성 대상.
//  - 아무도 안 고른 오답 → 죽은 보기. 다른 오개념으로 교체.

import { readFileSync } from 'node:fs'

const arg = (n) => {
  const i = process.argv.indexOf(n)
  return i > -1 ? process.argv[i + 1] : null
}
const keyPath = arg('--key')
const ansPath = arg('--answers')
if (!keyPath || !ansPath) {
  console.error('사용: node tools/grade-blind.mjs --key <정답키> --answers <응답파일>')
  process.exit(2)
}

const key = JSON.parse(readFileSync(keyPath, 'utf8'))
const answers = JSON.parse(readFileSync(ansPath, 'utf8'))

// 난이도별 목표 정답률 (AUTHORING.md §5)
// 블라인드 풀이자는 도메인 지식이 있는 모델이므로 목표치보다 높게 나오는 것이 정상이다.
// 여기서 잡으려는 것은 "지나치게 쉬운" 문항이다.
const TOO_EASY = { 1: 1.0, 2: 0.95, 3: 0.85 }

const picked = {}     // id -> 선택 라벨
let correct = 0
const flagged = []
const heuristic = []
const missing = []

for (const id of Object.keys(key)) {
  const a = answers.find((x) => x.id === id)
  if (!a) { missing.push(id); continue }
  picked[id] = a.answer
  const ok = a.answer === key[id].answer
  if (ok) correct++
  if (a.heuristicOnly === true) heuristic.push({ id, note: a.note || '' })
}

const answered = Object.keys(picked).length
const rate = answered ? correct / answered : 0

// 난이도별 집계
const byDiff = {}
for (const id of Object.keys(picked)) {
  const d = key[id].difficulty
  byDiff[d] ||= { n: 0, ok: 0 }
  byDiff[d].n++
  if (picked[id] === key[id].answer) byDiff[d].ok++
}

// 죽은 보기 — 아무도 고르지 않은 오답
const deadOptions = []
for (const id of Object.keys(key)) {
  const chosen = picked[id]
  for (const d of key[id].distractors) {
    if (d.label !== chosen) deadOptions.push({ id, label: d.label, type: d.type })
  }
}
// 풀이자가 1명이면 "안 고른 오답"이 대부분이라 신호가 약하다. 참고용으로만 집계한다.

console.log(`블라인드 풀이 결과`)
console.log(`  응답: ${answered}/${Object.keys(key).length}${missing.length ? ` (누락 ${missing.length}: ${missing.slice(0, 5).join(', ')}…)` : ''}`)
console.log(`  정답률: ${correct}/${answered} = ${(rate * 100).toFixed(1)}%`)
for (const d of [1, 2, 3]) {
  if (!byDiff[d]) continue
  const r = byDiff[d].ok / byDiff[d].n
  const tooEasy = r > TOO_EASY[d]
  console.log(`  난이도 ${d}: ${byDiff[d].ok}/${byDiff[d].n} = ${(r * 100).toFixed(0)}%${tooEasy ? '  ← 목표보다 쉬움' : ''}`)
}

if (heuristic.length) {
  console.log(`\n요령만으로 풀린다고 보고된 문항 ${heuristic.length}건 — 재작성 대상`)
  for (const h of heuristic) console.log(`  ✗ ${h.id}${h.note ? ` — ${h.note}` : ''}`)
} else {
  console.log('\n요령만으로 풀린다고 보고된 문항 없음')
}

// 난이도 3인데 맞힌 문항 = 오답이 경쟁하지 못했을 가능성
const hardButCorrect = Object.keys(picked).filter(
  (id) => key[id].difficulty === 3 && picked[id] === key[id].answer)
if (hardButCorrect.length) {
  console.log(`\n난이도 3인데 정답 처리된 문항 ${hardButCorrect.length}건 — 난이도 재분류 검토`)
  console.log(`  ${hardButCorrect.join(', ')}`)
}

const problems = heuristic.length
process.exit(problems > 0 ? 1 : 0)
