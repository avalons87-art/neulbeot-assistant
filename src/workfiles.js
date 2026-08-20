// 업무 폴더 연동 — 목록 보기 / 텍스트·PDF 참고 읽기 / 산출물 저장
// 민감정보(비밀번호 폴더, 인증서 .cer/.key 등)는 목록·읽기 모두에서 차단한다.

const fs = require('fs');
const path = require('path');

// 기본 업무 폴더: 환경변수 WORK_DIR > work-dir.txt(UTF-8) > 없음.
// (배포본엔 work-dir.txt 를 빼서, 각 선생님이 첫 실행 때 자기 폴더를 고르게 함)
function readWorkDirFile() {
  try { return fs.readFileSync(path.join(__dirname, '..', 'work-dir.txt'), 'utf8').trim(); }
  catch { return ''; }
}
const WORK_DIR = (process.env.WORK_DIR || readWorkDirFile() || '').replace(/\\/g, '/');
const SAVE_SUBDIR = '늘벗이_산출물';
// 폴더가 없는 손님의 산출물이 임시로 저장되는 서버 내 폴더(다운로드용)
const OUTPUT_FALLBACK = path.join(__dirname, '..', 'outputs');
const TRASH_SUBDIR = '늘벗이_휴지통';
const BACKUP_SUBDIR = '늘벗이_백업';
function stamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
}

const DENY_EXT = /\.(cer|key|pfx|p12|der|crt|pem)$/i;
const SKIP_EXT = /\.(otf|ttf|ttc|woff2?|eot|tmp|bak|ini|db|lnk|url)$/i; // 폰트·임시 등 노이즈
const TEXT_EXT = /\.(txt|md|markdown|csv|json|html?|xml|log)$/i;
const READABLE = /\.(txt|md|markdown|csv|json|html?|xml|log|pdf)$/i;

// 민감/노이즈 폴더·파일 차단: 숨김(.으로 시작), 개발/시스템 폴더, 비밀번호류
function isDenyName(name) {
  if (name.startsWith('.')) return true; // .venv .claude .git 등 숨김
  if (/^(__pycache__|node_modules|venv|env|dist|build|\$RECYCLE\.BIN)$/i.test(name)) return true;
  if (/(비밀번호|비번|password|passwd)/i.test(name)) return true;
  return false;
}

function exists(dir) {
  dir = dir || WORK_DIR;
  try { return fs.existsSync(dir) && fs.statSync(dir).isDirectory(); }
  catch { return false; }
}

// 폴더 목록(재귀, 민감 항목 제외). dir=그 선생님의 업무 폴더(없으면 기본).
function listFiles(dir, { max = 5000, maxDepth = 8 } = {}) {
  const base = dir || WORK_DIR;
  if (!exists(base)) return { ok: false, dir: base, files: [] };
  const out = [];
  (function walk(d, rel, depth) {
    if (depth > maxDepth || out.length >= max) return;
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
    for (const e of entries) {
      if (out.length >= max) break;
      const name = e.name;
      if (isDenyName(name)) continue;
      const relPath = rel ? rel + '/' + name : name;
      if (e.isDirectory()) {
        out.push({ type: 'dir', path: relPath, name, depth });
        walk(path.join(d, name), relPath, depth + 1);
      } else {
        if (DENY_EXT.test(name) || SKIP_EXT.test(name)) continue;
        const ext = path.extname(name).toLowerCase();
        let size = 0;
        try { size = fs.statSync(path.join(d, name)).size; } catch {}
        out.push({ type: 'file', path: relPath, name, ext, size, depth, readable: READABLE.test(name) });
      }
    }
  })(base, '', 0);
  return { ok: true, dir: base, files: out, truncated: out.length >= max };
}

// 경로가 업무 폴더 안인지 + 민감파일 아닌지 검증
function safeResolve(dir, rel) {
  const base = dir || WORK_DIR;
  const root = path.resolve(base);
  const abs = path.resolve(base, rel);
  const relCheck = path.relative(root, abs);
  if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) throw new Error('폴더 밖 경로예요');
  if (DENY_EXT.test(abs)) throw new Error('접근할 수 없는 파일이에요');
  if (relCheck.split(/[\\/]/).some(isDenyName)) throw new Error('접근할 수 없는 위치예요');
  return abs;
}

function clip(t, n) {
  t = (t || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  return t.length > n ? t.slice(0, n) + '\n…(이하 생략)' : t;
}

// 참고용 텍스트 추출 (텍스트/PDF). dir=그 선생님 폴더. 반환: {name, text}
async function readText(dir, rel, { maxChars = 6000 } = {}) {
  const abs = safeResolve(dir, rel);
  if (!fs.existsSync(abs)) throw new Error('파일이 없어요');
  const name = path.basename(abs);
  return await extractBuffer(name, fs.readFileSync(abs), maxChars);
}

// 버퍼(업로드/파일)에서 텍스트 추출 — 텍스트/PDF. 반환: {name, text}
async function extractBuffer(name, buf, maxChars = 6000) {
  const ext = path.extname(name).toLowerCase();
  if (TEXT_EXT.test(name)) return { name, text: clip(buf.toString('utf8'), maxChars) };
  if (ext === '.pdf') {
    let pdf;
    try { pdf = require('pdf-parse'); } catch { throw new Error('PDF 읽기 모듈이 없어요'); }
    const data = await pdf(buf);
    return { name, text: clip(data.text, maxChars) };
  }
  throw new Error(`이 형식(${ext})은 참고 불가예요. PDF나 텍스트(.txt/.md/.csv)만 돼요 (HWP는 PDF로 저장 후 올려주세요).`);
}

// 산출물 저장 → 그 선생님 폴더/늘벗이_산출물/제목_시각.txt
function saveDeliverable(dir, title, body, ext = 'txt') {
  const { file, rel } = makePath(dir, title, ext);
  fs.writeFileSync(file, body, 'utf8');
  return { saved: file, rel };
}

// 저장 경로 준비(폴더 생성 + 안전한 파일명 + 시각 스탬프). 폴더 없으면 서버 임시 출력 폴더.
function makePath(baseDir, title, ext) {
  const base = baseDir || OUTPUT_FALLBACK;
  const dir = path.join(base, SAVE_SUBDIR);
  fs.mkdirSync(dir, { recursive: true });
  const safe = (title || '자료').replace(/[\\/:*?"<>|\n\r\t]+/g, ' ').trim().slice(0, 60) || '자료';
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  const file = path.join(dir, `${safe}_${stamp}.${ext}`);
  return { file, rel: `${SAVE_SUBDIR}/${path.basename(file)}` };
}

// 슬라이드 배열 → 실제 파워포인트(.pptx) 저장
// slides: [{ title, bullets:[...] }] 또는 [{ title, body }]. 첫 슬라이드는 표지로.
async function savePptx(dir, title, slides) {
  const { file, rel } = makePath(dir, title, 'pptx');
  const PptxGenJS = require('pptxgenjs');
  const p = new PptxGenJS();
  p.layout = 'LAYOUT_WIDE';
  const F = '맑은 고딕';
  const list = Array.isArray(slides) ? slides : [];

  // 표지
  const cover = p.addSlide();
  cover.background = { color: 'F5FBF5' };
  cover.addText(title || '발표자료', { x: 0.7, y: 2.5, w: 12, h: 1.4, fontSize: 40, bold: true, color: '2F5D3A', fontFace: F, align: 'center' });
  cover.addText('세종늘벗학교', { x: 0.7, y: 4.0, w: 12, h: 0.7, fontSize: 22, color: '5FB56A', fontFace: F, align: 'center' });

  // 내용 슬라이드
  for (const sl of list) {
    const s = p.addSlide();
    s.background = { color: 'FFFFFF' };
    s.addText(String(sl.title || ''), { x: 0.5, y: 0.35, w: 12.3, h: 1, fontSize: 30, bold: true, color: '2F5D3A', fontFace: F });
    s.addShape(p.ShapeType.line, { x: 0.55, y: 1.3, w: 12.2, h: 0, line: { color: '8AD48F', width: 2 } });
    let bullets = Array.isArray(sl.bullets) && sl.bullets.length ? sl.bullets
      : (sl.body ? String(sl.body).split('\n').map((s) => s.trim()).filter(Boolean) : []);
    if (bullets.length) {
      s.addText(
        bullets.map((b) => ({ text: String(b).replace(/^[-*·•\s]+/, ''), options: { bullet: { code: '2022' }, fontSize: 19, color: '333333', fontFace: F, paraSpaceAfter: 10 } })),
        { x: 0.8, y: 1.6, w: 11.7, h: 5.4, valign: 'top' }
      );
    }
  }
  await p.writeFile({ fileName: file });
  return { saved: file, rel, slideCount: list.length };
}

// 폴더 선택창용 — 하위 폴더 목록(폴더만, 민감·숨김 제외)
function listSubdirs(dirPath) {
  let entries;
  try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); }
  catch { throw new Error('이 폴더를 열 수 없어요(권한/경로 확인).'); }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory() || isDenyName(e.name)) continue;
    out.push({ name: e.name, path: path.join(dirPath, e.name).replace(/\\/g, '/') });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
// 사용 가능한 드라이브 목록(윈도우)
function listDrives() {
  const drives = [];
  for (const L of 'CDEFGHIJKLMNOPQRSTUVWXYZAB') {
    const p = L + ':/';
    try { if (fs.existsSync(p)) drives.push(p); } catch {}
  }
  return drives;
}
function isDriveRoot(p) { return /^[a-zA-Z]:\/?$/.test(String(p)); }

// 폴더 구조를 압축 요약(AI 분석/개요용). 파일 내용은 안 읽고 이름·구조만 → 저렴.
function analyzeStructure(dir) {
  const base = dir || WORK_DIR;
  const { ok, files } = listFiles(base, { max: 6000, maxDepth: 8 });
  if (!ok) return { ok: false, dir: base, text: '', fileCount: 0, readableCount: 0, topDirs: [] };
  const fileList = files.filter((f) => f.type === 'file');
  const dirs = files.filter((f) => f.type === 'dir');
  const byExt = {};
  fileList.forEach((f) => { const k = f.ext || '(무확장)'; byExt[k] = (byExt[k] || 0) + 1; });
  const topDirs = dirs.filter((d) => d.depth === 0).map((d) => d.name);
  const midDirs = dirs.filter((d) => d.depth === 1).map((d) => d.path).slice(0, 40);
  const readable = fileList.filter((f) => f.readable).map((f) => f.path).slice(0, 150);
  const extLine = Object.entries(byExt).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k} ${v}`).join(', ');
  const text = [
    `총 파일 ${fileList.length}개 (${extLine})`,
    `최상위 폴더: ${topDirs.join(', ') || '(없음)'}`,
    midDirs.length ? `하위 폴더(일부): ${midDirs.join(' / ')}` : '',
    `참고 가능 문서(PDF/텍스트) 예시 (최대 150개):`,
    ...readable.map((p) => `- ${p}`),
  ].filter(Boolean).join('\n');
  return { ok: true, dir: base, text, fileCount: fileList.length, readableCount: fileList.filter((f) => f.readable).length, topDirs };
}

// 슬라이드 배열 → 미리보기용 텍스트(산출물 패널/세션 기억용)
function slidesToText(title, slides) {
  const list = Array.isArray(slides) ? slides : [];
  const parts = [`[${title || '발표자료'}]`, ''];
  list.forEach((sl, i) => {
    parts.push(`◆ 슬라이드 ${i + 1}: ${sl.title || ''}`);
    const bullets = Array.isArray(sl.bullets) ? sl.bullets : (sl.body ? String(sl.body).split('\n') : []);
    bullets.forEach((b) => { const t = String(b).replace(/^[-*·•\s]+/, '').trim(); if (t) parts.push(`  - ${t}`); });
    parts.push('');
  });
  return parts.join('\n').trim();
}

// ── 파일 변경 작업(에이전트가 승인받고 실행) — 모두 dir(그 선생님 폴더) 안에서만 ──

// 파일/폴더 이름변경·이동. to 가 기존 폴더면 그 안으로. 덮어쓰기는 막음.
function moveFile(dir, from, to) {
  const src = safeResolve(dir, from);
  if (!fs.existsSync(src)) throw new Error('원본이 없어요: ' + from);
  let dstRel = String(to || '').replace(/\\/g, '/');
  const tryAbs = safeResolve(dir, dstRel);
  if (fs.existsSync(tryAbs) && fs.statSync(tryAbs).isDirectory()) dstRel = dstRel.replace(/\/+$/, '') + '/' + path.basename(src);
  const dst = safeResolve(dir, dstRel);
  if (fs.existsSync(dst)) throw new Error('같은 이름이 이미 있어요: ' + dstRel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.renameSync(src, dst);
  return { rel: dstRel };
}

function createFolder(dir, rel) {
  const abs = safeResolve(dir, rel);
  fs.mkdirSync(abs, { recursive: true });
  return { rel };
}

// 텍스트 파일 수정 — 덮어쓰기 전 원본을 늘벗이_백업/ 에 복사(되돌리기 가능).
function editTextFile(dir, rel, content) {
  const abs = safeResolve(dir, rel);
  if (!TEXT_EXT.test(abs)) throw new Error('텍스트 파일(.txt/.md/.csv 등)만 수정할 수 있어요. (HWP/PDF 불가)');
  let backedUp = null;
  if (fs.existsSync(abs)) {
    const bdir = path.join(dir, BACKUP_SUBDIR);
    fs.mkdirSync(bdir, { recursive: true });
    const bfile = path.join(bdir, `${path.basename(abs)}.${stamp()}.bak`);
    fs.copyFileSync(abs, bfile);
    backedUp = `${BACKUP_SUBDIR}/${path.basename(bfile)}`;
  } else {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
  }
  fs.writeFileSync(abs, content, 'utf8');
  return { rel, backedUp };
}

// 삭제 대신 늘벗이_휴지통/ 으로 이동(복구 가능).
function deleteToTrash(dir, rel) {
  const src = safeResolve(dir, rel);
  if (!fs.existsSync(src)) throw new Error('파일이 없어요: ' + rel);
  const tdir = path.join(dir, TRASH_SUBDIR);
  fs.mkdirSync(tdir, { recursive: true });
  let dst = path.join(tdir, path.basename(src));
  if (fs.existsSync(dst)) dst = path.join(tdir, `${stamp()}_${path.basename(src)}`);
  fs.renameSync(src, dst);
  return { rel: `${TRASH_SUBDIR}/${path.basename(dst)}` };
}

module.exports = { WORK_DIR, OUTPUT_FALLBACK, exists, listFiles, listSubdirs, listDrives, isDriveRoot, analyzeStructure, readText, extractBuffer, saveDeliverable, savePptx, slidesToText, safeResolve, moveFile, createFolder, editTextFile, deleteToTrash };
