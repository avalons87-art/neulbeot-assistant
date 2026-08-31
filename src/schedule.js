// 학사일정 조회 헬퍼. 실제 일정은 앱에서 불러온 것(schedule.json)을 쓴다.
// 아래 EVENTS 는 형식 참고용 예시일 뿐, 자동 기본값으로 쓰이지 않는다.
// 날짜는 'YYYY-MM-DD' 형식.

const EVENTS = [
  // 형식 예시(실제로 쓰이지 않음). 실제 일정은 앱의 '📅 일정 불러오기'로 넣는다.
  { date: '2026-03-02', title: '개학식', tag: '행사' },
  { date: '2026-07-20', end: '2026-07-24', title: '기말 정리 주간', tag: '행정' },
  { date: '2026-12-31', title: '종업식', tag: '행사' },
];

function toDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function fmt(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function daysBetween(a, b) {
  return Math.round((toDate(b) - toDate(a)) / 86400000);
}

// ── 불러온 학사일정(있으면 내장 대신 사용) ──
const fs = require('fs');
const path = require('path');
const SCHED_FILE = path.join(__dirname, '..', 'schedule.json');
let customEvents = [];
try { const j = JSON.parse(fs.readFileSync(SCHED_FILE, 'utf8')); if (Array.isArray(j.events)) customEvents = j.events; } catch {}

// 불러온 일정이 있으면 그걸, 없으면 비움(학교 중립 — 각 학교 일정을 넣어 쓰도록).
function activeEvents() { return customEvents.length ? customEvents : []; }
function source() { return customEvents.length ? 'custom' : 'none'; }

// 파싱된 일정으로 교체(정규화·정렬). 반환: 개수.
function setCustom(events) {
  const clean = (Array.isArray(events) ? events : [])
    .filter((e) => e && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && e.title)
    .map((e) => ({
      date: e.date,
      ...(e.end && /^\d{4}-\d{2}-\d{2}$/.test(e.end) && e.end >= e.date ? { end: e.end } : {}),
      title: String(e.title).slice(0, 120),
      tag: String(e.tag || '일정').slice(0, 12),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  customEvents = clean;
  try { fs.writeFileSync(SCHED_FILE, JSON.stringify({ events: clean, importedAt: new Date().toISOString() }, null, 2), 'utf8'); } catch (e) { console.warn('[schedule] 저장 실패:', e.message); }
  return clean.length;
}
function clearCustom() {
  customEvents = [];
  try { if (fs.existsSync(SCHED_FILE)) fs.unlinkSync(SCHED_FILE); } catch {}
}

// 특정 날짜(기본: 오늘)에 진행 중인 일정 목록
function eventsOn(todayStr) {
  const t = toDate(todayStr);
  return activeEvents().filter((e) => {
    const s = toDate(e.date);
    const en = e.end ? toDate(e.end) : s;
    return t >= s && t <= en;
  });
}

// 오늘 이후 가장 가까운 일정들 (n개)
function upcoming(todayStr, n = 5) {
  return activeEvents().filter((e) => e.date >= todayStr)
    .slice(0, n)
    .map((e) => ({ ...e, dday: daysBetween(todayStr, e.date) }));
}

// 이번 주(월~일) 일정
function thisWeek(todayStr) {
  const t = toDate(todayStr);
  const dow = (t.getDay() + 6) % 7; // 월=0
  const monday = new Date(t);
  monday.setDate(t.getDate() - dow);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const [ms, ss] = [fmt(monday), fmt(sunday)];
  return activeEvents().filter((e) => {
    const s = e.date, en = e.end || e.date;
    return !(en < ms || s > ss); // 주간과 겹치는 일정
  });
}

// 다가오는 마감(성적/보조자료 등). 불러온 일정엔 '마감' 태그가 없을 수 있어 키워드도 본다.
function deadlines(todayStr, n = 4) {
  return activeEvents().filter((e) => (e.tag === '마감' || /마감|발송|산출|제출/.test(e.title)) && e.date >= todayStr)
    .slice(0, n)
    .map((e) => ({ ...e, dday: daysBetween(todayStr, e.date) }));
}

module.exports = { EVENTS, eventsOn, upcoming, thisWeek, deadlines, daysBetween, fmt, setCustom, clearCustom, source, activeEvents };
