// 승인 다리 — 에이전트가 파일을 바꾸기 전, 사용자에게 승인/거부를 받고 그때까지 대기.
//   request(): confirm 이벤트를 화면에 보내고, 사용자가 응답할 때까지 기다리는 Promise 반환.
//   respond(): /api/confirm 이 호출 → 대기 중인 Promise 를 풀어 에이전트 재개.

const pending = new Map();
let seq = 0;

// emit: SSE 전송 함수. description: 사용자에게 보여줄 설명. 반환: 'approve' | 'reject'
function request(emit, description) {
  const id = `cf${Date.now()}_${seq++}`;
  emit({ type: 'confirm', id, text: description });
  return new Promise((resolve) => {
    const timer = setTimeout(() => { pending.delete(id); resolve('reject'); }, 120000); // 2분 무응답 → 거부
    pending.set(id, { resolve: (d) => { clearTimeout(timer); resolve(d); } });
  });
}

function respond(id, decision) {
  const p = pending.get(id);
  if (!p) return false;
  pending.delete(id);
  p.resolve(decision === 'approve' ? 'approve' : 'reject');
  return true;
}

module.exports = { request, respond };
