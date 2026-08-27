#!/usr/bin/env node
// data/questions/*.json 을 사이트가 읽는 data/questions.json 하나로 합친다.
// 검증을 통과하지 못하면 빌드하지 않는다.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const QDIR = join(ROOT, 'data', 'questions')
const OUT = join(ROOT, 'data', 'questions.json')

try {
  execFileSync('node', [join(ROOT, 'tools', 'validate.mjs')], { stdio: 'inherit' })
} catch {
  console.error('\n검증 실패 — 빌드하지 않습니다.')
  process.exit(1)
}

const all = []
for (const f of readdirSync(QDIR).filter((f) => f.endsWith('.json'))) {
  const arr = JSON.parse(readFileSync(join(QDIR, f), 'utf8'))
  all.push(...arr)
}

// 사이트가 쓰지 않는 저작용 필드는 빼고 내보낸다
const slim = all.map((q) => ({
  id: q.id,
  topic: q.topic,
  difficulty: q.difficulty,
  question: q.question,
  options: q.options.map((o) => ({
    text: o.text,
    ...(o.correct ? { correct: true } : {}),
    why: o.why,
  })),
  explanation: q.explanation,
  source: q.source,
}))

writeFileSync(OUT, JSON.stringify(slim), 'utf8')
console.log(`\n빌드 완료: ${slim.length}문항 → data/questions.json`)
