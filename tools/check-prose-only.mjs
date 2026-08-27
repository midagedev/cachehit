#!/usr/bin/env node
// 표현만 고친 라운드가 정말 표현만 고쳤는지, 기준 커밋과 대조해서 단언한다.
//
// 왜 필요한가: 한국어 교정 라운드는 문항 149개의 문자열 1490개를 만진다. 그 diff 를 눈으로 읽어
// "정답이 그대로인가, 오답이 참이 되지 않았나"를 확인하는 것은 사람이 할 수 있는 일이 아니다.
// 사실 관계는 기계가 판정할 수 없지만, **구조가 바뀌지 않았다는 것**은 기계가 단언할 수 있다.
// 정답의 위치, 보기 개수와 순서, distractorType, source, tags, difficulty, topic, id 가 전부
// 같다면 남은 위험은 문장의 의미뿐이므로, 사람이 읽어야 하는 diff 가 그만큼 좁아진다.
//
// 실측(2026-08-27): 이 게이트를 만들기 전에는 검수 범위가 "diff 전체"였고, 만든 뒤에는
// "텍스트가 바뀐 필드 목록"으로 좁아졌다.
//
// 사용: node tools/check-prose-only.mjs <기준-git-ref> [--show <n>]
//   --show <n>  텍스트가 바뀐 필드를 n건까지 before/after 로 출력한다 (기본 0)
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const base = process.argv[2]
if (!base) {
  console.error('사용: node tools/check-prose-only.mjs <기준-git-ref> [--show <n>]')
  process.exit(64)
}
const showIdx = process.argv.indexOf('--show')
const SHOW = showIdx > 0 ? Number(process.argv[showIdx + 1] || 0) : 0

const files = readdirSync(join(ROOT, 'data', 'questions')).filter((f) => f.endsWith('.json'))

// 표현 교정이 건드려도 되는 필드. 이 목록에 없는 모든 필드는 바뀌면 실패다.
const PROSE = new Set(['question', 'explanation', 'text', 'why'])

const load = (raw) => {
  const map = new Map()
  for (const q of JSON.parse(raw)) map.set(q.id, q)
  return map
}

const errors = []
const changed = []

for (const f of files) {
  const rel = `data/questions/${f}`
  let beforeRaw
  try {
    beforeRaw = execFileSync('git', ['-C', ROOT, 'show', `${base}:${rel}`], {
      encoding: 'utf8', maxBuffer: 1 << 28,
    })
  } catch {
    console.log(`  ${rel} 은 기준 커밋에 없다 (신규 파일) — 대조 생략`)
    continue
  }
  const before = load(beforeRaw)
  const after = load(readFileSync(join(ROOT, rel), 'utf8'))

  for (const id of before.keys())
    if (!after.has(id)) errors.push(`${rel}: 문항 ${id} 이 사라졌다`)
  for (const id of after.keys())
    if (!before.has(id)) errors.push(`${rel}: 문항 ${id} 이 새로 생겼다 (교정 라운드는 문항을 만들지 않는다)`)

  for (const [id, b] of before) {
    const a = after.get(id)
    if (!a) continue

    // 문항 수준의 비산문 필드
    for (const k of ['topic', 'difficulty', 'source']) {
      if (JSON.stringify(b[k]) !== JSON.stringify(a[k]))
        errors.push(`${id}: ${k} 이 바뀌었다 — "${b[k]}" → "${a[k]}"`)
    }
    if (JSON.stringify(b.tags) !== JSON.stringify(a.tags))
      errors.push(`${id}: tags 가 바뀌었다 — ${JSON.stringify(b.tags)} → ${JSON.stringify(a.tags)}`)

    // 문항 수준에 새 키가 생기거나 없어지는 것도 표현 교정의 범위가 아니다
    const bk = Object.keys(b).sort().join(',')
    const ak = Object.keys(a).sort().join(',')
    if (bk !== ak) errors.push(`${id}: 키 구성이 바뀌었다 — [${bk}] → [${ak}]`)

    if (b.question !== a.question) changed.push({ id, field: 'question', b: b.question, a: a.question })
    if (b.explanation !== a.explanation)
      changed.push({ id, field: 'explanation', b: b.explanation, a: a.explanation })

    if (b.options.length !== a.options.length) {
      errors.push(`${id}: 보기 개수가 ${b.options.length} → ${a.options.length} 로 바뀌었다`)
      continue
    }
    for (let i = 0; i < b.options.length; i++) {
      const bo = b.options[i]
      const ao = a.options[i]
      // 정답 위치는 이 게이트의 핵심이다. correct 는 정답에만 있고 오답에는 키 자체가 없다.
      if (Boolean(bo.correct) !== Boolean(ao.correct))
        errors.push(`${id} 보기 ${i}: 정답 여부가 바뀌었다 (${!!bo.correct} → ${!!ao.correct})`)
      if ((bo.distractorType || null) !== (ao.distractorType || null))
        errors.push(`${id} 보기 ${i}: distractorType 이 "${bo.distractorType}" → "${ao.distractorType}" 로 바뀌었다`)
      const bok = Object.keys(bo).sort().join(',')
      const aok = Object.keys(ao).sort().join(',')
      if (bok !== aok) errors.push(`${id} 보기 ${i}: 키 구성이 바뀌었다 — [${bok}] → [${aok}]`)
      for (const k of Object.keys(bo)) {
        if (!PROSE.has(k)) continue
        if (bo[k] !== ao[k]) changed.push({ id, field: `options[${i}].${k}`, b: bo[k], a: ao[k] })
      }
    }
  }
}

console.log(`기준 ${base} 대조 — 텍스트가 바뀐 필드 ${changed.length}건, 구조 위반 ${errors.length}건`)

if (SHOW) {
  console.log(`\n바뀐 필드 ${Math.min(SHOW, changed.length)}건:`)
  for (const c of changed.slice(0, SHOW))
    console.log(`  ${c.id} / ${c.field}\n    before: ${c.b}\n    after:  ${c.a}`)
}

if (errors.length) {
  console.log('\n구조 위반 — 표현 교정 라운드가 표현 밖을 건드렸다:')
  for (const e of errors) console.log(`  ${e}`)
  console.log('\n실패. 이 항목들은 사람이 의도를 확인한 뒤에만 바뀔 수 있다.')
  process.exit(1)
}
console.log('\n구조는 그대로다. 남은 검수 대상은 위 필드들의 의미뿐이다.')
