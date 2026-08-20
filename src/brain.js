// 늘벗이(팀장)의 짧은 대화 두뇌 — 학사일정/업무 즉답 + 자유대화(Claude)
// 긴 협업 작업은 team.js(회의 파이프라인)가 담당한다.

const schedule = require('./schedule');
const ai = require('./ai');
const session = require('./session');

const PERSONA = `너는 '늘벗이'라는 이름의 귀여운 픽셀 마스코트이자 AI 팀의 팀장이야.
세종늘벗학교(대안교육위탁기관)의 신현종 선생님을 돕는 역할이야.
말투: 다정하고 발랄하게, 짧고 명료하게. 이모지는 가끔 하나 정도만.
학생 이름은 절대 전체로 말하지 말고 'OO'로 처리해.
이전 대화 맥락을 이어서 자연스럽게 답해. 앞 내용을 무시하고 처음부터 답하지 마.
문서 작성·수정 같은 실제 작업은 팀 회의(팀에게 맡기기)로 하니, 그런 요청이면 "팀에게 맡기기로 진행할게요"라고 안내해.
답변은 2~3문장 이내로 짧게.`;

function ruleReply(msg, todayStr) {
  const t = msg.replace(/\s+/g, '');
  if (/^(안녕|하이|hi|hello|반가|좋은아침|굿모닝)/.test(t))
    return { reply: '안녕하세요 선생님! 오늘도 늘벗이 팀이 함께할게요 🌱', mood: 'happy' };
  if (/(오늘).*(일정|뭐|스케줄|할일)|오늘일정/.test(t)) {
    const ev = schedule.eventsOn(todayStr);
    if (ev.length === 0) return { reply: '오늘은 특별히 등록된 학사일정이 없어요. 여유로운 하루 되세요!', mood: 'idle' };
    return { reply: `오늘(${todayStr})은 "${ev.map((e) => e.title).join(', ')}" 이에요!`, mood: 'point' };
  }
  if (/이번주|금주|이번한주/.test(t)) {
    const ev = schedule.thisWeek(todayStr);
    if (ev.length === 0) return { reply: '이번 주는 등록된 일정이 없네요. 조용한 한 주예요.', mood: 'idle' };
    return { reply: `이번 주 일정: ${ev.map((e) => `${e.date.slice(5)} ${e.title}`).join(' / ')}`, mood: 'point' };
  }
  if (/(다음|앞으로|담엔|이후).*(일정|뭐)|다음일정|곧있을/.test(t)) {
    const up = schedule.upcoming(todayStr, 3);
    if (up.length === 0) return { reply: '앞으로 등록된 일정이 없어요.', mood: 'idle' };
    return { reply: `다가오는 일정: ${up.map((e) => `${e.title}(D-${e.dday})`).join(', ')}`, mood: 'point' };
  }
  if (/(마감|언제까지|성적발송|보조자료|성적산출|데드라인)/.test(t)) {
    const dl = schedule.deadlines(todayStr, 4);
    if (dl.length === 0) return { reply: '다가오는 마감은 없어요. 잘 챙기셨네요!', mood: 'happy' };
    return { reply: `마감 일정: ${dl.map((e) => `${e.title}(${e.date.slice(5)}, D-${e.dday})`).join(' / ')}`, mood: 'point' };
  }
  if (/(전화|번호|연락처)/.test(t)) return { reply: '학교 대표번호는 044-999-1281 이에요.', mood: 'idle' };
  if (/(주소|위치|어디있)/.test(t)) return { reply: '세종특별자치시 조치원읍 내창천로 52 예요.', mood: 'idle' };
  if (/보결|보강수당|결보강수당/.test(t)) return { reply: '2026년 수업 결·보강 보결 수당은 15,000원이에요.', mood: 'idle' };
  if (/(힘들|지친|피곤|스트레스|우울)/.test(t))
    return { reply: '선생님 오늘 정말 고생 많으셨어요. 늘벗이가 응원할게요, 조금만 쉬어가요 🌿', mood: 'happy' };
  if (/(고마워|감사|땡큐|thx)/.test(t))
    return { reply: '헤헤, 도움이 됐다니 기뻐요! 언제든 불러주세요.', mood: 'happy' };
  return null;
}

function dumbFallback(msg) {
  const bank = [
    '오오, 그건 제가 바로는 잘 몰라요. "오늘 일정", "이번 주", "마감 언제야?" 는 즉답 가능하고, 문서 작업은 아래 "팀에게 업무 맡기기"로 시켜보세요!',
    '음~ 그건 팀 회의가 필요하겠는데요? 아래에서 팀에게 맡겨보세요 🌱',
    '늘벗이 팀은 공문·안내문·계획안 같은 문서 작업을 잘해요. "팀에게 맡기기"를 눌러보세요!',
  ];
  return { reply: bank[Math.floor(Math.random() * bank.length)], mood: 'idle' };
}

async function reply(message, opts = {}) {
  const todayStr = opts.today || schedule.fmt(new Date());
  const store = opts.store || session.get('default');
  const r = ruleReply(message || '', todayStr);
  if (r) { store.recordExchange(message, r.reply); return { ...r, source: 'rule' }; }

  try {
    const todayEv = schedule.eventsOn(todayStr).map((e) => e.title).join(', ') || '없음';
    const draftNote = store.draft
      ? `\n현재 팀이 작성해 둔 초안이 있음: "${store.draft.task}". 사용자가 그 초안 관련해 물으면 이걸 참고. 실제 수정은 '팀에게 맡기기'로.`
      : '';
    const text = await ai.callClaude(
      `${PERSONA}\n오늘 날짜: ${todayStr}. 오늘 학사일정: ${todayEv}.${draftNote}`,
      message,
      { maxTokens: 400, effort: 'medium', history: store.agentMessages }
    );
    if (text != null) {
      store.recordExchange(message, text);
      return { reply: text || '음... 잘 모르겠어요!', mood: 'happy', source: 'ai' };
    }
  } catch (e) {
    console.warn('[brain] AI 호출 실패:', e.message);
  }
  const fb = dumbFallback(message);
  store.recordExchange(message, fb.reply);
  return { ...fb, source: 'fallback' };
}

// 즉답 가능한 일정/인사만 반환(그 외 null) — 에이전트 fast-path 용
function quickAnswer(message, todayStr) {
  return ruleReply(message || '', todayStr || schedule.fmt(new Date()));
}

module.exports = { reply, quickAnswer };
