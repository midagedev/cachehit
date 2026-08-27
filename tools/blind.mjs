#!/usr/bin/env node
// 블라인드 풀이용 문항 세트를 만든다 (AUTHORING.md §6.2).
// 정답 표시와 해설을 제거해, 문항만 보고 풀게 한다.
//
// 사용: node tools/blind.mjs --out <문제파일> --key <정답키파일> [--only <topic>]

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const QDIR = join(ROOT, 'data', 'questions')

const arg = (name) => {
  const i = process.argv.indexOf(name)
  return i > -1 ? process.argv[i + 1] : null
}
const out = arg('--out')
const keyPath = arg('--key')
const only = arg('--only')
if (!out || !keyPath) {
  console.error('사용: node tools/blind.mjs --out <문제파일> --key <정답키파일> [--only <topic>]')
  process.exit(2)
}

// 결정적 셔플 — 같은 입력이면 같은 배치가 나오도록 id를 시드로 쓴다
function seededShuffle(arr, seed) {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    h = (h * 1103515245 + 12345) >>> 0
    const j = h % (i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

let all = []
for (const f of readdirSync(QDIR).filter((f) => f.endsWith('.json'))) {
  all.push(...JSON.parse(readFileSync(join(QDIR, f), 'utf8')))
}
if (only) all = all.filter((q) => q.topic === only)

const blind = []
const key = {}
for (const q of all) {
  const opts = seededShuffle(q.options, q.id)
  blind.push({
    id: q.id,
    topic: q.topic,
    question: q.question,
    options: opts.map((o, i) => ({ label: 'ABCD'[i], text: o.text })),
  })
  key[q.id] = {
    answer: 'ABCD'[opts.findIndex((o) => o.correct)],
    difficulty: q.difficulty,
    distractors: opts
      .map((o, i) => (o.correct ? null : { label: 'ABCD'[i], type: o.distractorType }))
      .filter(Boolean),
  }
}

writeFileSync(out, JSON.stringify(blind, null, 1), 'utf8')
writeFileSync(keyPath, JSON.stringify(key, null, 1), 'utf8')
console.log(`블라인드 세트 ${blind.length}문항 → ${out}`)
console.log(`정답 키 → ${keyPath}`)
