#!/usr/bin/env node
// Cloudflare Pages 배포물(dist/)을 조립한다. 레포 루트에는 저작 도구·문항 소스·규약이
// 함께 있으므로 루트를 그대로 배포하면 안 된다 — 사이트가 실제로 서빙하는 파일만 담는다.
//
// 사용: node tools/pack.mjs   →   wrangler pages deploy
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist')

rmSync(DIST, { recursive: true, force: true })
mkdirSync(DIST, { recursive: true })

// 사이트가 요청하는 경로 전부. 여기 없는 파일을 index.html 이나 app.js 가 참조하기
// 시작하면 배포에서만 404 가 난다 — e2e 는 레포 루트를 서빙하므로 잡지 못한다.
const FILES = ['index.html', 'assets/app.js', 'assets/style.css', 'assets/og.png', 'data/questions.json']
for (const f of FILES) {
  const src = join(ROOT, f)
  if (!existsSync(src)) {
    console.error(`없는 파일: ${f} — 배포물이 불완전하다`)
    process.exit(1)
  }
  mkdirSync(dirname(join(DIST, f)), { recursive: true })
  cpSync(src, join(DIST, f))
}
console.log(`dist/ 조립 완료 (${FILES.length}개 파일)`)
