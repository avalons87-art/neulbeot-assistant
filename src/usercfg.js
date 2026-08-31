// 선생님(uid)별 업무 폴더 경로 저장 — user-folders.json 에 영구 저장.
// 보안: 손님이 서버 PC의 아무 폴더나 지정하면 소유자 PC 전체를 읽을 수 있으므로,
//   폴더 경로 설정은 shared-root.txt 로 지정한 '공유 폴더' 안으로만 허용한다.
//   (shared-root.txt 가 없으면 폴더 경로 설정 기능은 꺼짐 → 업로드 방식을 쓰면 됨)

const fs = require('fs');
const path = require('path');

const CFG = path.join(__dirname, '..', 'user-folders.json');
function readSharedRoot() {
  try { const v = fs.readFileSync(path.join(__dirname, '..', 'shared-root.txt'), 'utf8').trim(); return v || ''; }
  catch { return ''; }
}
const SHARED_ROOT = readSharedRoot();

function load() { try { return JSON.parse(fs.readFileSync(CFG, 'utf8')); } catch { return {}; } }
function save(o) { try { fs.writeFileSync(CFG, JSON.stringify(o, null, 2), 'utf8'); } catch (e) { console.warn('[usercfg] 저장 실패:', e.message); } }

function getFolder(uid) { return (load()[String(uid)] || '') || ''; }

// 폴더 설정/해제. opts.owner=true면 서버 PC 아무 폴더나(본인 PC), 손님은 공유폴더 안으로만.
function setFolder(uid, dir, opts = {}) {
  const key = String(uid || '');
  const o = load();
  const clean = String(dir || '').replace(/\\/g, '/').trim();
  if (!clean) { delete o[key]; save(o); return { ok: true, folder: '' }; }
  const abs = path.resolve(clean);
  if (opts.owner) {
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new Error('그 폴더가 서버에서 안 보여요(경로 확인).');
    o[key] = abs; save(o); return { ok: true, folder: abs };
  }
  if (!SHARED_ROOT) throw new Error('공유 폴더 루트가 설정되지 않았어요. 관리자가 shared-root.txt 를 만들어야 폴더 지정이 가능해요. (지금은 파일 업로드를 쓰세요)');
  const root = path.resolve(SHARED_ROOT);
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`허용된 공유 폴더 안이어야 해요:\n${SHARED_ROOT}`);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new Error('그 폴더가 이 서버에서 안 보여요(경로 확인). 서버 PC에서 접근 가능한 공유 폴더여야 해요.');
  o[key] = abs; save(o);
  return { ok: true, folder: abs };
}

// ── 폴더 개요(자동 분석) 캐시 — 폴더 경로별로 1회 분석 결과 저장 ──
const ANALYSIS = path.join(__dirname, '..', 'folder-analysis.json');
function loadA() { try { return JSON.parse(fs.readFileSync(ANALYSIS, 'utf8')); } catch { return {}; } }
function saveA(o) { try { fs.writeFileSync(ANALYSIS, JSON.stringify(o, null, 2), 'utf8'); } catch (e) { console.warn('[usercfg] 분석캐시 저장 실패:', e.message); } }
function getAnalysis(folder) { return loadA()[folder] || null; }
function setAnalysis(folder, overview) { const o = loadA(); o[folder] = { overview, at: Date.now() }; saveA(o); }

// ── 선생님(uid)별 업무 프로필(온보딩에서 확인한 '내 업무 범위') — user-profiles.json ──
const PROFILES = path.join(__dirname, '..', 'user-profiles.json');
function loadP() { try { return JSON.parse(fs.readFileSync(PROFILES, 'utf8')); } catch { return {}; } }
function saveP(o) { try { fs.writeFileSync(PROFILES, JSON.stringify(o, null, 2), 'utf8'); } catch (e) { console.warn('[usercfg] 프로필 저장 실패:', e.message); } }
function getProfile(uid) { return loadP()[String(uid || '')] || null; }
function setProfile(uid, work, school) {
  const o = loadP();
  const k = String(uid || ''); const prev = o[k] || {};
  // school 을 안 보낸 요청이 기존 학교명을 지우지 않게 유지
  o[k] = { work: String(work || '').slice(0, 4000), school: String(school || prev.school || '').slice(0, 80), at: Date.now() };
  saveP(o); return o[k];
}
// 학교명만 갱신(온보딩 1단계 - 업무 파악 전에 저장). 기존 work 는 보존.
function setSchool(uid, school) {
  const o = loadP(); const k = String(uid || '');
  const cur = o[k] || { work: '', at: Date.now() };
  cur.school = String(school || '').slice(0, 80); cur.at = Date.now();
  o[k] = cur; saveP(o); return cur;
}
function clearProfile(uid) { const o = loadP(); delete o[String(uid || '')]; saveP(o); }

module.exports = { getFolder, setFolder, sharedRoot: () => SHARED_ROOT, getAnalysis, setAnalysis, getProfile, setProfile, setSchool, clearProfile };
