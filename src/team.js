// 팀 회의 파이프라인 (v2 — 맥락 공유 + 지능 상향 + 이어서 수정)
// 각 단계가 '회의록'을 통째로 물려받아 앞 단계를 실제로 이어간다.
// 이전 초안이 있고 수정 요청이면 → 전체 회의 대신 '빠른 수정'으로 이어서 고친다.

const ai = require('./ai');

// 회의 공용 컨텍스트. 담당자(이름·학교)는 앱에서 받은 값만 넣고, 없으면 학교를 특정하지 않는다.
function ctx(who) {
  const head = who
    ? '담당: ' + who + '.'
    : '담당 학교 정보는 없다. 특정 학교를 임의로 가정하거나 지어내지 마라.';
  return head + '\n' + [
    '산출물은 주로 한국 학교 행정 문서다: 공문/내부결재/가정통신문/안내문/계획안/체크리스트/품의서 등.',
    "규칙: 학생 이름은 반드시 'OO'로 처리. 연도는 '○○학년도' 형식으로 표기. 실제로 바로 제출 가능하게 구체적으로.",
    "너희는 4인 팀(팀장·기획·디자인·실무)이다. 각자 앞 사람이 한 작업을 '이어받아' 발전시키며, 앞 내용과 어긋나면 안 된다.",
  ].join('\n');
}

const pick = (a, b) => (a != null ? a : b);
const ROLE_KO = { lead: '팀장', plan: '기획', design: '디자인', work: '실무' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 회의록을 텍스트로
function minutes(transcript) {
  return transcript.map((t) => `[${ROLE_KO[t.role] || t.role}] ${t.text}`).join('\n\n');
}

// 수정 요청처럼 보이는지 (이전 초안이 있을 때만 의미)
function looksLikeRevision(t) {
  const s = t.replace(/\s+/g, '');
  return s.length < 45 && /(고쳐|고치|수정|바꿔|바꾸|다시|더|좀더|짧게|줄여|길게|늘려|정중|공손|친근|딱딱|부드럽|추가|넣어|빼|없애|삭제|강조|반영|이거|그거|방금|위에|아까|말투|톤|분량|형식)/.test(s);
}

async function runMeeting(task, emit, opts = {}) {
  const CTX = ctx(opts.who);
  const st = ai.status();
  if (!st.claude && !st.gemini) return mockMeeting(task, emit);

  const refBlock = opts.refText ? `\n\n[참고 문서: ${opts.refName || '첨부'}]\n${String(opts.refText).slice(0, 6000)}` : '';
  const prev = opts.prevDraft; // {task, body}
  const onDraft = typeof opts.onDraft === 'function' ? opts.onDraft : () => {};
  const dual = st.claude && st.gemini;

  // ── 빠른 수정 경로: 이전 초안을 이어서 고친다 ──
  if (prev && looksLikeRevision(task)) {
    emit({ type: 'turn', role: 'lead', text: `이전 초안("${prev.task}")을 "${task}" 방향으로 팀이 바로 손볼게요.` });
    const sys = `${CTX}\n너는 실무 작성 담당이다. 아래 '기존 초안'을 사용자의 수정 요청대로 개선해 완성본 전체를 다시 출력하라. 요청된 부분만 바꾸고 나머지는 유지하며, 문서 완결성을 지켜라. 설명 없이 문서 본문만.`;
    const user = `수정 요청: ${task}\n\n[기존 초안: ${prev.task}]\n${prev.body}${refBlock}`;
    const draft = (await callBest(sys, user, { effort: 'high', maxTokens: 2600 })) || prev.body;
    emit({ type: 'turn', role: 'work', text: '요청하신 대로 이어서 고쳤어요! 아래에서 확인하세요 📄' });
    emit({ type: 'deliverable', title: prev.task, body: draft });
    onDraft({ task: prev.task, body: draft });
    emit({ type: 'turn', role: 'lead', text: '수정 완료! 더 손볼 곳 있으면 이어서 말씀해주세요 🌱' });
    return;
  }

  // ── 새 업무: 4단계 회의 (회의록 공유) ──
  const transcript = [];
  const record = (role, text) => { transcript.push({ role, text }); emit({ type: 'turn', role, text }); };
  const prevBlock = prev ? `\n\n[직전 작업물 "${prev.task}" — 관련되면 참고, 아니면 무시]\n${prev.body.slice(0, 1500)}` : '';

  record('lead', `"${task}" 업무 시작할게요! ${opts.refText ? `📎 "${opts.refName}" 참고해서, ` : ''}${dual ? '기획팀이 Claude·Gemini 두 관점으로 방안을 잡습니다.' : '기획팀이 방안을 잡습니다.'}`);

  // 1) 기획 — 서로 다른 렌즈로 병렬 제안
  const planSysC = `${CTX}\n너는 기획 담당(실용·정확성 관점)이다. 실무자가 바로 실행할 접근안을 대상/목적/절차/준비물/유의점 관점에서 3~5개 불릿으로. 학교 행정 실무에 맞게 구체적으로.`;
  const planSysG = `${CTX}\n너는 기획 담당(완성도·톤·독자경험 관점)이다. 이 문서를 받는 사람(보호자/학생/교직원)에게 어떻게 다가갈지, 핵심 메시지와 어조·구성 관점에서 3~5개 불릿으로.`;
  const planUser = `업무: ${task}${refBlock}${prevBlock}`;
  const [pc, pg] = await Promise.all([
    ai.callClaude(planSysC, planUser, { effort: 'medium', maxTokens: 700 }).catch((e) => `(Claude 오류: ${e.message})`),
    ai.callGemini(planSysG, planUser, { maxTokens: 900 }).catch((e) => `(Gemini 오류: ${e.message})`),
  ]);
  if (pc != null) record('plan', `🔵 Claude · 실용 관점\n${pc}`);
  if (pg != null) record('plan', `🟢 Gemini · 완성도 관점\n${pg}`);
  if (pc == null && pg == null) record('plan', '기획안을 못 받았어요. 팀장이 직접 잡을게요.');

  // 2) 팀장 종합 — 회의록을 읽고 최적안 결정
  const synthSys = `${CTX}\n너는 팀장이다. 아래 회의록의 두 관점을 실제로 결합해 '최종 실행 방안'을 정하라. 5개 이내 불릿으로, 각 항목에 어느 관점을 왜 택했는지 짧은 근거를 붙여라. 디자인·실무가 이 방안을 그대로 따를 것이다.`;
  const synth = (await callBest(synthSys, `업무: ${task}\n\n[회의록]\n${minutes(transcript)}${refBlock}`, { effort: 'medium', maxTokens: 900 })) || pick(pc, pg) || '핵심 항목 위주로 간결히 작성.';
  record('lead', `두 관점 종합했어요 👑 최종 방안입니다.\n${synth}`);

  // 3) 디자인 — 최종 방안을 문서 형식으로
  const designSys = `${CTX}\n너는 디자인/편집 담당이다. 위 최종 방안을 실제 문서로 만들 형식을 정하라: 문서 종류, 제목(예시), 항목 구성 순서, 말투, 분량. 실무가 이 뼈대를 그대로 채운다. 간결히.`;
  const design = (await callBest(designSys, `업무: ${task}\n\n[회의록]\n${minutes(transcript)}`, { effort: 'medium', maxTokens: 600 })) || '제목 → 인사/취지 → 항목별 안내 → 협조/유의사항 → 맺음말. 존댓말·간결체.';
  record('design', `문서 형식 잡았어요 🎨\n${design}`);

  // 4) 실무 — 회의록 전체를 반영해 완성 초안
  const workSys = `${CTX}\n너는 실무 작성 담당이다. 위 회의에서 팀이 합의한 '최종 방안'과 '문서 형식'을 그대로 반영해, 바로 제출 가능한 완성 초안을 작성하라. 회의 내용과 어긋나면 안 된다. 설명·머리말 없이 문서 본문만 출력.`;
  const draft = (await callBest(workSys, `업무: ${task}\n\n[회의록 전체]\n${minutes(transcript)}${refBlock}`, { effort: 'high', maxTokens: 2600 })) || '(초안 생성 실패)';
  emit({ type: 'turn', role: 'work', text: '회의 내용 그대로 반영해서 초안 완성했어요! 📄' });
  emit({ type: 'deliverable', title: task, body: draft });
  onDraft({ task, body: draft });

  // 5) 팀장 마무리
  record('lead', '팀 합의대로 잘 나왔어요. 고칠 곳 있으면 "더 정중하게", "분량 줄여줘"처럼 이어서 말씀하시면 팀이 그 초안을 바로 손볼게요 🌱');
}

// Claude 우선, 없으면 Gemini
async function callBest(system, user, opts) {
  try { const c = await ai.callClaude(system, user, opts); if (c != null) return c; }
  catch (e) { console.warn('[team] Claude 실패:', e.message); }
  try { const g = await ai.callGemini(system, user, opts); if (g != null) return g; }
  catch (e) { console.warn('[team] Gemini 실패:', e.message); }
  return null;
}

// ── 데모(키 없음) ──
async function mockMeeting(task, emit) {
  const steps = [
    ['lead', `"${task}" 업무 접수! (지금은 데모 모드 — API 키를 넣으면 진짜 AI가 이어서 협업해요)`],
    ['plan', '🔵 Claude·실용 관점(예시): 대상/목적/절차/준비물 4단으로 잡는 접근.'],
    ['plan', '🟢 Gemini·완성도 관점(예시): 핵심 메시지를 먼저 정하고 따뜻한 톤으로.'],
    ['lead', '두 관점 결합 → "실용 4단 + 따뜻한 톤"으로 종합(예시).'],
    ['design', '형식(예시): 가정통신문. 제목→인사→안내(항목)→협조요청→맺음말. 존댓말.'],
    ['work', '초안 완성(데모 텍스트)! 아래에서 확인하세요 📄'],
  ];
  for (const [role, text] of steps) { emit({ type: 'turn', role, text }); await sleep(650); }
  emit({ type: 'deliverable', title: task, body: `[데모 초안] "${task}"\n\n※ ANTHROPIC_API_KEY(+GEMINI_API_KEY)를 넣으면 팀이 회의록을 이어가며 진짜 초안을 만들고, "더 정중하게"처럼 수정도 이어서 됩니다.\n\n1. 대상: ...\n2. 목적: ...\n3. 일정: ...\n4. 준비물/협조사항: ...` });
  emit({ type: 'turn', role: 'lead', text: '데모 끝! 키를 넣으면 진짜로 협업해요 🌱' });
}

module.exports = { runMeeting };
