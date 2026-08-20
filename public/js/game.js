// 게임 루프 v4 — 탑다운(림월드풍) 콜로니
// 위에서 내려다보는 시점: 잔디 위 사무실, 위에서 본 가구, 위에서 본 늘벗이들.
// 4인이 욕구(체력·재미)에 따라 스스로 활동(업무/커피/독서/화분/휴식/수다). 업무 시엔 회의모드.

(function () {
  const DES_W = 480, DES_H = 270;
  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d');
  const R = Sprites.ROLES;

  let view = { scale: 1, ox: 0, oy: 0 };
  let meeting = false, speaker = null;

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight, dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
    const s = Math.min(canvas.width / DES_W, canvas.height / DES_H);
    view.scale = s; view.ox = (canvas.width - DES_W * s) / 2; view.oy = (canvas.height - DES_H * s) / 2;
  }
  window.addEventListener('resize', resize);

  // 건물 영역(사무실 내부)
  const B = { x0: 44, y0: 42, x1: 436, y1: 246 };
  const DOOR = { x0: 224, x1: 256 }; // 아래쪽 벽 문

  // 스테이션(위에서 본 위치 = 캐릭터가 서는 곳)
  const DESK = { lead: { x: 95, y: 94 }, plan: { x: 165, y: 94 }, design: { x: 315, y: 94 }, work: { x: 385, y: 94 } };
  const AMEN = { coffee: { x: 402, y: 210 }, shelf: { x: 80, y: 150 }, sofa: { x: 150, y: 208 }, plant: { x: 408, y: 98 } };
  const FORM = { lead: { x: 240, y: 122 }, plan: { x: 200, y: 152 }, design: { x: 280, y: 152 }, work: { x: 240, y: 180 } };

  const ACTS = {
    work:   { label: '업무 중',   emo: '💻', energy: -1.4, fun: -1.0, dur: [7, 13] },
    coffee: { label: '커피 한 잔', emo: '☕', energy: +5,   fun: +6,   dur: [3, 5] },
    read:   { label: '책 읽는 중', emo: '📖', energy: +1,   fun: +7,   dur: [4, 7] },
    water:  { label: '화분에 물',  emo: '🌱', energy: 0,    fun: +6,   dur: [3, 5] },
    rest:   { label: '휴식',       emo: '😴', energy: +9,   fun: +2,   dur: [5, 9] },
    chat:   { label: '수다 중',    emo: '💬', energy: -0.3, fun: +8,   dur: [4, 7] },
  };

  class Being {
    constructor(role) {
      this.role = role; this.s = role === 'lead' ? 1.18 : 1;
      this.speed = 22 + Math.random() * 6;
      this.x = DESK[role].x; this.y = DESK[role].y;
      this.fx = 0; this.fy = 1; // 바라보는 방향(탑다운)
      this.step = Math.random() * 6; // 걸음 흔들림 위상
      this.moving = false;
      this.bubble = null; this.bubbleT = 0; this.pop = 0;
      this.pinned = false;
      this.energy = 55 + Math.random() * 35; this.fun = 55 + Math.random() * 35;
      this.act = null; this.emote = null; this.emoteT = 0; this.label = '';
      this.tx = this.x; this.ty = this.y;
    }

    say(text, dur) { this.bubble = text; this.bubbleT = dur || Math.min(11, 3 + text.length * 0.05); this.pop = 1; }
    goTo(x, y, pin) { this.tx = x; this.ty = y; if (pin != null) this.pinned = pin; this.act = null; }

    pickActivity() {
      let type;
      if (this.energy < 24) type = 'rest';
      else if (this.fun < 26) type = choice(['coffee', 'read', 'water', 'chat']);
      else type = weighted([['work', 0.5], ['chat', 0.16], ['coffee', 0.12], ['read', 0.12], ['water', 0.1]]);
      let target;
      if (type === 'work') target = DESK[this.role];
      else if (type === 'coffee') target = AMEN.coffee;
      else if (type === 'read') target = AMEN.shelf;
      else if (type === 'water') target = AMEN.plant;
      else if (type === 'rest') target = AMEN.sofa;
      else { const o = otherNear(this); target = o ? { x: o.x + (o.x < 240 ? 14 : -14), y: o.y } : DESK[this.role]; }
      const [a, b] = ACTS[type].dur;
      this.act = { type, tx: target.x, ty: target.y, phase: 'goto', timer: a + Math.random() * (b - a) };
      this.tx = target.x; this.ty = target.y;
    }

    update(dt) {
      this.energy = clamp(this.energy - dt * 0.25, 0, 100);
      this.fun = clamp(this.fun - dt * 0.2, 0, 100);
      if (!this.pinned) {
        if (!this.act) this.pickActivity();
        if (this.act.phase === 'goto') {
          if (this.moveToward(this.act.tx, this.act.ty, dt)) { this.act.phase = 'do'; if (this.act.type === 'chat') { const o = otherNear(this, 40); if (o) o.flashEmote('💬'); } }
        } else {
          const A = ACTS[this.act.type];
          this.energy = clamp(this.energy + A.energy * dt, 0, 100); this.fun = clamp(this.fun + A.fun * dt, 0, 100);
          this.label = A.label; this.setEmote(A.emo, 0.6);
          this.act.timer -= dt; if (this.act.timer <= 0) { this.label = ''; this.act = null; }
        }
      } else { this.moveToward(this.tx, this.ty, dt); }

      if (this.moving) this.step += dt * 10;
      if (this.pop > 0) this.pop = Math.max(0, this.pop - dt * 2.5);
      if (this.bubbleT > 0) { this.bubbleT -= dt; if (this.bubbleT <= 0) this.bubble = null; }
      if (this.emoteT > 0) { this.emoteT -= dt; if (this.emoteT <= 0) this.emote = null; }
      if (!meeting && !this.emote && Math.random() < 0.004) {
        if (this.energy < 24) this.flashEmote('😪'); else if (this.fun < 26) this.flashEmote('😐'); else this.flashEmote(choice(['😊', '🎵', '✨']));
      }
    }
    moveToward(tx, ty, dt) {
      const dx = tx - this.x, dy = ty - this.y, d = Math.hypot(dx, dy);
      if (d < 1.2) { this.moving = false; return true; }
      const v = this.speed * dt; this.x += (dx / d) * Math.min(v, d); this.y += (dy / d) * Math.min(v, d);
      this.fx = dx / d; this.fy = dy / d; this.moving = true; return false;
    }
    setEmote(e, t) { this.emote = e; this.emoteT = Math.max(this.emoteT, t); }
    flashEmote(e) { this.emote = e; this.emoteT = 2; }

    // 위에서 본 늘벗이 (몸통 타원 + 머리 + 새싹 + 방향)
    draw() {
      const s = this.s, x = this.x, y = this.y;
      const bobY = this.moving ? Math.abs(Math.sin(this.step)) * 1.2 : 0;
      // 그림자
      ctx.fillStyle = 'rgba(0,0,0,0.20)'; ellipse(x, y + 5 * s, 7.5 * s, 3.2 * s); ctx.fill();
      // 발언자 강조 링
      if (speaker === this.role) { ctx.save(); ctx.strokeStyle = R[this.role].tag; ctx.globalAlpha = 0.55 + Math.sin(performance.now() / 200) * 0.25; ctx.lineWidth = 1.6; ellipse(x, y + 4 * s, 9 * s, 4 * s); ctx.stroke(); ctx.restore(); }
      const cy = y - bobY;
      // 몸통(어깨) — 역할색
      ctx.fillStyle = R[this.role].dark; ellipse(x, cy + 1 * s, 6.6 * s, 5.4 * s); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1; ctx.stroke();
      // 머리(방향으로 살짝 이동)
      const hx = x + this.fx * 1.6 * s, hy = cy - 5.4 * s + this.fy * 1.2 * s;
      // 새싹(머리 위)
      ctx.strokeStyle = '#3f7d3a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(hx, hy - 3.4 * s); ctx.lineTo(hx, hy - 6 * s); ctx.stroke();
      ctx.fillStyle = '#8fd694'; ellipse(hx - 1.6 * s, hy - 5.4 * s, 1.8 * s, 1.2 * s); ctx.fill(); ellipse(hx + 1.6 * s, hy - 5.4 * s, 1.8 * s, 1.2 * s); ctx.fill();
      // 머리 원
      ctx.fillStyle = R[this.role].light; ellipse(hx, hy, 4.7 * s, 4.4 * s); ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.stroke();
      // 얼굴(정면/아래 볼 때만 눈)
      if (this.fy > 0.15) {
        ctx.fillStyle = '#33413a';
        ellipse(hx - 1.8 * s, hy + 0.6 * s, 0.9 * s, 1.1 * s); ctx.fill();
        ellipse(hx + 1.8 * s, hy + 0.6 * s, 0.9 * s, 1.1 * s); ctx.fill();
        ctx.fillStyle = 'rgba(244,166,176,0.7)'; ellipse(hx - 2.6 * s, hy + 2 * s, 1.1 * s, 0.7 * s); ctx.fill(); ellipse(hx + 2.6 * s, hy + 2 * s, 1.1 * s, 0.7 * s); ctx.fill();
      }
      // 이모지 + 이름표 + 말풍선
      const topY = hy - 7 * s;
      if (this.emote && !this.bubble) this.drawEmote(x, topY);
      this.drawTag(x, y + 8 * s, !meeting && this.label ? this.label : null);
      if (this.bubble) this.drawBubble(x, topY - (this.emote ? 12 : 0));
    }
    drawEmote(cx, topY) {
      ctx.save(); ctx.font = '10px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,0.92)'; roundRect(cx - 8, topY - 8, 16, 15, 5); ctx.fill();
      ctx.fillText(this.emote, cx, topY - 0.5); ctx.restore();
    }
    drawTag(cx, ty, sub) {
      const r = R[this.role], label = `${r.emoji}${r.name}`;
      ctx.save(); ctx.font = '7px "Galmuri11", monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      const tw = ctx.measureText(label).width + 6, bx = cx - tw / 2;
      ctx.fillStyle = r.tag; roundRect(bx, ty, tw, 10, 3); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(label, bx + 3, ty + 1.5);
      if (sub) { const sw = ctx.measureText(sub).width + 6; ctx.fillStyle = 'rgba(0,0,0,0.5)'; roundRect(cx - sw / 2, ty + 11, sw, 9, 3); ctx.fill(); ctx.fillStyle = '#eafff0'; ctx.fillText(sub, cx - sw / 2 + 3, ty + 12.5); }
      ctx.restore();
    }
    drawBubble(cx, topY) {
      ctx.save(); ctx.font = '9px "Galmuri11", monospace'; ctx.textAlign = 'left';
      const maxW = 168, rawLines = this.bubble.split('\n'), lines = [];
      for (const raw of rawLines) { const words = raw.split(/(\s+)/); let cur = ''; for (const wtok of words) { const test = cur + wtok; if (ctx.measureText(test).width > maxW && cur) { lines.push(cur.trimEnd()); cur = wtok.trimStart(); } else cur = test; } lines.push(cur.trim()); }
      const shown = lines.slice(0, 6); if (lines.length > 6) shown[5] = shown[5].slice(0, 22) + '…';
      const lh = 12, padX = 7, padY = 6;
      const bw = Math.min(maxW + padX * 2, Math.max(...shown.map((l) => ctx.measureText(l).width)) + padX * 2), bh = shown.length * lh + padY * 2 - 2;
      let bx = cx - bw / 2, by = topY - bh - 6; bx = Math.max(4, Math.min(DES_W - bw - 4, bx)); by = Math.max(4, by);
      roundRect(bx, by, bw, bh, 5); ctx.fillStyle = 'rgba(255,255,255,0.97)'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = R[this.role].tag; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - 4, by + bh); ctx.lineTo(cx + 4, by + bh); ctx.lineTo(cx, by + bh + 6); ctx.closePath(); ctx.fillStyle = 'rgba(255,255,255,0.97)'; ctx.fill(); ctx.strokeStyle = R[this.role].tag; ctx.stroke();
      ctx.fillStyle = '#243b2b'; ctx.textBaseline = 'top'; shown.forEach((l, i) => ctx.fillText(l, bx + padX, by + padY - 1 + i * lh));
      ctx.restore();
    }
  }

  // ── 유틸 ────────────────────────────────────────────────
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function choice(a) { return a[Math.floor(Math.random() * a.length)]; }
  function weighted(pairs) { let t = pairs.reduce((s, p) => s + p[1], 0), r = Math.random() * t; for (const [k, w] of pairs) { if ((r -= w) <= 0) return k; } return pairs[0][0]; }
  function otherNear(self, maxD) { let best = null, bd = maxD || 9999; for (const b of beings) { if (b === self) continue; const d = Math.hypot(b.x - self.x, b.y - self.y); if (d < bd) { bd = d; best = b; } } return best; }
  function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function ellipse(x, y, rx, ry) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); }
  function rect(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }

  // 잔디 장식(고정 패턴)
  const GRASS = []; for (let i = 0; i < 140; i++) GRASS.push({ x: (i * 97 + 13) % DES_W, y: (i * 53 + 29) % DES_H, t: i % 3 });
  const TREES = [{ x: 20, y: 26 }, { x: 462, y: 250 }, { x: 24, y: 250 }, { x: 460, y: 24 }, { x: 240, y: 262 }];

  // ── 탑다운 월드 ─────────────────────────────────────────
  function drawWorld() {
    // 잔디
    rect(0, 0, DES_W, DES_H, '#7cae5b');
    for (const g of GRASS) { ctx.fillStyle = ['#6fa050', '#87b968', '#6aa04e'][g.t]; if (g.x < B.x0 - 6 || g.x > B.x1 + 6 || g.y < B.y0 - 6 || g.y > B.y1 + 6) ctx.fillRect(g.x, g.y, 2, 2); }
    // 나무(위에서 본)
    for (const tr of TREES) { ctx.fillStyle = 'rgba(0,0,0,0.15)'; ellipse(tr.x + 2, tr.y + 3, 12, 10); ctx.fill(); ctx.fillStyle = '#4c8a3f'; ellipse(tr.x, tr.y, 12, 11); ctx.fill(); ctx.fillStyle = '#5ba04c'; ellipse(tr.x - 3, tr.y - 3, 7, 6); ctx.fill(); }

    // 건물 바닥(마루)
    rect(B.x0, B.y0, B.x1 - B.x0, B.y1 - B.y0, '#e3c99e');
    ctx.strokeStyle = 'rgba(150,110,70,0.18)'; ctx.lineWidth = 1;
    for (let x = B.x0 + 22; x < B.x1; x += 22) { ctx.beginPath(); ctx.moveTo(x, B.y0); ctx.lineTo(x, B.y1); ctx.stroke(); }
    // 러그(회의 구역)
    ctx.fillStyle = meeting ? '#cdb488' : '#bcd9c0'; ellipse(240, 150, 62, 40); ctx.fill(); ctx.strokeStyle = meeting ? '#a9905f' : '#93c199'; ctx.stroke();

    // 벽(두껍게, 위에서 본) — 문 구멍 남김
    const wc = '#6f5c44', wt = '#8a7458', T = 5;
    ctx.fillStyle = wc;
    ctx.fillRect(B.x0 - T, B.y0 - T, (B.x1 - B.x0) + 2 * T, T); // 위
    ctx.fillRect(B.x0 - T, B.y0 - T, T, (B.y1 - B.y0) + 2 * T); // 좌
    ctx.fillRect(B.x1, B.y0 - T, T, (B.y1 - B.y0) + 2 * T);     // 우
    ctx.fillRect(B.x0 - T, B.y1, DOOR.x0 - (B.x0 - T), T);      // 아래(문 왼쪽)
    ctx.fillRect(DOOR.x1, B.y1, (B.x1 + T) - DOOR.x1, T);       // 아래(문 오른쪽)
    ctx.fillStyle = wt; ctx.fillRect(B.x0 - T, B.y0 - T, (B.x1 - B.x0) + 2 * T, 2); // 벽 하이라이트
    // 문 앞 매트
    ctx.fillStyle = '#b98e5e'; ctx.fillRect(DOOR.x0, B.y1 - 1, DOOR.x1 - DOOR.x0, 6);

    // 가구(위에서 본)
    drawDesk(DESK.lead, R.lead.light); drawDesk(DESK.plan, R.plan.light); drawDesk(DESK.design, R.design.light); drawDesk(DESK.work, R.work.light);
    // 회의 탁자
    ctx.fillStyle = '#b98a5a'; roundRect(212, 134, 56, 32, 6); ctx.fill(); ctx.strokeStyle = '#8a5f34'; ctx.lineWidth = 1.5; ctx.stroke();
    // 소파(위에서)
    ctx.fillStyle = '#6f8f9e'; roundRect(126, 196, 48, 22, 5); ctx.fill(); ctx.fillStyle = '#5c7a88'; ctx.fillRect(126, 196, 48, 5); ctx.fillStyle = '#84a6b4'; ctx.fillRect(130, 203, 18, 12); ctx.fillRect(152, 203, 18, 12);
    // 책장(좌벽)
    ctx.fillStyle = '#8a5a2a'; ctx.fillRect(56, 128, 16, 44); for (let i = 0; i < 8; i++) { ctx.fillStyle = ['#c0533f', '#3f7ac0', '#3fae6a', '#e0b23f'][i % 4]; ctx.fillRect(58 + (i % 4) * 3.5, 130 + Math.floor(i / 4) * 20, 3, 18); }
    // 커피머신(우하)
    ctx.fillStyle = '#4a4a52'; roundRect(392, 196, 20, 16, 3); ctx.fill(); ctx.fillStyle = '#2b2b30'; ctx.fillRect(396, 205, 12, 5); ctx.fillStyle = '#8ad48f'; ctx.fillRect(408, 199, 2, 2);
    // 화분(위에서)
    ctx.fillStyle = '#c98a5a'; roundRect(400, 84, 18, 14, 3); ctx.fill(); ctx.fillStyle = '#4c8a3f'; ellipse(409, 88, 11, 9); ctx.fill(); ctx.fillStyle = '#6aa851'; ellipse(406, 85, 5, 4); ctx.fill();

    // 화이트보드(위벽 안쪽)
    ctx.fillStyle = '#2f3d36'; ctx.fillRect(196, B.y0 + 2, 92, 4); // 벽걸이 티
    ctx.fillStyle = '#33413a'; roundRect(196, B.y0 + 4, 92, 3, 1); ctx.fill();

    // 상단 정보 오버레이(월드 밖 느낌으로 좌상단)
    ctx.fillStyle = 'rgba(20,40,28,0.72)'; roundRect(6, 6, 150, 46, 6); ctx.fill();
    ctx.fillStyle = '#eafff0'; ctx.font = 'bold 9px "Galmuri11", monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(meeting ? '📋 회의 중' : '🌱 늘벗 사무실', 12, 11);
    ctx.font = '8px "Galmuri11", monospace'; ctx.fillStyle = '#cfeecf';
    (window.__boardLines || ['일정 불러오는 중...']).slice(0, 3).forEach((l, i) => ctx.fillText(l.slice(0, 22), 12, 24 + i * 9));
  }
  function drawDesk(p, color) {
    ctx.fillStyle = '#a9743f'; roundRect(p.x - 15, p.y - 20, 30, 15, 3); ctx.fill(); // 책상 상판(위에서)
    ctx.strokeStyle = '#7a4f28'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#2b2b30'; ctx.fillRect(p.x - 9, p.y - 18, 18, 5); ctx.fillStyle = color; ctx.fillRect(p.x - 8, p.y - 17, 16, 3); // 모니터(위에서 본 얇은 바)
    ctx.fillStyle = '#5c4326'; ellipse(p.x, p.y + 1, 5, 4); ctx.fill(); // 의자
  }

  // ── 구성 ────────────────────────────────────────────────
  const order = ['lead', 'plan', 'design', 'work'];
  const team = {}; const beings = order.map((role) => (team[role] = new Being(role)));

  canvas.addEventListener('click', (e) => {
    const rect2 = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect2.left) * (canvas.width / rect2.width), my = (e.clientY - rect2.top) * (canvas.height / rect2.height);
    const dx = (mx - view.ox) / view.scale, dy = (my - view.oy) / view.scale;
    for (const b of beings) if (Math.hypot(dx - b.x, dy - b.y) < 10 * b.s) b.say(`${b.label || '쉬는 중'} (체력 ${Math.round(b.energy)}·재미 ${Math.round(b.fun)})`, 2.4);
  });

  let last = performance.now();
  function loop(t) {
    const dt = Math.min(0.05, (t - last) / 1000); last = t;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#20301f'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(view.scale, 0, 0, view.scale, view.ox, view.oy); ctx.imageSmoothingEnabled = false;
    drawWorld();
    beings.sort((a, b) => a.y - b.y);
    for (const b of beings) b.update(dt);
    for (const b of beings) b.draw();
    requestAnimationFrame(loop);
  }

  window.Game = {
    setBoard(lines) { window.__boardLines = lines; },
    sayMascot(text) { team.lead.goTo(240, 128, true); team.lead.say(text); clearTimeout(team.lead._unpin); team.lead._unpin = setTimeout(() => { if (!meeting) team.lead.pinned = false; }, (team.lead.bubbleT + 1) * 1000); },
    mascotThinking() { if (meeting) return; team.lead.goTo(240, 128, true); team.lead.say('음... 볼게요! 🤔', 6); },
    startMeeting() { meeting = true; speaker = null; for (const role of order) team[role].goTo(FORM[role].x, FORM[role].y, true); },
    teamTurn(role, text) { const b = team[role]; if (!b) return; speaker = role; b.goTo(FORM[role].x, FORM[role].y, true); b.say(text); },
    endMeeting() { speaker = null; setTimeout(() => { meeting = false; for (const role of order) { team[role].pinned = false; team[role].act = null; } }, 2500); },
  };

  resize(); requestAnimationFrame(loop);
})();
