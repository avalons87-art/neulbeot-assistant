// git 없이 자동 업데이트 — GitHub에서 최신 코드를 zip으로 받아 스스로 교체.
// 버전은 package.json 의 version 으로 비교(신현종 선생님이 배포 때 올림).
// 키·개인설정 파일은 절대 덮어쓰지 않는다.

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

// 업데이트 출처: update-source.txt 에 "owner/repo" 또는 "owner/repo@branch"
function readSource() {
  let raw = '';
  try { raw = fs.readFileSync(path.join(ROOT, 'update-source.txt'), 'utf8').trim(); } catch { return null; }
  if (!raw || /여기에|owner\/repo|PUT-/.test(raw)) return null;
  const m = raw.replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/, '').match(/^([^/\s]+)\/([^/@\s]+)(?:@(\S+))?$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2], branch: m[3] || 'main' };
}

function localVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || '0'; } catch { return '0'; }
}

// 업데이트 있는지 확인
async function checkUpdate() {
  const src = readSource();
  if (!src) return { available: false, noSource: true };
  const local = localVersion();
  const url = `https://raw.githubusercontent.com/${src.owner}/${src.repo}/${src.branch}/package.json`;
  const r = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
  if (!r.ok) throw new Error(`버전 확인 실패(${r.status}). 저장소/브랜치 확인.`);
  const remote = (await r.json()).version || '';
  return { available: !!remote && remote !== local, remote, local, source: `${src.owner}/${src.repo}@${src.branch}` };
}

// 덮어쓰면 안 되는 것(키·개인설정) + 스킵 디렉터리
const SKIP_FILES = new Set(['my-keys.bat', 'teacher-keys.bat', 'keys.json', 'owner.txt', 'work-dir.txt', 'brand.txt', 'schedule.json', 'user-folders.json', 'user-profiles.json', 'folder-analysis.json', 'update-source.txt']);
const SKIP_DIR = /^(node_modules|outputs|\.git)\//;

// 최신 zip 다운로드 → 코드 파일만 교체
async function applyUpdate() {
  const src = readSource();
  if (!src) throw new Error('업데이트 출처가 없어요(update-source.txt).');
  const zipUrl = `https://codeload.github.com/${src.owner}/${src.repo}/zip/refs/heads/${src.branch}`;
  const r = await fetch(zipUrl);
  if (!r.ok) throw new Error(`다운로드 실패(${r.status}).`);
  const buf = Buffer.from(await r.arrayBuffer());
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(buf);
  const entries = zip.getEntries();
  if (!entries.length) throw new Error('빈 압축이에요.');
  const top = entries[0].entryName.split('/')[0]; // "repo-branch"
  let copied = 0;
  for (const e of entries) {
    if (e.isDirectory) continue;
    const rel = e.entryName.slice(top.length + 1); // "repo-branch/" 제거
    if (!rel) continue;
    if (SKIP_DIR.test(rel)) continue;
    const base = rel.split('/').pop();
    if (SKIP_FILES.has(rel) || SKIP_FILES.has(base)) continue; // 키·개인설정 보존
    const dest = path.join(ROOT, rel.replace(/\//g, path.sep));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    let data = e.getData();
    // .bat 는 반드시 CRLF (LF면 윈도우 cmd 파싱이 깨짐). ASCII 전제라 latin1 안전.
    if (/\.bat$/i.test(rel)) data = Buffer.from(data.toString('latin1').replace(/\r?\n/g, '\r\n'), 'latin1');
    fs.writeFileSync(dest, data);
    copied++;
  }
  return { copied };
}

module.exports = { ROOT, readSource, localVersion, checkUpdate, applyUpdate };
