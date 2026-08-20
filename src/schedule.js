// 세종늘벗학교 2026학년도 학사일정 데이터 + 조회 헬퍼
// CLAUDE.md의 학사일정을 기계가 읽을 수 있는 형태로 정리한 것.
// 날짜는 'YYYY-MM-DD' 형식.

const EVENTS = [
  // ── 1학기 ──
  { date: '2026-03-09', end: '2026-03-12', title: '1학기 신청기간', tag: '행정' },
  { date: '2026-03-16', end: '2026-03-19', title: '심층면담', tag: '상담' },
  { date: '2026-03-23', end: '2026-03-27', title: '학생 맞이 준비', tag: '준비' },
  { date: '2026-03-30', end: '2026-04-03', title: '마중기간(적응교육)', tag: '행사' },
  { date: '2026-04-06', title: '입교식', tag: '행사' },
  { date: '2026-04-09', title: '교육과정설명회·학급간담회', tag: '행사' },
  { date: '2026-04-10', title: '늘벗지기 선출', tag: '자치' },
  { date: '2026-04-17', title: '운동회', tag: '행사' },
  { date: '2026-04-20', end: '2026-04-24', title: '보호자 상담주간', tag: '상담' },
  { date: '2026-04-24', title: '진로활동', tag: '수업' },
  { date: '2026-05-01', title: '노동절(재량휴업일)', tag: '휴업' },
  { date: '2026-05-04', title: '재량휴업일', tag: '휴업' },
  { date: '2026-05-09', title: '가족캠프(1차)', tag: '행사' },
  { date: '2026-05-29', title: '진로활동', tag: '수업' },
  { date: '2026-06-11', title: '보호자연수', tag: '연수' },
  { date: '2026-06-26', title: '진로활동', tag: '수업' },
  { date: '2026-07-03', title: '수행평가 성적산출 마감', tag: '마감' },
  { date: '2026-07-06', title: '재적학교 초청의 날', tag: '행사' },
  { date: '2026-07-10', title: '학기말 성적 발송', tag: '마감' },
  { date: '2026-07-15', end: '2026-07-16', title: '배움나눔주간', tag: '행사' },
  { date: '2026-07-20', end: '2026-07-23', title: '전환기 운영 주간', tag: '준비' },
  { date: '2026-07-24', title: '방학식 / 학생부 보조자료 발송', tag: '마감' },
  // ── 2학기 ──
  { date: '2026-08-18', title: '개학식', tag: '행사' },
  { date: '2026-08-24', end: '2026-08-28', title: '학생상담주간', tag: '상담' },
  { date: '2026-08-27', title: '교육과정설명회·학급간담회', tag: '행사' },
  { date: '2026-09-03', title: '진로활동', tag: '수업' },
  { date: '2026-09-07', end: '2026-09-11', title: '보호자 상담주간', tag: '상담' },
  { date: '2026-10-06', end: '2026-10-08', title: '늘벗성장여행', tag: '행사' },
  { date: '2026-10-15', title: '보호자연수', tag: '연수' },
  { date: '2026-11-06', title: '수행평가 성적산출 마감(중3·고3)', tag: '마감' },
  { date: '2026-11-13', title: '학기말 성적 발송(중3·고3)', tag: '마감' },
  { date: '2026-11-14', title: '가족캠프(2차)', tag: '행사' },
  { date: '2026-11-20', title: '개교기념일(재량휴업일)', tag: '휴업' },
  { date: '2026-11-26', title: '학생부 보조자료 발송(중3·고3)', tag: '마감' },
  { date: '2026-11-27', title: '진로활동', tag: '수업' },
  { date: '2026-12-04', title: '수행평가 성적산출 마감(전체)', tag: '마감' },
  { date: '2026-12-11', title: '학기말 성적 발송(전체)', tag: '마감' },
  { date: '2026-12-17', end: '2026-12-18', title: '배움나눔주간', tag: '행사' },
  { date: '2026-12-23', title: '음악회(늘벗축제)', tag: '행사' },
  { date: '2026-12-24', end: '2026-12-30', title: '전환기 운영 주간', tag: '준비' },
  { date: '2026-12-31', title: '수료식 / 학생부 보조자료 발송', tag: '마감' },
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

function activeEvents() { return customEvents.length ? customEvents : EVENTS; }
function source() { return customEvents.length ? 'custom' : 'builtin'; }

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
