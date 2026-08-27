// 집계 공개 읽기. 개인 정보가 없으므로 전체를 그대로 준다(무엇을 세는지의 증명이기도 하다).
// 5분 캐시: 이 응답 자체가 이 퀴즈가 다루는 Cache-Control 의 실전 예다.
export async function onRequestGet({ env }) {
  const [answers, counters] = await Promise.all([
    env.DB.prepare('SELECT qid, opt, confidence, correct, n FROM answers ORDER BY qid, opt').all(),
    env.DB.prepare('SELECT k, n FROM counters ORDER BY k').all(),
  ])
  return new Response(JSON.stringify({ answers: answers.results, counters: counters.results }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=300',
    },
  })
}
