// 다중 사용자 세션 기억 — 선생님(uid)별로 대화·초안을 분리해서 보관.
// 중앙 서버 1대를 여러 선생님이 동시에 써도 서로 섞이지 않게 한다.
//   agentMessages: 그 선생님의 에이전트 대화 전체(Claude 메시지 배열, tool 블록 포함)
//   draft: 그 선생님의 최근 산출물 {task, body}

function makeStore() {
  return {
    agentMessages: [],
    draft: null,
    uploadedRef: null, // {name, text} — 브라우저로 올린 참고 문서
    folderOverview: null, // 업무 폴더 자동 분석 개요(팀장이 폴더를 알고 시작)
    lastSeen: Date.now(),
    recordExchange(userMsg, aiMsg) {
      this.agentMessages.push({ role: 'user', content: userMsg });
      if (aiMsg) this.agentMessages.push({ role: 'assistant', content: aiMsg });
      this._trim();
    },
    setDraft(d) { this.draft = d; },
    reset() { this.agentMessages = []; this.draft = null; this.uploadedRef = null; },
    _trim(maxMsgs = 40) {
      if (this.agentMessages.length <= maxMsgs) return;
      let cut = this.agentMessages.length - maxMsgs;
      while (cut < this.agentMessages.length && this.agentMessages[cut].role !== 'user') cut++;
      this.agentMessages = this.agentMessages.slice(cut);
    },
  };
}

const stores = new Map();

// uid(선생님 식별자)별 저장소 반환(없으면 생성). uid 없으면 'default'.
function get(uid) {
  const key = (uid && String(uid).slice(0, 60)) || 'default';
  let s = stores.get(key);
  if (!s) { s = makeStore(); stores.set(key, s); }
  s.lastSeen = Date.now();
  // 오래 안 쓴 세션 정리(메모리 보호): 12시간 초과 + 100개 넘으면 오래된 것 제거
  if (stores.size > 100) {
    const cutoff = Date.now() - 12 * 3600 * 1000;
    for (const [k, v] of stores) if (k !== key && v.lastSeen < cutoff) stores.delete(k);
  }
  return s;
}

function count() { return stores.size; }

module.exports = { get, count };
