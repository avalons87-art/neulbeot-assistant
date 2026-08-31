// 공용 AI 호출 모듈 — Claude(Anthropic) + Gemini(Google)
// 키 우선순위: 개인 키(keys.json, 화면에서 입력) > 공유 키(env/my-keys.bat).
// 개인 키를 넣으면 실행 중에도 바로 그 키로 바뀐다(재시작 불필요).

const fs = require('fs');
const path = require('path');

const KEYS_FILE = path.join(__dirname, '..', 'keys.json');
const CLAUDE_MODEL = process.env.MODEL || 'claude-opus-4-8';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

let Anthropic = null;
try { Anthropic = require('@anthropic-ai/sdk'); }
catch (e) { console.warn('[ai] @anthropic-ai/sdk 로드 실패:', e.message); }

function loadPersonal() { try { return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8')); } catch { return {}; } }
function savePersonal(o) { try { fs.writeFileSync(KEYS_FILE, JSON.stringify(o, null, 2), 'utf8'); } catch (e) { console.warn('[ai] keys.json 저장 실패:', e.message); } }
let personal = loadPersonal();

// 키 정리: 앞뒤 공백 + 눈에 안 보이는 문자(제로폭·BOM·비분리공백) 제거 → 헤더 오류 예방.
function cleanKey(s) { return String(s || '').replace(/[​-‍﻿ ]/g, '').trim(); }
// 보이는 비ASCII 문자(예: '•')가 있으면 친절히 안내(자동 제거는 위험하니 알려서 다시 복사하게).
function assertAsciiKey(key, label) {
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    if (c < 32 || c > 126) throw new Error(`${label} 키에 허용되지 않는 문자가 섞여 있어요(${i + 1}번째 글자 '${key[i]}'). 키를 새로 복사해 붙여넣어 주세요 — 가려진 표시(••••)나 서식 있는 화면에서 복사하면 특수문자가 딸려올 수 있어요.`);
  }
  return key;
}
function anthropicKey() { return cleanKey(personal.anthropic || process.env.ANTHROPIC_API_KEY); }
function geminiKey() { return cleanKey(personal.gemini || process.env.GEMINI_API_KEY); }
function openrouterKey() { return cleanKey(personal.openrouter || process.env.OPENROUTER_API_KEY); }
function openrouterModel() { return cleanKey(personal.openrouterModel || process.env.OPENROUTER_MODEL); }

// 어느 제공자로 Claude 역할(팀장/에이전트/파싱)을 처리할지: OpenRouter 키가 있으면 그걸 우선.
function provider() {
  if (openrouterKey() && openrouterModel() && !personal.openrouterOff) return 'openrouter';
  if (anthropicKey() && Anthropic) return 'anthropic';
  return 'none';
}
// OpenRouter를 켜기/끄기(키는 지우지 않고 보존 — 껐다 켰다 전환)
function setOpenRouterEnabled(on) {
  if (on) delete personal.openrouterOff; else personal.openrouterOff = true;
  savePersonal(personal); client = null; clientKey = null;
}

// OpenRouter(OpenAI 호환) 원본 호출. messages=OpenAI 형식. 반환: 응답 JSON.
async function orChat(messages, opts = {}) {
  const key = openrouterKey(); const model = opts.model || openrouterModel();
  if (!key) throw new Error('OpenRouter 키 없음');
  if (!model) throw new Error('OpenRouter 모델이 설정되지 않았어요(🔑에서 모델 입력).');
  const body = { model, messages, max_tokens: opts.maxTokens || 1000 };
  if (opts.tools) { body.tools = opts.tools; body.tool_choice = 'auto'; }
  if (opts.jsonMode) body.response_format = { type: 'json_object' };
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'X-Title': 'Neulbeot' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`OpenRouter ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
// OpenRouter로 단순 텍스트 답변
async function orText(system, user, opts = {}) {
  const msgs = [{ role: 'system', content: system }, ...(opts.history || []), { role: 'user', content: user }];
  const j = await orChat(msgs, { maxTokens: opts.maxTokens || 800, jsonMode: opts.jsonMode });
  return (j.choices?.[0]?.message?.content || '').trim();
}

// Anthropic 클라이언트를 현재 키로 (키 바뀌면 재생성)
let client = null, clientKey = null;
function getClient() {
  const k = anthropicKey();
  if (!k || !Anthropic) return null;
  if (client && clientKey === k) return client;
  client = new Anthropic({ apiKey: k }); clientKey = k;
  return client;
}

async function callClaude(system, user, opts = {}) {
  if (provider() === 'openrouter') { try { return await orText(system, user, opts); } catch (e) { console.warn('[ai] OpenRouter 실패:', e.message); throw e; } }
  const c = getClient(); if (!c) return null;
  const history = Array.isArray(opts.history) ? opts.history : [];
  const res = await c.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: opts.maxTokens || 600,
    output_config: { effort: opts.effort || 'medium' },
    system,
    messages: [...history, { role: 'user', content: user }],
  });
  return (res.content.find((b) => b.type === 'text')?.text || '').trim();
}

// 학사일정 텍스트 → 구조화된 일정 배열([{date,end?,title,tag}]). 구조화 출력으로 안정적 파싱.
const SCHED_SCHEMA = {
  type: 'object',
  properties: {
    events: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string', description: '시작일 YYYY-MM-DD' },
          end: { type: 'string', description: '종료일 YYYY-MM-DD (기간일 때만)' },
          title: { type: 'string' },
          tag: { type: 'string', description: '행사/마감/휴업/상담/수업/연수/준비/자치/행정/일정 중 하나' },
        },
        required: ['date', 'title', 'tag'],
        additionalProperties: false,
      },
    },
  },
  required: ['events'],
  additionalProperties: false,
};
async function extractSchedule(text, opts = {}) {
  const year = opts.year || '2026';
  const sys = `너는 학사일정 파서다. 주어진 텍스트에서 학교 일정을 빠짐없이 뽑아 구조화한다.
- 날짜는 반드시 YYYY-MM-DD. 연도가 없으면 ${year}(학년도 기준: 1~2월은 다음해)로 추정.
- 여러 날 걸치는 일정은 end 로 종료일을 넣는다(하루면 생략).
- tag 는 행사/마감/휴업/상담/수업/연수/준비/자치/행정/일정 중 가장 맞는 것.
- 표·목록 형태여도 최대한 다 뽑되, 날짜가 불명확한 건 버린다.`;
  const user = '학사일정 텍스트:\n' + String(text).slice(0, 14000);
  // OpenRouter: JSON 모드로 파싱
  if (provider() === 'openrouter') {
    const t = await orText(sys + '\n반드시 {"events":[{"date","end","title","tag"}, ...]} JSON만 출력.', user, { maxTokens: 8000, jsonMode: true });
    const m = t.match(/\{[\s\S]*\}/); if (!m) return [];
    try { return (JSON.parse(m[0]).events) || []; } catch { return []; }
  }
  const c = getClient(); if (!c) return null;
  // 1) 구조화 출력(권장)
  try {
    const res = await c.messages.create({
      model: CLAUDE_MODEL, max_tokens: 8000,
      output_config: { format: { type: 'json_schema', schema: SCHED_SCHEMA } },
      system: sys, messages: [{ role: 'user', content: user }],
    });
    const t = res.content.find((b) => b.type === 'text')?.text || '{}';
    const ev = (JSON.parse(t).events) || [];
    if (ev.length) return ev;
  } catch (e) { console.warn('[ai] 구조화 일정파싱 실패, 폴백:', e.message); }
  // 2) 폴백: 일반 호출 + JSON 추출
  const res2 = await c.messages.create({
    model: CLAUDE_MODEL, max_tokens: 8000,
    system: sys + '\n반드시 {"events":[{"date","end","title","tag"}, ...]} 형태의 JSON만 출력하라. 다른 말 금지.',
    messages: [{ role: 'user', content: user }],
  });
  const t2 = res2.content.find((b) => b.type === 'text')?.text || '';
  const m = t2.match(/\{[\s\S]*\}/);
  if (!m) return [];
  try { return (JSON.parse(m[0]).events) || []; } catch { return []; }
}

// 프롬프트 캐싱 — 매 스텝 다시 보내는 앞부분(도구+시스템, 그리고 누적 대화)을 캐시해 비용 절감.
//   시스템 블록에 cache_control → 도구+시스템 프리픽스 캐시(가장 큰 고정분).
//   마지막 메시지 끝에 cache_control(요청 시점에만, 원본 messages 는 안 건드림) → 누적 대화 재사용.
function withCacheBreakpoint(messages) {
  if (!messages || !messages.length) return messages;
  const out = messages.slice();
  const last = out[out.length - 1];
  let content = last.content;
  if (typeof content === 'string') content = [{ type: 'text', text: content }];
  else if (Array.isArray(content)) content = content.map((b) => ({ ...b }));
  else return messages;
  if (content.length) content[content.length - 1] = { ...content[content.length - 1], cache_control: { type: 'ephemeral' } };
  out[out.length - 1] = { ...last, content };
  return out;
}
async function claudeAgent({ system, messages, tools, maxTokens = 4096, effort = 'medium' }) {
  const c = getClient(); if (!c) return null;
  const sys = typeof system === 'string' ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] : system;
  const res = await c.messages.create({ model: CLAUDE_MODEL, max_tokens: maxTokens, output_config: { effort }, system: sys, tools, messages: withCacheBreakpoint(messages) });
  const u = res.usage || {};
  if (process.env.NB_LOG_CACHE === '1')
    console.log(`[cache] read=${u.cache_read_input_tokens || 0} write=${u.cache_creation_input_tokens || 0} in=${u.input_tokens || 0}`);
  return res;
}

async function callGemini(system, user, opts = {}) {
  // OpenRouter를 쓰는 설치에선 '완성도 관점'도 OpenRouter 모델로 처리
  if (provider() === 'openrouter') { try { return await orText(system, user, opts); } catch (e) { console.warn('[ai] OpenRouter(gemini역할) 실패:', e.message); return null; } }
  const key = geminiKey(); if (!key) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;
  const base = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
  };
  const maxTok = opts.maxTokens || 800;
  const attempts = [
    { maxOutputTokens: maxTok, temperature: 0.7, thinkingConfig: { thinkingBudget: 0 } },
    { maxOutputTokens: maxTok + 2500, temperature: 0.7 },
  ];
  let lastErr = 'unknown';
  for (const gc of attempts) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...base, generationConfig: gc }) });
    if (r.ok) {
      const j = await r.json();
      const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
      if (text) return text;
      lastErr = `빈 응답(finish=${j.candidates?.[0]?.finishReason})`;
      continue;
    }
    lastErr = `${r.status}: ${(await r.text()).slice(0, 150)}`;
    if (r.status !== 400) break;
  }
  throw new Error(`Gemini ${lastErr}`);
}

// 손글씨/이미지 → 텍스트(OCR). 비용상 Gemini 우선(무료등급·한글 손글씨 강함), 없으면 Claude, 그다음 OpenRouter.
const OCR_INSTRUCTION = `이 이미지는 학생이 손으로 쓴 글(수행평가 답안 등)입니다.
- 보이는 내용을 그대로 텍스트로 옮겨 적으세요. 맞춤법·오탈자는 고치지 말고 쓴 그대로.
- 표는 표 형태를 최대한 유지(간단한 줄/칸 구분).
- 알아보기 힘든 글자는 [?] 로 표시.
- 학생 이름이 보이면 이름은 'OO'로 가리세요(개인정보 보호).
- 옮긴 내용만 출력하고, 설명이나 머리말은 붙이지 마세요.`;
async function transcribeImage(imageB64, mediaType = 'image/jpeg', opts = {}) {
  const instruction = opts.instruction || OCR_INSTRUCTION;
  const maxTokens = opts.maxTokens || 2500;
  // 1) Gemini (저렴)
  if (geminiKey()) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${geminiKey()}`;
      const body = { contents: [{ role: 'user', parts: [{ inlineData: { mimeType: mediaType, data: imageB64 } }, { text: instruction }] }], generationConfig: { maxOutputTokens: maxTokens, temperature: 0 } };
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (r.ok) {
        const j = await r.json();
        const t = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
        if (t) return { text: t, model: 'gemini' };
      } else { console.warn('[ai] Gemini OCR', r.status, (await r.text()).slice(0, 120)); }
    } catch (e) { console.warn('[ai] Gemini OCR 실패:', e.message); }
  }
  // 2) Claude 비전
  const c = getClient();
  if (c) {
    const res = await c.messages.create({
      model: CLAUDE_MODEL, max_tokens: maxTokens,
      messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mediaType, data: imageB64 } }, { type: 'text', text: instruction }] }],
    });
    return { text: (res.content.find((b) => b.type === 'text')?.text || '').trim(), model: 'claude' };
  }
  // 3) OpenRouter 비전
  if (openrouterKey() && openrouterModel()) {
    const j = await orChat([{ role: 'user', content: [{ type: 'text', text: instruction }, { type: 'image_url', image_url: { url: `data:${mediaType};base64,${imageB64}` } }] }], { maxTokens });
    return { text: (j.choices?.[0]?.message?.content || '').trim(), model: 'openrouter' };
  }
  throw new Error('이미지를 읽을 AI 키가 없어요. Gemini 또는 Claude 키를 넣어주세요(🔑).');
}

// 주어진 키가 실제로 유효한지 소량 호출로 테스트(저장 전 검증). 성공=true, 실패=throw.
async function testAnthropicKey(key) {
  if (!Anthropic) throw new Error('SDK가 없어요');
  const k = assertAsciiKey(cleanKey(key), 'Claude');
  const c = new Anthropic({ apiKey: k });
  await c.messages.create({ model: CLAUDE_MODEL, max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] });
  return true;
}
async function testGeminiKey(key) {
  const k = assertAsciiKey(cleanKey(key), 'Gemini');
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}?key=${encodeURIComponent(k)}`);
  if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 100)}`);
  return true;
}
async function testOpenRouterKey(key, model) {
  const k = assertAsciiKey(cleanKey(key), 'OpenRouter');
  const m = cleanKey(model);
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + k, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: m, messages: [{ role: 'user', content: 'hi' }], max_tokens: 5 }),
  });
  if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 150)}`);
  return true;
}

// 개인 키 설정/해제. patch: {anthropic?, gemini?, openrouter?, openrouterModel?} — ''이면 해제.
function setKeys(patch = {}) {
  const next = { ...personal };
  for (const k of ['anthropic', 'gemini', 'openrouter', 'openrouterModel']) {
    if (patch[k] !== undefined) { const v = cleanKey(patch[k]); if (v) next[k] = v; else delete next[k]; }
  }
  // OpenRouter 키를 새로 넣으면 자동으로 켜짐 상태로
  if (patch.openrouter && cleanKey(patch.openrouter)) delete next.openrouterOff;
  personal = next; savePersonal(personal);
  client = null; clientKey = null;
}

function status() {
  const p = provider();
  return {
    claude: p !== 'none',              // Claude 역할(팀장/에이전트)이 가능한가
    gemini: !!geminiKey() || p === 'openrouter',
    claudeModel: p === 'openrouter' ? openrouterModel() : CLAUDE_MODEL,
    geminiModel: GEMINI_MODEL,
    provider: p,
    usingPersonal: !!personal.anthropic,
    usingPersonalGemini: !!personal.gemini,
    usingOpenRouter: p === 'openrouter',
    openrouterModel: openrouterModel() || null,
    openrouterStored: !!(openrouterKey() && openrouterModel()), // 키가 저장돼 있는가(끔 상태 포함)
    openrouterOff: !!personal.openrouterOff,                     // 저장돼 있지만 꺼둔 상태인가
    sharedAvailable: !!process.env.ANTHROPIC_API_KEY,
  };
}

module.exports = { callClaude, callGemini, claudeAgent, extractSchedule, transcribeImage, orChat, provider, openrouterModel, testAnthropicKey, testGeminiKey, testOpenRouterKey, setKeys, setOpenRouterEnabled, status, CLAUDE_MODEL, GEMINI_MODEL };
