#!/usr/bin/env node
// 사실 검증용 세트를 만든다. 블라인드 세트(tools/blind.mjs)와 정반대다.
//
// 블라인드 감사는 정답을 숨기고 "지식 없이 요령으로 풀리는가"를 묻는다. 그것은
// 문항의 **형태**를 보는 축이고, 세 라운드를 돌려 다듬었다.
//
// 이 세트는 정답·해설·근거를 전부 **보여 주고** "이 주장이 사실인가"를 묻는다.
// 형태가 아무리 좋아도 정답이 틀렸으면 그 문항은 최악이며, 그 결함은 블라인드
// 감사로는 원리상 잡히지 않는다 — 답을 모르는 사람에게 물었기 때문이다.
//
// 사용: node tools/factcheck-set.mjs [--out <path>] [--topic <name>]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { linksFor } from './sources.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const QDIR = join(ROOT, 'data', 'questions')

const arg = (name) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : null
}
const only = arg('--topic')
const out = arg('--out') || join(ROOT, 'factcheck-set.json')

const all = []
for (const f of readdirSync(QDIR).filter((f) => f.endsWith('.json'))) {
  if (only && f !== `${only}.json`) continue
  all.push(...JSON.parse(readFileSync(join(QDIR, f), 'utf8')))
}

const set = all.map((q) => ({
  id: q.id,
  topic: q.topic,
  difficulty: q.difficulty,
  question: q.question,
  // 정답이 어느 것인지 명시한다 — 숨기면 검증이 아니라 풀이가 된다
  answer: q.options.find((o) => o.correct)?.text,
  answerWhy: q.options.find((o) => o.correct)?.why,
  distractors: q.options.filter((o) => !o.correct).map((o) => ({
    text: o.text,
    type: o.distractorType,
    why: o.why,
  })),
  explanation: q.explanation,
  source: q.source,
  sourceLinks: linksFor(q.source).map((l) => l.url),
}))

writeFileSync(out, JSON.stringify(set, null, 2), 'utf8')
console.log(`사실 검증 세트 ${set.length}문항 → ${out}`)
