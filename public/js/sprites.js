// 픽셀 스프라이트 정의 + 렌더러
// 캐릭터를 문자 도트맵으로 정의한다. 각 문자는 팔레트의 색을 가리킨다.
// 렌더러는 행 길이가 달라도 자동으로 최대 폭에 맞춰 그리므로 도트 개수 실수에 안전하다.

const PALETTE = {
  '.': null,          // 투명
  o: '#2f5d3a',       // 진한 초록 외곽선
  g: '#8ad48f',       // 몸통 초록
  G: '#5fb56a',       // 몸통 그림자
  l: '#b7f0a0',       // 새싹 잎
  w: '#ffffff',       // 눈 흰자
  k: '#33413a',       // 눈동자
  p: '#f4a6b0',       // 볼 홍조
  m: '#c9607a',       // 입
  // 책벌레(companion)
  y: '#ffd76b',       // 노랑 몸통
  Y: '#e6b73f',       // 노랑 그림자
  r: '#8a5a1a',       // 더듬이/외곽
};

// ── 늘벗이(마스코트) ─────────────────────────────────────────
// 머리 위 새싹 + 둥근 초록 몸 + 큰 눈 + 볼 홍조 + 작은 입 + 두 발
const NB_BODY = [
  '.......ll.......',
  '......llll......',
  '.....ll..ll.....',
  '.......oo.......',
  '.....oooooo.....',
  '...ooggggggoo...',
  '..oggggggggggo..',
  '..oggwwggwwggo..',
  '..ogwkwggwkwgo..',
  '..oggwwggwwggo..',
  '..opgggggggpo...',
  '..oggggmmggggo..',
  '...oggggggggo...',
  '....oGggggGo....',
  '.....oooooo.....',
];
const FEET_A = '....oo....oo....'; // 서 있는 발
const FEET_B = '...oo......oo...'; // 걷는 발(벌림)
const FEET_C = '.....oo..oo.....'; // 걷는 발(모음)

// 눈 감은(깜빡) 버전 — 8행 눈을 한 줄 선으로
const NB_BLINK = NB_BODY.map((row, i) => {
  if (i === 7) return '..ogg--gg--ggo..'.replace(/-/g, 'k');
  if (i === 8) return '..oggggggggggo..';
  if (i === 9) return '..oggggggggggo..';
  return row;
});

function withFeet(body, feet) {
  return [...body, feet];
}

const MASCOT = {
  w: 16, h: 16,
  anims: {
    idle: [withFeet(NB_BODY, FEET_A), withFeet(NB_BODY, FEET_A)],
    blink: [withFeet(NB_BLINK, FEET_A)],
    walk: [withFeet(NB_BODY, FEET_B), withFeet(NB_BODY, FEET_C)],
    happy: [withFeet(NB_BODY, FEET_B)],
  },
};

// ── 책벌레(companion) ────────────────────────────────────────
const BW_BODY = [
  '..r....r..',
  '..o....o..',
  '..oooooo..',
  '.oyyyyyyo.',
  'oywkwwkwyo',
  'oyyyyyyyyo',
  '.oYyyyyYo.',
  '..o.oo.o..',
];
const BW_BODY2 = [
  '..r....r..',
  '...o..o...',
  '..oooooo..',
  '.oyyyyyyo.',
  'oywkwwkwyo',
  'oyyyyyyyyo',
  '.oYyyyyYo.',
  '..oo..oo..',
];
const COMPANION = {
  w: 10, h: 8,
  anims: { idle: [BW_BODY, BW_BODY2], walk: [BW_BODY, BW_BODY2], happy: [BW_BODY2] },
};

// ── 팀 역할별 색상 ────────────────────────────────────────────
// 몸통 'g'(밝은색)·'G'(그림자)를 역할 색으로 바꿔 4명을 구분한다.
// 새싹(l)은 초록 그대로 유지(브랜드).
const ROLES = {
  lead:   { name: '팀장',   emoji: '👑', light: '#ffd76b', dark: '#e0b23f', tag: '#c98a1a' },
  plan:   { name: '기획',   emoji: '📋', light: '#8fb8ff', dark: '#5f8fe0', tag: '#3a6bd0' },
  design: { name: '디자인', emoji: '🎨', light: '#f4a6d0', dark: '#d97ab0', tag: '#c05a95' },
  work:   { name: '실무',   emoji: '🔧', light: '#ffb066', dark: '#e0863f', tag: '#c9661a' },
};
function roleOverride(role) {
  const r = ROLES[role];
  return r ? { g: r.light, G: r.dark } : null;
}

// ── 렌더러 ───────────────────────────────────────────────────
// frame: 문자열 배열. scale: 확대 배율. flip: 좌우반전. override: {문자:색} 색상 교체.
function drawSprite(ctx, frame, x, y, scale, flip, override) {
  const w = Math.max(...frame.map((r) => r.length));
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  if (flip) {
    ctx.translate(x + w * scale, y);
    ctx.scale(-1, 1);
  } else {
    ctx.translate(x, y);
  }
  for (let row = 0; row < frame.length; row++) {
    const line = frame[row];
    for (let col = 0; col < line.length; col++) {
      const ch = line[col];
      const c = (override && override[ch]) || PALETTE[ch];
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(col * scale, row * scale, scale, scale);
    }
  }
  ctx.restore();
}

window.Sprites = { PALETTE, MASCOT, COMPANION, ROLES, roleOverride, drawSprite };
