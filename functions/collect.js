// 익명 집계 수집. 사이트와 같은 오리진(Pages Functions)이라 CORS 가 없다.
//
// 설계 원칙: 저장하는 것은 카운터 증가뿐이다. IP·User-Agent·쿠키·식별자는 읽지도
// 저장하지도 않는다. 무엇을 세는지는 tools/analytics-schema.sql 이 전부이고,
// 읽기는 GET /stats 로 누구에게나 공개된다. 개인 정보가 없으니 숨길 이유가 없고,
// AUTHORING §7(데이터로 오답을 교체한다)의 근거를 누구나 검증할 수 있다.
//
// 받는 이벤트 (POST /collect, JSON):
//   {"t":"pageview"}                                    하루 한 번 (클라이언트가 제한)
//   {"t":"answer","qid":"...","opt":0,"confidence":"sure","correct":true}
//   {"t":"finish","len":10}
//   {"t":"copy"} {"t":"share"} {"t":"retry"}

const EVENTS = new Set(['pageview', 'finish', 'copy', 'share', 'retry'])
const CONFIDENCES = new Set(['sure', 'unsure', 'guess'])
// 문항 id 형식만 통과시킨다. 자유 문자열을 키로 받으면 카운터 테이블이 스팸의 표면이 된다.
const QID = /^[a-z]+-[a-z0-9-]{1,60}-\d{3}$/

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })

export async function onRequestPost({ request, env }) {
  // 브라우저가 크로스 사이트에서 보낸 요청은 버린다. 헤더가 없는 요청(curl 등)은
  // 막을 수 없고 막지 않는다 — 이 데이터는 공개 집계라 위조의 이득 자체가 없고,
  // 방어는 값 검증과 카운터-만-증가 구조로 한다.
  const site = request.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin') return json({ ok: false }, 403)

  let body
  try {
    body = await request.json()
  } catch {
    return json({ ok: false }, 400)
  }

  const day = new Date().toISOString().slice(0, 10)

  if (body.t === 'answer') {
    const { qid, opt, confidence, correct } = body
    if (!QID.test(String(qid))) return json({ ok: false }, 400)
    if (!Number.isInteger(opt) || opt < 0 || opt > 3) return json({ ok: false }, 400)
    if (!CONFIDENCES.has(confidence)) return json({ ok: false }, 400)
    await env.DB.prepare(
      `INSERT INTO answers (qid, opt, confidence, correct, n) VALUES (?, ?, ?, ?, 1)
       ON CONFLICT(qid, opt, confidence) DO UPDATE SET n = n + 1`
    ).bind(qid, opt, confidence, correct ? 1 : 0).run()
    return json({ ok: true })
  }

  if (EVENTS.has(body.t)) {
    // finish 는 라운드 길이별로 나눠 센다. 10/20 이 아닌 길이(재도전 라운드)는 finish 로 합산.
    const key = body.t === 'finish' && (body.len === 10 || body.len === 20)
      ? `finish${body.len}:${day}`
      : `${body.t}:${day}`
    await env.DB.prepare(
      `INSERT INTO counters (k, n) VALUES (?, 1)
       ON CONFLICT(k) DO UPDATE SET n = n + 1`
    ).bind(key).run()
    return json({ ok: true })
  }

  return json({ ok: false }, 400)
}
