// 에이전트 팀장 — 진짜 연속성(agent loop + 자율 도구 사용)
// 팀장(Claude)이 전체 대화를 기억하며 매 스텝 다음 행동을 스스로 정한다:
//   업무 폴더 검색·열람 / 기획회의(Claude+Gemini) / 학사일정 조회 / 초안 저장·화면표시.
// 팀장이 주도하고, 도구가 실행될 때 기획·디자인·실무 캐릭터가 거든다(말풍선).

const ai = require('./ai');
const workfiles = require('./workfiles');
const schedule = require('./schedule');
const session = require('./session');
const confirm = require('./confirm');

const MAX_STEPS = 10;

const SYSTEM = `너는 '늘벗이', 세종늘벗학교(대안교육위탁기관) 신현종 선생님의 AI 팀장이야. 기획·디자인·실무 팀원과 함께 일해.
가장 중요한 원칙은 '연속성'이다: 이 대화에서 앞서 내린 결정·만든 초안을 기억하고 이어서 발전시켜라. 매 요청을 처음부터 새로 시작하지 마라.

너는 상황을 스스로 판단해 아래 도구를 자율적으로 쓴다:
- search_files: 업무 폴더에서 파일명으로 기존 문서를 검색. 문서 작업 전, 참고할 작년/유사 자료가 있으면 먼저 찾아봐라.
- read_document: 찾은 문서(PDF/텍스트)의 실제 내용을 읽어 형식·톤을 참고.
- consult_planners: 방향이 중요하거나 애매하면 '실용 관점'과 '완성도 관점' 두 갈래로 기획 회의를 연다.
- get_schedule: 학사일정(오늘/이번주/다가오는/마감) 확인.
- present_deliverable: 완성한 문서를 사용자 화면(산출물 패널)에 띄운다. 문서를 완성하면 반드시 호출.
- save_draft: 완성 초안을 업무 폴더에 .txt 로 저장(사용자가 원하거나 확정되면).
- create_pptx: 발표자료를 요청받으면 슬라이드 구성을 짜서 이 도구로 '진짜 파워포인트(.pptx) 파일'을 만들어 업무 폴더에 저장한다. (텍스트 구성안만 주지 말고 실제 파일을 만들어라.)
- copy_file: 업무 폴더 안에서 파일/폴더 복사(원본 보존). **파일 정리·모으기의 기본은 복사다.** create_folder: 새 폴더 만들기.
- move_file: 이름변경·이동(원본이 사라짐). 사용자가 "이동/옮겨/이름 바꿔"처럼 명시할 때만 쓴다.
- edit_file: 텍스트(.txt/.md 등) 파일 내용 수정(원본은 자동 백업됨). delete_to_trash: 파일을 늘벗이_휴지통으로 이동(진짜 삭제 아님).

⚠️ 파일을 바꾸는 도구(move_file/edit_file/delete_to_trash)는 실행 전 사용자에게 자동으로 승인창이 떠서, 승인해야만 실제로 바뀐다. 그러니 자신 있게 제안하되, 한 번에 너무 많이 바꾸지 말고 명확한 것만. 사용자가 거부하면 존중하고 다른 방법을 제안하라.

문서를 만드는 흐름(스스로 판단해 밟아라): 관련자료 검색·열람 → (필요시) 기획회의 → 작성 → present_deliverable → (원하면) save_draft.
수정 요청이면 이전 초안을 이어서 고치고 다시 present_deliverable 한다. 완전히 새로 쓰지 마라.
파일 정리·모으기 요청이면 **기본은 복사(copy_file, 원본 보존)** 다. 원본을 없애는 이동(move_file)은 사용자가 "이동/옮겨"라고 분명히 말할 때만 쓴다. 무엇을 어떻게 할지 먼저 짧게 말하고 도구를 호출하라(승인은 자동으로 사용자가 함).

규칙: 학생 이름은 반드시 'OO'. 연도는 '2026학년도'. 산출물은 한국 학교 행정 문서 형식으로 바로 제출 가능하게.
말투: 팀장답게 짧고 다정하게. 긴 설명보다 행동으로. 사용자에게 하는 말은 1~2문장.`;

const TOOLS = [
  {
    name: 'search_files',
    description: '업무 폴더에서 파일명으로 문서를 검색한다. 참고할 기존 문서(작년 계획안 등)를 찾을 때 사용.',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: '검색어(파일명 일부)' } }, required: ['query'] },
  },
  {
    name: 'read_document',
    description: '업무 폴더의 문서(PDF/텍스트) 내용을 읽는다. search_files 로 찾은 path 를 넣는다.',
    input_schema: { type: 'object', properties: { path: { type: 'string', description: '업무 폴더 기준 상대경로' } }, required: ['path'] },
  },
  {
    name: 'consult_planners',
    description: '기획 회의: 같은 주제를 실용 관점(Claude)과 완성도·톤 관점(Gemini)으로 각각 상의해 두 의견을 받는다.',
    input_schema: { type: 'object', properties: { question: { type: 'string', description: '상의할 주제/질문' } }, required: ['question'] },
  },
  {
    name: 'get_schedule',
    description: '학사일정을 조회한다. scope: today|week|upcoming|deadlines',
    input_schema: { type: 'object', properties: { scope: { type: 'string', enum: ['today', 'week', 'upcoming', 'deadlines'] } }, required: ['scope'] },
  },
  {
    name: 'present_deliverable',
    description: '완성한 문서를 사용자 화면(산출물 패널)에 보여준다. 문서 본문 전체를 body 에 넣는다.',
    input_schema: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' } }, required: ['title', 'body'] },
  },
  {
    name: 'save_draft',
    description: '완성 초안을 업무 폴더(늘벗이_산출물)에 .txt 로 저장한다.',
    input_schema: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' } }, required: ['title', 'body'] },
  },
  {
    name: 'create_pptx',
    description: '슬라이드 구성을 실제 파워포인트(.pptx) 파일로 만들어 업무 폴더에 저장한다. 발표자료 요청 시 사용. 첫 슬라이드는 자동 표지가 붙으므로 본문 슬라이드들만 넣어라.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '발표자료 제목(파일명 겸 표지)' },
        slides: {
          type: 'array',
          description: '본문 슬라이드 배열',
          items: { type: 'object', properties: { title: { type: 'string', description: '슬라이드 제목' }, bullets: { type: 'array', items: { type: 'string' }, description: '불릿 항목들' } }, required: ['title', 'bullets'] },
        },
      },
      required: ['title', 'slides'],
    },
  },
  {
    name: 'copy_file',
    description: '업무 폴더 안에서 파일/폴더를 복사한다(원본은 그대로 둠). 파일 정리·모으기의 기본 동작. to 가 기존 폴더면 그 안으로 복사. 실행 전 사용자 승인 필요.',
    input_schema: { type: 'object', properties: { from: { type: 'string', description: '원본 상대경로' }, to: { type: 'string', description: '복사할 경로(새 이름) 또는 대상 폴더' } }, required: ['from', 'to'] },
  },
  {
    name: 'move_file',
    description: '업무 폴더 안에서 파일/폴더를 이름변경하거나 다른 폴더로 옮긴다(원본이 사라짐). 사용자가 "이동/옮겨"라고 명시할 때만 사용. to 가 기존 폴더면 그 안으로 이동. 실행 전 사용자 승인 필요.',
    input_schema: { type: 'object', properties: { from: { type: 'string', description: '원본 상대경로' }, to: { type: 'string', description: '새 경로(이름변경) 또는 대상 폴더' } }, required: ['from', 'to'] },
  },
  {
    name: 'create_folder',
    description: '업무 폴더 안에 새 폴더를 만든다.',
    input_schema: { type: 'object', properties: { path: { type: 'string', description: '만들 폴더 상대경로' } }, required: ['path'] },
  },
  {
    name: 'edit_file',
    description: '텍스트 파일(.txt/.md/.csv 등)의 내용을 새 내용으로 바꾼다(원본 자동 백업). 실행 전 사용자 승인 필요. HWP/PDF는 불가.',
    input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string', description: '파일 전체 새 내용' } }, required: ['path', 'content'] },
  },
  {
    name: 'delete_to_trash',
    description: '파일을 늘벗이_휴지통 폴더로 옮긴다(진짜 삭제 아님, 복구 가능). 실행 전 사용자 승인 필요.',
    input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
];

// 도구 실행 — emit 으로 캐릭터가 거든다. store=세션, folder=그 선생님 업무 폴더(없으면 null).
async function execTool(name, input, emit, store, folder) {
  try {
    if ((name === 'search_files' || name === 'read_document') && !folder)
      return '설정된 업무 폴더가 없어요. (사용자가 폴더를 지정했거나 파일을 직접 올려야 열람 가능)';
    if (name === 'search_files') {
      emit({ type: 'turn', role: 'work', text: `📂 "${input.query}" 관련 문서 찾아볼게요…` });
      const all = workfiles.listFiles(folder).files || [];
      const q = String(input.query || '').toLowerCase();
      const hits = all.filter((f) => f.type === 'file' && f.readable && f.path.toLowerCase().includes(q)).slice(0, 20);
      if (!hits.length) return `검색 결과 없음. (참고 가능한 PDF/텍스트 중 "${input.query}" 파일명 매치 없음)`;
      emit({ type: 'turn', role: 'work', text: `${hits.length}개 찾았어요.` });
      return '검색 결과(참고 가능 파일):\n' + hits.map((f) => `- ${f.path}`).join('\n');
    }
    if (name === 'read_document') {
      const r = await workfiles.readText(folder, input.path, { maxChars: 6000 });
      emit({ type: 'turn', role: 'work', text: `📄 "${r.name}" 열어봤어요.` });
      return `[${r.name} 내용]\n${r.text}`;
    }
    if (name === 'consult_planners') {
      emit({ type: 'turn', role: 'plan', text: `📋 두 관점으로 상의할게요: ${input.question}` });
      const sysC = `너는 세종늘벗학교 기획 담당(실용·정확성 관점). 질문에 대해 실무자가 바로 쓸 구체적 방안을 3~5개 불릿으로.`;
      const sysG = `너는 세종늘벗학교 기획 담당(완성도·톤·독자경험 관점). 받는 사람 입장에서 핵심 메시지·어조 관점의 방안을 3~5개 불릿으로.`;
      const [c, g] = await Promise.all([
        ai.callClaude(sysC, input.question, { effort: 'medium', maxTokens: 500 }).catch((e) => `(오류: ${e.message})`),
        ai.callGemini(sysG, input.question, { maxTokens: 700 }).catch((e) => `(오류: ${e.message})`),
      ]);
      if (c != null) emit({ type: 'turn', role: 'plan', text: `🔵 실용 관점\n${c}` });
      if (g != null) emit({ type: 'turn', role: 'design', text: `🟢 완성도 관점\n${g}` });
      return `[실용 관점]\n${c ?? '(없음)'}\n\n[완성도 관점]\n${g ?? '(없음)'}`;
    }
    if (name === 'get_schedule') {
      const today = schedule.fmt(new Date());
      const s = input.scope;
      if (s === 'today') return JSON.stringify(schedule.eventsOn(today));
      if (s === 'week') return JSON.stringify(schedule.thisWeek(today));
      if (s === 'deadlines') return JSON.stringify(schedule.deadlines(today, 6));
      return JSON.stringify(schedule.upcoming(today, 8));
    }
    if (name === 'present_deliverable') {
      store.setDraft({ task: input.title, body: input.body });
      emit({ type: 'turn', role: 'work', text: '초안 완성했어요! 아래에서 확인하세요 📄' });
      emit({ type: 'deliverable', title: input.title, body: input.body });
      return '사용자 화면에 표시 완료.';
    }
    if (name === 'save_draft') {
      const out = workfiles.saveDeliverable(folder, input.title, input.body, 'txt');
      store.setDraft({ task: input.title, body: input.body });
      emit({ type: 'turn', role: 'work', text: `💾 저장했어요: ${out.rel}` });
      emit({ type: 'deliverable', title: input.title, body: input.body, file: out.rel });
      return `저장 완료: ${out.rel} (사용자가 화면에서 다운로드 가능).`;
    }
    if (name === 'create_pptx') {
      emit({ type: 'turn', role: 'design', text: '🎨 슬라이드로 디자인하는 중…' });
      const out = await workfiles.savePptx(folder, input.title, input.slides || []);
      const preview = workfiles.slidesToText(input.title, input.slides || []);
      store.setDraft({ task: input.title, body: preview });
      emit({ type: 'turn', role: 'work', text: `📊 파워포인트(${out.slideCount + 1}장) 완성!` });
      emit({ type: 'deliverable', title: input.title + ' (PPTX)', body: `✅ 파워포인트 ${out.slideCount + 1}장 완성!\n아래 "다운로드"로 받으세요.\n\n─ 슬라이드 구성 ─\n${preview}`, file: out.rel });
      return `PPT 저장 완료: ${out.rel} (표지 포함 ${out.slideCount + 1}장). 사용자가 화면에서 다운로드 가능.`;
    }

    // ── 파일 변경(승인 필요) ──
    if (name === 'copy_file') {
      if (!folder) return '설정된 업무 폴더가 없어요.';
      const ok = await confirm.request(emit, `📑 "${input.from}" → "${input.to}" 로 복사할까요? (원본은 그대로 둬요)`);
      if (ok !== 'approve') return '사용자가 거부했어요. 실행하지 않음.';
      const r = workfiles.copyFile(folder, input.from, input.to);
      emit({ type: 'turn', role: 'work', text: `✅ 복사했어요: ${r.rel} (원본 유지)` });
      return `복사 완료: ${r.rel} (원본 보존)`;
    }
    if (name === 'move_file') {
      if (!folder) return '설정된 업무 폴더가 없어요.';
      const ok = await confirm.request(emit, `📁 "${input.from}" → "${input.to}" 로 옮길까요? (원본이 사라져요)`);
      if (ok !== 'approve') return '사용자가 거부했어요. 실행하지 않음.';
      const r = workfiles.moveFile(folder, input.from, input.to);
      emit({ type: 'turn', role: 'work', text: `✅ 옮겼어요: ${r.rel}` });
      return `이동 완료: ${r.rel}`;
    }
    if (name === 'create_folder') {
      if (!folder) return '설정된 업무 폴더가 없어요.';
      const r = workfiles.createFolder(folder, input.path);
      emit({ type: 'turn', role: 'work', text: `📂 폴더 만들었어요: ${r.rel}` });
      return `폴더 생성: ${r.rel}`;
    }
    if (name === 'edit_file') {
      if (!folder) return '설정된 업무 폴더가 없어요.';
      const ok = await confirm.request(emit, `✏️ "${input.path}" 내용을 수정할까요? (원본은 자동 백업)`);
      if (ok !== 'approve') return '사용자가 거부했어요. 실행하지 않음.';
      const r = workfiles.editTextFile(folder, input.path, input.content);
      emit({ type: 'turn', role: 'work', text: `✅ 수정했어요: ${input.path}${r.backedUp ? ` (원본 백업: ${r.backedUp})` : ''}` });
      return `수정 완료: ${input.path}${r.backedUp ? ` / 원본 백업: ${r.backedUp}` : ''}`;
    }
    if (name === 'delete_to_trash') {
      if (!folder) return '설정된 업무 폴더가 없어요.';
      const ok = await confirm.request(emit, `🗑️ "${input.path}" 를 휴지통(늘벗이_휴지통)으로 옮길까요?`);
      if (ok !== 'approve') return '사용자가 거부했어요. 실행하지 않음.';
      const r = workfiles.deleteToTrash(folder, input.path);
      emit({ type: 'turn', role: 'work', text: `🗑️ 휴지통으로 옮겼어요: ${r.rel} (복구 가능)` });
      return `휴지통 이동 완료: ${r.rel}`;
    }
    return `알 수 없는 도구: ${name}`;
  } catch (e) {
    return `도구 오류(${name}): ${e.message}`;
  }
}

const FILE_TOOLS = ['search_files', 'read_document', 'copy_file', 'move_file', 'create_folder', 'edit_file', 'delete_to_trash'];

// 에이전트 실행 (한 번의 사용자 요청 → end_turn 까지 루프). opts.store=세션, opts.folder=업무폴더(null이면 폴더도구 제외).
async function run(userText, emit, opts = {}) {
  const store = opts.store || session.get('default');
  const folder = opts.folder || null;
  const prov = ai.provider();
  // 제공자(Anthropic/OpenRouter)가 바뀌면 대화 형식이 달라 초기화
  if (store._provider && store._provider !== prov) store.agentMessages = [];
  store._provider = prov;
  const tools = folder ? TOOLS : TOOLS.filter((t) => !FILE_TOOLS.includes(t.name));
  // 온보딩에서 확인한 '내 업무 범위' + 폴더 개요를 시스템에 심어 팀장이 알고 시작
  let system = SYSTEM;
  if (store.workProfile) system += `\n\n[담당 선생님이 확인한 업무 범위 — 이 사람의 실제 업무다]\n${store.workProfile}\n(이 범위를 기억하고, 관련해 먼저 도와드려라.)`;
  if (store.folderOverview) system += `\n\n[현재 업무 폴더 개요 — 이미 파악한 내용]\n${store.folderOverview}\n(구체적 문서가 필요하면 search_files/read_document 로 찾아 읽어라.)`;
  const messages = store.agentMessages; // 참조(누적 = 연속성)
  const refBlock = opts.refText ? `\n\n[선생님이 첨부한 참고 문서: ${opts.refName}]\n${String(opts.refText).slice(0, 6000)}` : '';
  const nudge = opts.mode === 'doc' ? '\n(이건 문서 작업 요청이야. 필요하면 자료를 찾아보고, 완성하면 present_deliverable 로 보여줘.)' : '';
  messages.push({ role: 'user', content: userText + nudge + refBlock });

  if (prov === 'openrouter') { await runOR(emit, { store, folder, tools, system }); store._trim(); return; }

  for (let step = 0; step < MAX_STEPS; step++) {
    let res;
    try {
      res = await ai.claudeAgent({ system, messages, tools, maxTokens: 4096, effort: 'medium' });
    } catch (e) {
      emit({ type: 'turn', role: 'lead', text: '앗, 처리 중 문제가 생겼어요: ' + e.message });
      return;
    }
    // 팀장이 하는 말(text 블록) 표시
    for (const b of res.content) {
      if (b.type === 'text' && b.text.trim()) emit({ type: 'turn', role: 'lead', text: b.text.trim() });
    }
    messages.push({ role: 'assistant', content: res.content });

    if (res.stop_reason !== 'tool_use') break; // 끝

    // 도구 실행 → 결과 회신
    const toolResults = [];
    for (const b of res.content) {
      if (b.type !== 'tool_use') continue;
      const result = await execTool(b.name, b.input, emit, store, folder);
      toolResults.push({ type: 'tool_result', tool_use_id: b.id, content: String(result) });
    }
    messages.push({ role: 'user', content: toolResults });

    if (step === MAX_STEPS - 1) emit({ type: 'turn', role: 'lead', text: '(작업이 길어져 여기서 멈출게요. 이어서 말씀해주세요!)' });
  }
  store._trim();
}

// OpenRouter(OpenAI 호환) 에이전트 루프 — 도구를 function 형식으로 변환해 사용.
async function runOR(emit, { store, folder, tools, system }) {
  const messages = store.agentMessages; // OpenAI 형식(role/content, tool_calls, tool)
  const orTools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
  for (let step = 0; step < MAX_STEPS; step++) {
    let j;
    try {
      j = await ai.orChat([{ role: 'system', content: system }, ...messages], { maxTokens: 4096, tools: orTools });
    } catch (e) {
      emit({ type: 'turn', role: 'lead', text: '앗, 처리 중 문제가 생겼어요(OpenRouter): ' + e.message });
      return;
    }
    const msg = j.choices?.[0]?.message;
    if (!msg) { emit({ type: 'turn', role: 'lead', text: 'OpenRouter 응답이 비었어요.' }); return; }
    if (msg.content && String(msg.content).trim()) emit({ type: 'turn', role: 'lead', text: String(msg.content).trim() });
    const calls = msg.tool_calls || [];
    messages.push(calls.length ? { role: 'assistant', content: msg.content ?? null, tool_calls: calls } : { role: 'assistant', content: msg.content || '' });
    if (!calls.length) break;
    for (const call of calls) {
      let input = {};
      try { input = JSON.parse(call.function?.arguments || '{}'); } catch {}
      const result = await execTool(call.function?.name, input, emit, store, folder);
      messages.push({ role: 'tool', tool_call_id: call.id, content: String(result) });
    }
    if (step === MAX_STEPS - 1) emit({ type: 'turn', role: 'lead', text: '(작업이 길어져 여기서 멈출게요. 이어서 말씀해주세요!)' });
  }
}

module.exports = { run };
