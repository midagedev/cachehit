// source 텍스트 → 원문 링크. build.mjs 와 check-links.mjs 가 함께 쓴다.
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

export const REGISTRY = JSON.parse(
  readFileSync(join(ROOT, 'data', 'sources.json'), 'utf8')).entries

// RFC 는 레지스트리에 적지 않는다. 'RFC 9111 §5.2.2' 표기에서 번호와 절을 직접 읽어
// rfc-editor 앵커를 만들면, 새 RFC 를 인용해도 레지스트리를 고칠 일이 없다.
const RFC_RE = /RFC\s*(\d{3,5})(?:\s*§\s*([\d.]+))?/g

export function linksFor(source) {
  if (!source) return []
  const out = []
  const seen = new Set()
  const push = (label, url) => {
    if (seen.has(url)) return
    seen.add(url)
    out.push({ label, url })
  }

  for (const m of source.matchAll(RFC_RE)) {
    const [, num, sec] = m
    const anchor = sec ? `#section-${sec.replace(/\.$/, '')}` : ''
    push(sec ? `RFC ${num} §${sec}` : `RFC ${num}`,
      `https://www.rfc-editor.org/rfc/rfc${num}.html${anchor}`)
  }

  const hay = source.toLowerCase()
  for (const e of REGISTRY) {
    if (hay.includes(e.match.toLowerCase())) push(e.label, e.url)
  }
  return out
}
