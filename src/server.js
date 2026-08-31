// 늘벗이 팀 — 로컬 서버
const express = require('express');
const path = require('path');
const brain = require('./brain');
const schedule = require('./schedule');
const team = require('./team');
const ai = require('./ai');
const workfiles = require('./workfiles');
const session = require('./session');
const agent = require('./agent');
const usercfg = require('./usercfg');
const confirm = require('./confirm');

const app = express();
const PORT = process.env.PORT || 4000;
// 소유자(기본 업무 폴더 주인). owner.txt(UTF-8, 앱에서 입력하는 이름과 동일).
function readOwnerFile() {
  try { return require('fs').readFileSync(path.join(__dirname, '..', 'owner.txt'), 'utf8').trim(); }
  catch { return ''; }
}
const OWNER = (process.env.OWNER || readOwnerFile() || '').trim();
// 화면 상단 이름. brand.txt(UTF-8) 있으면 그걸로(배포본="출장온 늘벗이 팀"), 없으면 기본.
function readBrandFile() { try { return require('fs').readFileSync(path.join(__dirname, '..', 'brand.txt'), 'utf8').trim(); } catch { return ''; } }
const BRAND = (process.env.BRAND || readBrandFile() || '늘벗이 팀').trim();

app.use(express.json({ limit: '30mb' })); // 파일 업로드(base64) 대비
app.use(express.static(path.join(__dirname, '..', 'public')));

function today(req) {
  const q = req.query.date || (req.body && req.body.today);
  if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) return q;
  return schedule.fmt(new Date());
}
function uidOf(req) { return req.query.uid || (req.body && req.body.uid) || ''; }
function isOwner(req) { return !OWNER || uidOf(req) === OWNER; }
// 이 요청(선생님)의 업무 폴더: 개인 설정 폴더 > (소유자면) 기본 WORK_DIR > 없음(null)
function folderFor(req) {
  const custom = usercfg.getFolder(uidOf(req));
  if (custom) return custom;
  if (isOwner(req) && workfiles.WORK_DIR) return workfiles.WORK_DIR;
  return null;
}

// 상태
app.get('/api/status', (req, res) => {
  const s = ai.status();
  const folder = folderFor(req);
  res.json({
    ...s, aiEnabled: s.claude, today: today(req),
    owner: OWNER || null, isOwner: isOwner(req), brand: BRAND,
    folder: folder || null, hasFolder: !!(folder && workfiles.exists(folder)),
    sharedRoot: usercfg.sharedRoot() || null,
    hasProfile: !!usercfg.getProfile(uidOf(req)),
  });
});

// API 키 조회 / 개인키 설정 (공유 키 → 개인 키 교체)
app.get('/api/keys', (req, res) => {
  res.json({ ok: true, ...pubKeyStatus() });
});
app.post('/api/keys', async (req, res) => {
  const { anthropic, gemini, openrouter, openrouterModel, reset, openrouterEnabled } = req.body || {};
  try {
    // OpenRouter 켜기/끄기 토글 (키는 보존)
    if (openrouterEnabled !== undefined) { ai.setOpenRouterEnabled(!!openrouterEnabled); return res.json({ ok: true, ...pubKeyStatus() }); }
    if (reset) { ai.setKeys({ anthropic: '', gemini: '', openrouter: '', openrouterModel: '' }); ai.setOpenRouterEnabled(true); return res.json({ ok: true, reset: true, ...pubKeyStatus() }); }
    // 저장 전 유효성 검사(입력된 것만)
    if (openrouter) {
      if (!openrouterModel) return res.status(400).json({ ok: false, error: 'OpenRouter 모델도 입력하세요 (예: anthropic/claude-sonnet-4.5).' });
      try { await ai.testOpenRouterKey(openrouter, openrouterModel); } catch (e) { return res.status(400).json({ ok: false, error: 'OpenRouter 키/모델 오류: ' + e.message }); }
    }
    if (anthropic) await ai.testAnthropicKey(anthropic);
    if (gemini) { try { await ai.testGeminiKey(gemini); } catch (e) { return res.status(400).json({ ok: false, error: 'Gemini 키 오류: ' + e.message }); } }
    ai.setKeys({ anthropic, gemini, openrouter, openrouterModel });
    res.json({ ok: true, ...pubKeyStatus() });
  } catch (e) {
    res.status(400).json({ ok: false, error: 'Claude 키가 유효하지 않아요: ' + e.message });
  }
});
function pubKeyStatus() { const s = ai.status(); return { claude: s.claude, gemini: s.gemini, usingPersonal: s.usingPersonal, usingPersonalGemini: s.usingPersonalGemini, usingOpenRouter: s.usingOpenRouter, openrouterModel: s.openrouterModel, sharedAvailable: s.sharedAvailable, openrouterStored: s.openrouterStored, openrouterOff: s.openrouterOff }; }

// 내 업무 폴더 조회 / 설정
app.get('/api/folder', (req, res) => {
  const folder = folderFor(req);
  res.json({ ok: true, folder: folder || '', hasFolder: !!(folder && workfiles.exists(folder)), sharedRoot: usercfg.sharedRoot() || '', isOwner: isOwner(req) });
});
app.post('/api/folder', (req, res) => {
  try {
    const out = usercfg.setFolder(uidOf(req), (req.body && req.body.folder) || '', { owner: isOwner(req) });
    storeFor(req).folderOverview = null; // 폴더 바뀌면 개요 초기화(다시 분석 유도)
    res.json(out);
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// 진짜 윈도우 폴더 선택창(탐색기) 띄우기 — 서버=본인 PC(로컬 설치)일 때 절대경로를 받는다.
app.get('/api/pick-folder', (req, res) => {
  if (!isOwner(req)) return res.status(403).json({ ok: false, error: '이 기능은 본인 PC(소유자)에서만 돼요.' });
  if (process.platform !== 'win32') return res.json({ ok: false, unsupported: true, error: 'Windows에서만 폴더 선택창을 띄울 수 있어요.' });
  const ps = "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description='Neulbeot - select work folder'; $d.ShowNewFolderButton=$true; $t=New-Object System.Windows.Forms.Form; $t.TopMost=$true; $t.ShowInTaskbar=$false; $t.Opacity=0; $t.Show(); $t.Activate(); $r=$d.ShowDialog($t); $t.Dispose(); if($r -eq [System.Windows.Forms.DialogResult]::OK){[Console]::Out.Write($d.SelectedPath)}";
  execFile('powershell.exe', ['-STA', '-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps], { timeout: 180000, windowsHide: true }, (err, stdout) => {
    if (err && err.killed) return res.json({ ok: false, error: '시간이 초과됐어요(선택창을 못 찾았을 수 있어요).' });
    const p = String(stdout || '').trim();
    if (!p) return res.json({ ok: true, cancelled: true }); // 사용자가 취소
    res.json({ ok: true, path: p.replace(/\\/g, '/') });
  });
});

// 폴더 선택창 — 서버 폴더를 클릭으로 타고 들어가 고르기. dirs=하위폴더, drives=드라이브(루트).
app.get('/api/browse', (req, res) => {
  const owner = isOwner(req);
  const shared = usercfg.sharedRoot();
  let p = String(req.query.path || '').replace(/\\/g, '/');
  try {
    if (!owner) {
      if (!shared) return res.status(403).json({ ok: false, error: '폴더 선택은 관리자가 공유 폴더(shared-root.txt)를 설정해야 가능해요. 지금은 ⬆️ 파일 올리기를 쓰세요.' });
      const root = path.resolve(shared);
      if (!p) p = shared;
      const abs = path.resolve(p);
      const rel = path.relative(root, abs);
      if (rel.startsWith('..') || path.isAbsolute(rel)) { p = shared; } // 밖이면 공유 루트로
      const dirs = workfiles.listSubdirs(p);
      const atRoot = path.resolve(p).replace(/\\/g, '/') === root.replace(/\\/g, '/');
      const parent = atRoot ? null : path.dirname(path.resolve(p)).replace(/\\/g, '/');
      return res.json({ ok: true, path: p.replace(/\\/g, '/'), dirs, parent });
    }
    // 소유자: 경로 없으면 드라이브 목록, 있으면 하위 폴더
    if (!p) return res.json({ ok: true, path: '', drives: workfiles.listDrives(), dirs: [], parent: null });
    const dirs = workfiles.listSubdirs(p);
    const parent = workfiles.isDriveRoot(p) ? '' : path.dirname(path.resolve(p)).replace(/\\/g, '/');
    res.json({ ok: true, path: p.replace(/\\/g, '/'), dirs, parent });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// 업무 폴더 자동 분석 — 폴더 구조를 훑어 개요를 만들고 세션에 심는다(팀장이 폴더를 알고 시작).
// 결과는 폴더 경로별로 캐시(1회만 AI 호출). ?force=1 로 재분석.
app.post('/api/analyze-folder', async (req, res) => {
  const folder = folderFor(req);
  if (!folder) return res.status(403).json({ ok: false, error: '설정된 업무 폴더가 없어요.' });
  if (!workfiles.exists(folder)) return res.status(400).json({ ok: false, error: '폴더를 찾을 수 없어요: ' + folder });
  const S = storeFor(req);
  const force = req.query.force === '1' || (req.body && req.body.force);

  // 캐시 우선
  if (!force) {
    const cached = usercfg.getAnalysis(folder);
    if (cached) { S.folderOverview = cached.overview; return res.json({ ok: true, overview: cached.overview, cached: true }); }
  }
  try {
    const struct = workfiles.analyzeStructure(folder);
    let overview = null;
    if (ai.status().claude) {
      overview = await ai.callClaude(
        `너는 세종늘벗학교 담당자의 AI 팀장이다. 업무 폴더의 구조·문서 목록만 보고, 이 폴더가 어떤 자료들로 구성됐는지, 문서 작업 때 참고하기 좋은 자료가 무엇인지 3~5줄로 간결히 정리하라. 담당자가 자주 쓸 자료 위주로.`,
        `업무 폴더 구조:\n${struct.text}`,
        { effort: 'low', maxTokens: 450 }
      );
    }
    if (!overview) overview = `업무 폴더 개요 — 파일 ${struct.fileCount}개(참고가능 ${struct.readableCount}개). 최상위: ${struct.topDirs.join(', ') || '(없음)'}`;
    usercfg.setAnalysis(folder, overview);
    S.folderOverview = overview;
    res.json({ ok: true, overview, fileCount: struct.fileCount, readableCount: struct.readableCount });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── 온보딩: 업무 파악 → 확인 ──
// 폴더 구성 + 학사일정을 근거로 이 선생님의 '주요 업무'를 추정해 보여준다(확정 아님, 사용자 확인용).
app.post('/api/onboard/understand', async (req, res) => {
  const t = today(req);
  const name = uidOf(req) || '선생님';
  const folder = folderFor(req);
  try {
    let structText = '';
    if (folder && workfiles.exists(folder)) {
      try { structText = workfiles.analyzeStructure(folder).text; } catch {}
    }
    const upcoming = schedule.upcoming(t, 8), deadlines = schedule.deadlines(t, 6);
    const schedText = `다가오는 일정: ${upcoming.map((e) => `${e.title}(${e.date})`).join(', ') || '(없음)'}\n주요 마감: ${deadlines.map((e) => `${e.title}(${e.date})`).join(', ') || '(없음)'}`;
    let understanding = null;
    if (ai.status().claude) {
      understanding = await ai.callClaude(
        `너는 세종늘벗학교(대안교육위탁기관)의 AI 팀장 '늘벗이'다. 담당 선생님이 처음 설정하는 중이다.
아래 '업무 폴더 구성'과 '학사일정'을 근거로, 이 선생님이 맡은 주요 업무가 무엇일지 추정해 정리하라.
- 확정이 아니라 추정임을 전제로, 다정한 존댓말로.
- 첫 줄에 "제가 살펴본 선생님의 업무는 이런 것 같아요:" 같은 한 줄.
- 이어서 5~8개 항목을 '- '로 시작하는 불릿(각 한 줄). 폴더/일정에서 근거가 보이는 것 위주.
- 마지막 줄에 "먼저 이런 걸 도와드릴 수 있어요: …" 한 줄 제안.
- 학생 이름 등 개인정보는 절대 쓰지 말 것.`,
        `담당자: ${name}\n\n[업무 폴더 구성]\n${structText || '(폴더 미설정)'}\n\n[학사일정]\n${schedText}`,
        { effort: 'low', maxTokens: 700 }
      );
    }
    if (!understanding) {
      understanding = `제가 아직 업무를 자동으로 파악하려면 AI(Claude) 키가 필요해요.\n대신 아래 칸에 선생님의 주요 업무를 직접 적어주시면 그대로 기억할게요.\n(예)\n- 각종 행사 총괄\n- 학사관리·나이스 운영\n- 정보보안 및 누리집`;
    }
    res.json({ ok: true, understanding, hasFolder: !!(folder && workfiles.exists(folder)), aiUsed: !!ai.status().claude });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
// 사용자가 확인(수정)한 업무 범위를 저장 → 이후 에이전트가 이 범위를 기억.
app.post('/api/onboard/confirm', (req, res) => {
  const work = (req.body && req.body.work || '').trim();
  if (!work) return res.status(400).json({ ok: false, error: '업무 내용이 비었어요.' });
  try {
    const p = usercfg.setProfile(uidOf(req), work);
    const S = storeFor(req); S.workProfile = p.work;
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// 업무 폴더 파일 목록 (자기 폴더)
app.get('/api/files', (req, res) => {
  const folder = folderFor(req);
  if (!folder) return res.status(403).json({ ok: false, error: '설정된 업무 폴더가 없어요. (폴더 설정 또는 파일 업로드를 이용하세요)', dir: '' });
  try { res.json(workfiles.listFiles(folder)); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// 파일 미리보기(텍스트/PDF) (자기 폴더)
app.get('/api/file', async (req, res) => {
  const folder = folderFor(req);
  if (!folder) return res.status(403).json({ ok: false, error: '권한이 없어요.' });
  try {
    const out = await workfiles.readText(folder, req.query.path || '', { maxChars: 4000 });
    res.json({ ok: true, ...out });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// 참고 문서 업로드(자기 PC 파일 → 이번 대화의 참고자료로). base64/텍스트.
app.post('/api/upload-ref', async (req, res) => {
  const { name, data, encoding } = req.body || {};
  if (!name || !data) return res.status(400).json({ ok: false, error: '파일이 비어 있어요.' });
  try {
    const buf = Buffer.from(data, encoding === 'base64' ? 'base64' : 'utf8');
    if (buf.length > 20 * 1024 * 1024) throw new Error('파일이 너무 커요(20MB 이하).');
    const out = await workfiles.extractBuffer(name, buf, 6000);
    session.get(uidOf(req)).uploadedRef = { name: out.name, text: out.text };
    res.json({ ok: true, name: out.name, chars: out.text.length });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
// 업로드 참고 해제
app.post('/api/upload-ref/clear', (req, res) => { session.get(uidOf(req)).uploadedRef = null; res.json({ ok: true }); });

// 파일에서 텍스트만 추출(일정 붙여넣기용). base64/텍스트.
app.post('/api/extract-text', async (req, res) => {
  const { name, data, encoding } = req.body || {};
  if (!name || !data) return res.status(400).json({ ok: false, error: '파일이 비어 있어요.' });
  try {
    const buf = Buffer.from(data, encoding === 'base64' ? 'base64' : 'utf8');
    if (buf.length > 20 * 1024 * 1024) throw new Error('파일이 너무 커요(20MB 이하).');
    const out = await workfiles.extractBuffer(name, buf, 20000);
    res.json({ ok: true, name: out.name, text: out.text });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// 요청 → 그 선생님(uid)의 세션 저장소
function storeFor(req) { return session.get(req.query.uid || (req.body && req.body.uid)); }

// ── 자동 업데이트 (git 없이, GitHub zip 다운로드) ──
const updater = require('./updater');
const { execFile } = require('child_process');
function npmInstall() {
  return new Promise((resolve, reject) => {
    execFile(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--no-audit', '--no-fund'], { cwd: updater.ROOT, windowsHide: true, timeout: 300000 }, (err) => (err ? reject(err) : resolve('ok')));
  });
}
// 업데이트 있는지 확인
app.get('/api/update/check', async (req, res) => {
  try {
    const out = await updater.checkUpdate();
    res.json({ ok: true, ...out });
  } catch (e) { res.json({ ok: true, available: false, error: e.message }); }
});
// 업데이트 적용 (zip 다운로드·교체 + npm install → 재시작)
app.post('/api/update/apply', async (req, res) => {
  try {
    const out = await updater.applyUpdate();
    let npm = 'ok';
    try { await npmInstall(); } catch (e) { npm = '경고: ' + String(e.message).slice(0, 80); }
    res.json({ ok: true, copied: out.copied, npm });
    // start-server.bat 재시작 루프가 새 코드로 다시 띄우도록 잠시 후 종료
    setTimeout(() => process.exit(0), 900);
  } catch (e) { res.status(400).json({ ok: false, error: '업데이트 실패: ' + e.message }); }
});

// 파일 변경 승인/거부 (에이전트가 대기 중인 작업을 진행/취소)
app.post('/api/confirm', (req, res) => {
  const { id, decision } = req.body || {};
  res.json({ ok: confirm.respond(id, decision) });
});

// 세션 초기화 (새 작업 시작 — 이전 초안/대화 기억 비움)
app.post('/api/reset', (req, res) => { storeFor(req).reset(); res.json({ ok: true }); });

// 생성된 산출물 파일 다운로드(자기 PC로 받기). 자기 폴더의 늘벗이_산출물 안만 허용.
app.get('/api/download', (req, res) => {
  const rel = req.query.path || '';
  if (!/^늘벗이_산출물[\\/]/.test(rel)) return res.status(400).send('허용되지 않은 경로');
  const base = folderFor(req) || workfiles.OUTPUT_FALLBACK;
  try {
    const abs = workfiles.safeResolve(base, rel);
    res.download(abs, path.basename(abs));
  } catch (e) { res.status(404).send('파일을 찾을 수 없어요: ' + e.message); }
});

// 산출물 저장(자기 폴더 있으면 거기, 없으면 서버 임시폴더→다운로드용)
app.post('/api/save', (req, res) => {
  const { title, body, format } = req.body || {};
  if (!body) return res.status(400).json({ ok: false, error: '저장할 내용이 없어요.' });
  const base = folderFor(req) || workfiles.OUTPUT_FALLBACK;
  const toFolder = !!folderFor(req);
  try {
    const out = workfiles.saveDeliverable(base, title, body, format === 'md' ? 'md' : 'txt');
    res.json({ ok: true, ...out, toFolder });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// 산출물을 한글/워드 문서(.docx)로 저장 (한글에서 바로 열림)
app.post('/api/save-docx', (req, res) => {
  const { title, body } = req.body || {};
  if (!body) return res.status(400).json({ ok: false, error: '저장할 내용이 없어요.' });
  const base = folderFor(req) || workfiles.OUTPUT_FALLBACK;
  const toFolder = !!folderFor(req);
  try {
    const out = workfiles.saveDocx(base, title, body);
    res.json({ ok: true, ...out, toFolder });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// 손글씨/이미지 → 텍스트(OCR). 비전 모델로 옮겨 적음. 이미지 1장(base64).
app.post('/api/ocr', async (req, res) => {
  const { name, data } = req.body || {};
  if (!data) return res.status(400).json({ ok: false, error: '이미지가 비었어요.' });
  const m = String(name || '').toLowerCase().match(/\.(jpe?g|png|webp|gif)$/);
  const mt = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' }[m ? m[1] : 'jpg'] || 'image/jpeg';
  try {
    const out = await ai.transcribeImage(String(data), mt, {});
    res.json({ ok: true, text: out.text || '', model: out.model });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// 일정
app.get('/api/schedule', (req, res) => {
  const t = today(req);
  res.json({
    today: t,
    source: schedule.source(),
    total: schedule.activeEvents().length,
    onToday: schedule.eventsOn(t),
    week: schedule.thisWeek(t),
    upcoming: schedule.upcoming(t, 5),
    deadlines: schedule.deadlines(t, 4),
  });
});

// 학사일정 불러오기 — 붙여넣은 텍스트를 AI가 날짜·행사로 정리해 앱 일정으로 설정
app.post('/api/schedule/import', async (req, res) => {
  const text = (req.body && req.body.text || '').trim();
  if (text.length < 10) return res.status(400).json({ ok: false, error: '일정 내용이 너무 짧아요. 표/목록 형태로 붙여넣어 주세요.' });
  if (!ai.status().claude) return res.status(400).json({ ok: false, error: 'AI(Claude) 키가 있어야 일정을 자동 정리할 수 있어요.' });
  try {
    const events = await ai.extractSchedule(text, { year: (today(req).slice(0, 4)) });
    if (!events || !events.length) return res.status(400).json({ ok: false, error: '일정을 못 찾았어요. 날짜와 내용이 들어간 표/목록인지 확인해주세요.' });
    const count = schedule.setCustom(events);
    if (!count) return res.status(400).json({ ok: false, error: '유효한 날짜가 있는 일정을 못 찾았어요.' });
    const t = today(req);
    res.json({ ok: true, count, source: schedule.source(), upcoming: schedule.upcoming(t, 5) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
// 내장 일정으로 되돌리기
app.post('/api/schedule/reset', (req, res) => { schedule.clearCustom(); res.json({ ok: true, source: schedule.source() }); });

// 팀장(늘벗이)과의 짧은 대화
app.post('/api/chat', async (req, res) => {
  const message = (req.body && req.body.message) || '';
  if (!message.trim()) return res.status(400).json({ error: '메시지가 비어 있어요.' });
  try {
    const out = await brain.reply(message, { today: today(req), store: storeFor(req) });
    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ reply: '앗, 잠깐 문제가 생겼어요. 다시 말해줄래요?', mood: 'idle', error: e.message });
  }
});

// 에이전트 팀장 (SSE) — 연속 대화 + 자율 도구. 모든 요청의 기본 통로.
app.get('/api/agent', async (req, res) => {
  const msg = (req.query.msg || '').trim();
  if (!msg) return res.status(400).end();
  sse(res);
  let closed = false;
  req.on('close', () => { closed = true; });
  const emit = (evt) => { if (!closed) res.write(`data: ${JSON.stringify(evt)}\n\n`); };

  const t = today(req);
  const st = ai.status();
  const S = storeFor(req);
  const folder = folderFor(req);
  // 온보딩에서 확인한 업무 범위를 세션에 실어 팀장이 알고 시작
  if (!S.workProfile) { const p = usercfg.getProfile(uidOf(req)); if (p) S.workProfile = p.work; }

  // 참고 문서: 폴더 파일(?ref=경로) 또는 업로드(세션에 보관됨)
  let refOpts = {};
  if (req.query.ref && folder) {
    try { const r = await workfiles.readText(folder, req.query.ref, { maxChars: 6000 }); refOpts = { refName: r.name, refText: r.text }; }
    catch (e) { emit({ type: 'turn', role: 'lead', text: `참고 문서를 못 읽었어요(${e.message}). 그냥 진행할게요.` }); }
  } else if (S.uploadedRef) {
    refOpts = { refName: S.uploadedRef.name, refText: S.uploadedRef.text };
  }

  try {
    // 1) 즉답 가능한 일정/인사는 빠르게 (단, 대화엔 남겨 연속성 유지)
    if (!refOpts.refText && req.query.mode !== 'doc') {
      const q = brain.quickAnswer(msg, t);
      if (q) { emit({ type: 'turn', role: 'lead', text: q.reply }); S.recordExchange(msg, q.reply); emit({ type: 'done' }); return res.end(); }
    }
    // 2) Claude 있으면 에이전트 루프, 없으면 기존 팀 회의로 폴백
    if (st.claude) {
      await agent.run(msg, emit, { ...refOpts, mode: req.query.mode, store: S, folder });
    } else {
      await team.runMeeting(msg, emit, { ...refOpts, prevDraft: S.draft, onDraft: (d) => { S.setDraft(d); } });
    }
  } catch (e) {
    console.error('[agent] 오류:', e);
    emit({ type: 'turn', role: 'lead', text: '처리 중 문제가 생겼어요: ' + e.message });
  }
  emit({ type: 'done' });
  res.end();
});

function sse(res) {
  res.set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  if (res.flushHeaders) res.flushHeaders();
}

// 팀 회의 (SSE 스트리밍) — 구버전/폴백
app.get('/api/team', async (req, res) => {
  const task = (req.query.task || '').trim();
  if (!task) return res.status(400).end();

  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (res.flushHeaders) res.flushHeaders();

  let closed = false;
  req.on('close', () => { closed = true; });
  const emit = (evt) => { if (!closed) res.write(`data: ${JSON.stringify(evt)}\n\n`); };

  // 참고 문서(선택) 읽기
  const folder = folderFor(req);
  let refOpts = {};
  if (req.query.ref && folder) {
    try {
      const r = await workfiles.readText(folder, req.query.ref, { maxChars: 6000 });
      refOpts = { refName: r.name, refText: r.text };
    } catch (e) {
      emit({ type: 'turn', role: 'lead', text: `참고 문서를 못 읽었어요(${e.message}). 그냥 진행할게요.` });
    }
  }

  const S = storeFor(req);
  try {
    await team.runMeeting(task, emit, {
      ...refOpts,
      prevDraft: S.draft,
      onDraft: (d) => { S.setDraft(d); },
    });
  } catch (e) {
    console.error('[team] 회의 오류:', e);
    emit({ type: 'turn', role: 'lead', text: '회의 중 문제가 생겼어요: ' + e.message });
  }
  emit({ type: 'done' });
  res.end();
});

// 이 PC의 LAN IPv4 주소들 (다른 선생님이 접속할 주소)
function lanIPs() {
  const os = require('os'), out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
  }
  return out;
}

app.listen(PORT, '0.0.0.0', () => {
  const s = ai.status();
  console.log(`\n🌱 ${BRAND} 서버 실행 중`);
  console.log(`   내 PC:      http://localhost:${PORT}`);
  lanIPs().forEach((ip) => console.log(`   다른 선생님: http://${ip}:${PORT}`));
  console.log(`   Claude: ${s.claude ? `켜짐 (${s.claudeModel})` : '꺼짐'} | Gemini: ${s.gemini ? `켜짐 (${s.geminiModel})` : '꺼짐'}`);
  console.log(`   소유자(폴더 접근): ${OWNER || '(미설정 → 모두 접근)'}`);
  if (!s.claude && !s.gemini) console.log('   → 키가 없어 데모(스크립트) 모드. 일정 안내는 정상.');
  console.log('');
});
