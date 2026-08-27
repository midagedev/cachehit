#!/usr/bin/env python3
"""OG 공유 카드(1200×630)를 생성한다 → assets/og.png

twitter:card 를 summary_large_image 로 선언했으므로 이 이미지가 없으면
트위터·슬랙에서 카드가 렌더되지 않는다. 팔레트는 assets/style.css 의 다크 토큰과 맞춘다.

사용: python3 tools/make-og.py
"""
import json
import pathlib
from PIL import Image, ImageDraw, ImageFont
from PIL.PngImagePlugin import PngInfo

ROOT = pathlib.Path(__file__).resolve().parent.parent
FONT = '/System/Library/Fonts/AppleSDGothicNeo.ttc'
W, H = 1200, 630

# style.css 다크 토큰
BG = (12, 14, 18)
BG_SOFT = (20, 23, 29)
FG = (233, 236, 241)
FG_DIM = (162, 171, 187)
FG_FAINT = (111, 119, 135)
ACCENT = (111, 155, 255)
OK = (67, 201, 127)
LINE = (36, 41, 50)


def font(size, weight='Regular'):
    idx = {'Regular': 0, 'Medium': 2, 'SemiBold': 4, 'Bold': 6, 'Light': 8}[weight]
    return ImageFont.truetype(FONT, size, index=idx)


def question_count():
    try:
        qs = json.loads((ROOT / 'data' / 'questions.json').read_text(encoding='utf-8'))
        return len(qs)
    except Exception:
        return 0


img = Image.new('RGB', (W, H), BG)
d = ImageDraw.Draw(img)

# 상단 액센트 라인
d.rectangle([0, 0, W, 6], fill=ACCENT)

PAD = 76
y = 92

# 로고 라인
d.text((PAD, y), 'cachehit', font=font(34, 'Bold'), fill=ACCENT)
lw = d.textlength('cachehit', font=font(34, 'Bold'))
d.text((PAD + lw + 18, y + 10), 'github.io', font=font(22, 'Regular'), fill=FG_FAINT)

# 제목
y += 82
d.text((PAD, y), '당신의 캐시 히트율은?', font=font(76, 'Bold'), fill=FG)

# 부제
y += 108
d.text((PAD, y), 'CDN · 캐싱 · 이미지/동영상 서빙 파이프라인 퀴즈',
       font=font(31, 'Medium'), fill=FG_DIM)

# 설계 주장 — 이 퀴즈의 차별점
y += 74
d.text((PAD, y), '모든 오답은 실제 오개념에서 가져왔습니다.',
       font=font(26, 'Regular'), fill=FG_FAINT)

# 캐시 슬롯 격자 — 히트/미스 은유 (우측). 하단 바를 침범하지 않도록 5행으로 제한한다.
CELL, GAP, COLS, ROWS = 32, 9, 10, 5
GRID_W = COLS * (CELL + GAP) - GAP
GRID_X = W - PAD - GRID_W
GRID_Y = 282
# 결정적 패턴: 히트 슬롯을 고정 규칙으로 흩뿌린다(실행마다 같은 그림이 나와야 한다)
hit_pattern = [(i * 7 + i // COLS * 3) % 10 < 6 for i in range(COLS * ROWS)]
for i, is_hit in enumerate(hit_pattern):
    cx = GRID_X + (i % COLS) * (CELL + GAP)
    cy = GRID_Y + (i // COLS) * (CELL + GAP)
    if is_hit:
        d.rounded_rectangle([cx, cy, cx + CELL, cy + CELL], radius=7, fill=ACCENT)
    else:
        d.rounded_rectangle([cx, cy, cx + CELL, cy + CELL], radius=7,
                            fill=BG_SOFT, outline=LINE, width=2)

# 격자 범례 — 이 격자가 무엇인지 한 줄로 못 박는다
legend_y = GRID_Y + ROWS * (CELL + GAP) + 14
lx = GRID_X
d.rounded_rectangle([lx, legend_y + 4, lx + 16, legend_y + 20], radius=4, fill=ACCENT)
d.text((lx + 26, legend_y), 'hit', font=font(21, 'Medium'), fill=FG_DIM)
lx += 26 + int(d.textlength('hit', font=font(21, 'Medium'))) + 26
d.rounded_rectangle([lx, legend_y + 4, lx + 16, legend_y + 20], radius=4,
                    fill=BG_SOFT, outline=LINE, width=2)
d.text((lx + 26, legend_y), 'miss', font=font(21, 'Medium'), fill=FG_FAINT)

# 하단 바
BAR_Y = H - 92
d.line([0, BAR_Y, W, BAR_Y], fill=LINE, width=2)
n = question_count()
left = f'{n}문항 · 4지선다 · 확신도 입력 · 즉시 해설' if n else '4지선다 · 확신도 입력 · 즉시 해설'
d.text((PAD, BAR_Y + 30), left, font=font(25, 'Medium'), fill=FG_DIM)
right = 'midagedev.github.io/cachehit'
rw = d.textlength(right, font=font(25, 'SemiBold'))
d.text((W - PAD - rw, BAR_Y + 30), right, font=font(25, 'SemiBold'), fill=OK)

out = ROOT / 'assets' / 'og.png'
# 문항 수를 PNG 안에 새긴다. 이 카드는 macOS 시스템 폰트에 의존해 CI 에서 재생성할 수
# 없으므로, 데이터와 어긋났는지는 재생성 대조가 아니라 이 값으로만 검출된다
# (tools/validate.mjs 가 읽어 현재 문항 수와 비교한다). 89문항 시절 카드가 149문항이
# 된 뒤에도 그대로 배포돼 있던 것이 이 스탬프를 만든 이유다.
meta = PngInfo()
meta.add_text('cachehit:questions', str(n))
img.save(out, 'PNG', optimize=True, pnginfo=meta)
print(f'{out} — {W}×{H}, {out.stat().st_size // 1024}KB, 문항 {n}건 (PNG 에 새김)')
