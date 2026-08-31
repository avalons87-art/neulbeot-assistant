// 채팅 UI ↔ 에이전트 팀장(SSE, 연속 대화) + 업무 폴더(목록/참고/저장) + 산출물
(function () {
  const $ = (id) => document.getElementById(id);
  const log = $('chatlog'), input = $('chatinput');
  const sendBtn = $('sendbtn'), teamBtn = $('teambtn');
  const statusEl = $('aistatus'), dateEl = $('todaydate'), nextEl = $('nextevent');
  const deliv = $('deliverable'), delivTitle = $('deliv-title'), delivBody = $('deliv-body');
  const filepanel = $('filepanel'), fileList = $('file-list'), filePreview = $('file-preview'), fileSearch = $('file-search');
  const refrow = $('refrow'), refname = $('refname');

  const ROLE = {
    me: { name: '나', cls: 'me' },
    lead: { name: '👑 팀장', cls: 'lead' }, plan: { name: '📋 기획', cls: 'plan' },
    design: { name: '🎨 디자인', cls: 'design' }, work: { name: '🔧 실무', cls: 'work' },
  };
  let attachedRef = null;      // {path, name}
  let lastDeliverable = null;  // {title, body}

  // ── 사용자 식별(선생님별 세션 분리) ──
  function askName() { return (prompt('늘벗이를 사용할 이름을 입력하세요 (예: 신현종)') || '').trim(); }
  let UID = localStorage.getItem('nb_name') || '';
  function showWho() { const w = $('whoami'); if (w) w.textContent = '👤 ' + (UID || '—'); }
  function changeUser() { const n = askName(); if (n) { localStorage.setItem('nb_name', n); location.reload(); } }

  function addLine(role, text) {
    const r = ROLE[role] || { name: role, cls: '' };
    const div = document.createElement('div');
    div.className = 'line ' + r.cls;
    const who = document.createElement('span'); who.className = 'who'; who.textContent = r.name;
    const txt = document.createElement('span'); txt.className = 'txt'; txt.textContent = text;
    div.append(who, txt); log.appendChild(div); log.scrollTop = log.scrollHeight;
  }

  // ── 에이전트 실행 (SSE, 연속 대화) ──
  let running = false;
  const queue = []; let pumping = false;
  let meetingOn = false, turnCount = 0;

  function pump() {
    if (pumping) return;
    const item = queue.shift(); if (!item) return;
    pumping = true;
    if (item.type === 'turn') {
      turnCount++;
      if (!meetingOn && (turnCount >= 2 || item.role !== 'lead')) { if (window.Game) Game.startMeeting(); meetingOn = true; }
      addLine(item.role, item.text);
      if (window.Game) { if (meetingOn) Game.teamTurn(item.role, item.text); else Game.sayMascot(item.text, 'happy'); }
      const wait = Math.max(1700, Math.min(6000, item.text.length * 42));
      setTimeout(() => { pumping = false; pump(); }, wait);
    } else if (item.type === 'deliverable') {
      showDeliverable(item.title, item.body, item.file);
      setTimeout(() => { pumping = false; pump(); }, 700);
    } else if (item.type === 'confirm') {
      renderConfirm(item);      // 승인/거부 버튼 표시 (승인 전엔 서버가 다음 이벤트를 안 보냄)
      pumping = false; pump();
    } else if (item.type === 'done') {
      if (window.Game && meetingOn) Game.endMeeting();
      running = false; teamBtn.disabled = false; sendBtn.disabled = false; pumping = false;
    } else { pumping = false; pump(); }
  }

  function runAgent(mode) {
    const msg = input.value.trim();
    if (!msg) { input.placeholder = '무엇을 도와드릴까요? (예: 오늘 일정 / 입교식 안내문 초안)'; input.focus(); return; }
    if (running) return;
    running = true; input.value = '';
    meetingOn = false; turnCount = 0;
    teamBtn.disabled = true; sendBtn.disabled = true;
    addLine('me', (mode === 'doc' ? '[업무] ' : '') + msg + (attachedRef ? ` (참고: ${attachedRef.name})` : ''));
    if (window.Game) Game.mascotThinking();

    let url = '/api/agent?msg=' + encodeURIComponent(msg) + '&uid=' + encodeURIComponent(UID);
    if (mode === 'doc') url += '&mode=doc';
    if (attachedRef && attachedRef.path) url += '&ref=' + encodeURIComponent(attachedRef.path);
    const es = new EventSource(url);
    es.onmessage = (ev) => {
      let data; try { data = JSON.parse(ev.data); } catch { return; }
      queue.push(data); if (data.type === 'done') es.close(); pump();
    };
    es.onerror = () => { es.close(); if (running) { queue.push({ type: 'turn', role: 'lead', text: '연결이 끊겼어요. 다시 시도해주세요.' }); queue.push({ type: 'done' }); pump(); } };
  }

  // ── 파일 변경 승인/거부 ──
  function renderConfirm(item) {
    const div = document.createElement('div');
    div.className = 'line work cfline';
    const who = document.createElement('span'); who.className = 'who'; who.textContent = '🔧 실무';
    const txt = document.createElement('span'); txt.className = 'txt'; txt.textContent = item.text;
    const btns = document.createElement('span'); btns.className = 'cf-btns';
    const ok = document.createElement('button'); ok.className = 'cf-ok'; ok.textContent = '✅ 승인';
    const no = document.createElement('button'); no.className = 'cf-no'; no.textContent = '✖ 거부';
    const decide = (d) => { ok.disabled = no.disabled = true; txt.textContent += d === 'approve' ? '  → 승인함' : '  → 거부함'; sendConfirm(item.id, d); };
    ok.onclick = () => decide('approve'); no.onclick = () => decide('reject');
    btns.append(ok, no); div.append(who, txt, btns);
    log.appendChild(div); log.scrollTop = log.scrollHeight;
  }
  function sendConfirm(id, decision) {
    fetch('/api/confirm?uid=' + encodeURIComponent(UID), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, decision }) }).catch(() => {});
  }

  // ── 산출물 패널 ──
  function showDeliverable(title, body, file) {
    lastDeliverable = { title, body, file };
    delivTitle.textContent = '📄 ' + title; delivBody.textContent = body;
    const dl = $('deliv-download'); dl.hidden = !file; dl.dataset.file = file || '';
    deliv.classList.add('show');
  }
  $('deliv-download').addEventListener('click', async () => {
    const f = $('deliv-download').dataset.file;
    if (!f) return;
    const btn = $('deliv-download'); const label = btn.textContent; btn.disabled = true; btn.textContent = '받는 중…';
    try {
      const res = await fetch('/api/download?uid=' + encodeURIComponent(UID) + '&path=' + encodeURIComponent(f));
      if (!res.ok) { addLine('lead', '다운로드 실패: ' + (await res.text()).slice(0, 80)); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = f.split('/').pop() || 'download';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch { addLine('lead', '다운로드 중 문제가 생겼어요.'); }
    finally { btn.disabled = false; btn.textContent = label; }
  });
  $('deliv-close').addEventListener('click', () => deliv.classList.remove('show'));
  $('deliv-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(delivBody.textContent); flash('deliv-copy', '복사됨!'); } catch { flash('deliv-copy', '복사 실패'); }
  });
  $('deliv-save').addEventListener('click', async () => {
    if (!lastDeliverable) return;
    flash('deliv-save', '저장 중…');
    try {
      const d = await (await fetch('/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(lastDeliverable) })).json();
      if (d.ok) { flash('deliv-save', '✅ ' + d.rel, 2500); addLine('work', `업무 폴더에 저장했어요: ${d.rel}`); }
      else flash('deliv-save', '실패: ' + (d.error || ''), 2500);
    } catch { flash('deliv-save', '저장 실패', 2000); }
  });
  function flash(id, txt, ms) { const b = $(id); const o = b.dataset.o || b.textContent; b.dataset.o = o; b.textContent = txt; clearTimeout(b._t); b._t = setTimeout(() => { b.textContent = o; b.dataset.o = ''; }, ms || 1200); }
  // 산출물 → 한글(.docx)로 저장 후 다운로드
  $('deliv-docx').addEventListener('click', async () => {
    if (!lastDeliverable) return;
    const btn = $('deliv-docx'); flash('deliv-docx', '만드는 중…', 4000);
    try {
      const d = await (await fetch('/api/save-docx?uid=' + encodeURIComponent(UID), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid: UID, title: lastDeliverable.title, body: lastDeliverable.body }) })).json();
      if (!d.ok) { flash('deliv-docx', '실패', 2000); addLine('lead', '한글문서 저장 실패: ' + (d.error || '')); return; }
      flash('deliv-docx', '✅ 저장', 2000);
      addLine('work', `한글문서(.docx)로 저장했어요: ${d.rel}${d.toFolder ? '' : ' (다운로드 폴더)'}`);
      const res = await fetch('/api/download?uid=' + encodeURIComponent(UID) + '&path=' + encodeURIComponent(d.rel));
      if (res.ok) { const blob = await res.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = d.rel.split('/').pop(); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); }
    } catch { flash('deliv-docx', '실패', 2000); }
  });

  // ── 손글씨/이미지 → 텍스트(OCR) ──
  // 큰 사진은 브라우저에서 먼저 축소(모델 한도·비용 절감)
  function downscaleImage(file, maxEdge) {
    return new Promise((resolve, reject) => {
      const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = () => {
        let { width: w, height: h } = img;
        const scale = Math.min(1, maxEdge / Math.max(w, h));
        w = Math.round(w * scale); h = Math.round(h * scale);
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve(cv.toDataURL('image/jpeg', 0.85).split(',')[1]); // base64만
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 읽지 못했어요')); };
      img.src = url;
    });
  }
  $('ocrbtn').addEventListener('click', () => $('ocrfile').click());
  $('ocrfile').addEventListener('change', async () => {
    const files = [...$('ocrfile').files]; $('ocrfile').value = '';
    if (!files.length) return;
    addLine('me', `✍️ 손글씨 사진 ${files.length}장 변환 요청`);
    if (window.Game) Game.mascotThinking();
    const parts = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      addLine('work', `📷 ${i + 1}/${files.length} "${f.name}" 읽는 중…`);
      try {
        const b64 = await downscaleImage(f, 1600);
        const d = await (await fetch('/api/ocr?uid=' + encodeURIComponent(UID), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid: UID, name: f.name, data: b64 }) })).json();
        if (d.ok) parts.push(`── ${f.name} ──\n${d.text || '(내용 없음)'}`);
        else { parts.push(`── ${f.name} ──\n(변환 실패: ${d.error || ''})`); addLine('lead', `"${f.name}" 변환 실패: ${d.error || ''}`); }
      } catch (e) { parts.push(`── ${f.name} ──\n(오류: ${e.message})`); }
    }
    const body = parts.join('\n\n');
    addLine('lead', `손글씨 ${files.length}장을 텍스트로 옮겼어요. 아래에서 확인·수정하세요 ✍️ (한글 저장도 가능)`);
    showDeliverable('손글씨 변환 결과', body);
  });

  // ── 행사 준비 체크리스트(다가오는 행사 기준) ──
  $('checklistbtn').addEventListener('click', () => {
    if (running) return;
    input.value = '다가오는 행사와 마감을 확인해서, 가장 가까운 행사의 준비 체크리스트를 만들어줘. 준비물·담당·기한을 표로 정리하고, 세종늘벗학교 상황(대안교육위탁·재적학교 발송 등)에 맞게. 완성하면 산출물로 보여줘.';
    runAgent('doc');
  });

  // ── 업무 폴더 브라우저 ──
  let allFiles = [];
  async function openFiles() {
    filepanel.classList.add('show');
    fileList.innerHTML = '<div class="loading">불러오는 중…</div>';
    try {
      const d = await (await fetch('/api/files')).json();
      if (!d.ok) { fileList.innerHTML = `<div class="loading">업무 폴더를 찾을 수 없어요.<br><small>${d.dir || ''}</small></div>`; return; }
      allFiles = d.files || []; renderFiles('');
    } catch { fileList.innerHTML = '<div class="loading">목록을 불러오지 못했어요.</div>'; }
  }
  function renderFiles(q) {
    q = (q || '').trim().toLowerCase();
    const docsOnly = $('docs-only').checked;
    fileList.innerHTML = '';
    let items = allFiles.filter((f) => !q || f.path.toLowerCase().includes(q));
    if (docsOnly) items = items.filter((f) => f.type === 'dir' || f.readable);
    if (!items.length) { fileList.innerHTML = '<div class="loading">해당 파일이 없어요.</div>'; return; }
    const CAP = 800, shown = items.slice(0, CAP);
    for (const f of shown) {
      const row = document.createElement('div');
      row.className = 'frow ' + f.type + (f.readable ? ' readable' : '');
      row.style.paddingLeft = 6 + (q ? 0 : f.depth * 12) + 'px';
      if (f.type === 'dir') row.innerHTML = `<span class="ficon">📂</span><span class="fname">${esc(f.name)}</span>`;
      else {
        row.innerHTML = `<span class="ficon">${icon(f.ext)}</span><span class="fname">${esc(f.name)}</span>${f.readable ? '<span class="ftag">참고가능</span>' : ''}`;
        if (f.readable) row.addEventListener('click', () => previewFile(f));
        else row.title = 'PDF/텍스트만 참고 가능 (HWP는 PDF 짝 이용)';
      }
      fileList.appendChild(row);
    }
    if (items.length > CAP) { const m = document.createElement('div'); m.className = 'loading'; m.innerHTML = `…외 ${items.length - CAP}개. <b>검색</b>으로 좁혀보세요.`; fileList.appendChild(m); }
  }
  async function previewFile(f) {
    filePreview.innerHTML = `<div class="preview-empty">"${esc(f.name)}" 여는 중…</div>`;
    try {
      const d = await (await fetch('/api/file?path=' + encodeURIComponent(f.path))).json();
      if (!d.ok) { filePreview.innerHTML = `<div class="preview-empty">못 읽었어요: ${esc(d.error || '')}</div>`; return; }
      filePreview.innerHTML = '';
      const head = document.createElement('div'); head.className = 'preview-head'; head.innerHTML = `<b>${esc(f.name)}</b>`;
      const btn = document.createElement('button'); btn.className = 'attach-btn'; btn.textContent = '📎 이 파일 참고로 첨부';
      btn.addEventListener('click', () => { setRef(f.path, f.name); filepanel.classList.remove('show'); });
      head.appendChild(btn);
      const pre = document.createElement('pre'); pre.className = 'preview-text'; pre.textContent = d.text || '(내용 없음)';
      filePreview.append(head, pre);
    } catch { filePreview.innerHTML = '<div class="preview-empty">미리보기 실패</div>'; }
  }
  function setRef(path, name) { attachedRef = { path, name }; refname.textContent = name; refrow.hidden = false; input.focus(); }
  function setRefUploaded(name) { attachedRef = { uploaded: true, name }; refname.textContent = name + ' (업로드)'; refrow.hidden = false; input.focus(); }
  function clearRef() {
    if (attachedRef && attachedRef.uploaded) { fetch('/api/upload-ref/clear?uid=' + encodeURIComponent(UID), { method: 'POST' }).catch(() => {}); }
    attachedRef = null; refrow.hidden = true;
  }

  // ── 파일 업로드(자기 PC 파일 → 참고자료) ──
  $('uploadbtn').addEventListener('click', () => $('fileup').click());
  $('fileup').addEventListener('change', () => {
    const f = $('fileup').files[0]; if (!f) return;
    $('fileup').value = '';
    const isText = /\.(txt|md|markdown|csv|json|html?|xml|log)$/i.test(f.name);
    const reader = new FileReader();
    reader.onload = async () => {
      let data, encoding;
      if (isText) { data = reader.result; encoding = 'utf8'; }
      else { data = String(reader.result).split(',')[1]; encoding = 'base64'; }
      try {
        const r = await fetch('/api/upload-ref?uid=' + encodeURIComponent(UID), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uid: UID, name: f.name, data, encoding }),
        });
        const d = await r.json();
        if (d.ok) { setRefUploaded(d.name); addLine('lead', `"${d.name}" 참고자료로 올렸어요. 이제 이걸 참고해서 작업할게요 📎`); }
        else addLine('lead', '업로드 실패: ' + (d.error || ''));
      } catch { addLine('lead', '업로드 중 문제가 생겼어요.'); }
    };
    if (isText) reader.readAsText(f); else reader.readAsDataURL(f);
  });

  // ── 업무 폴더 자동 분석 (접속 시 1회, 캐시) ──
  let analyzed = false;
  async function analyzeFolder(force) {
    if (analyzed && !force) return;
    try {
      let url = '/api/analyze-folder?uid=' + encodeURIComponent(UID);
      if (force) url += '&force=1';
      const d = await (await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid: UID }) })).json();
      if (d.ok && d.overview) { analyzed = true; addLine('lead', '📂 업무 폴더를 살펴봤어요:\n' + d.overview); }
    } catch {}
  }

  // ── 내 폴더 설정 (탐색기식 선택창) ──
  const folderpick = $('folderpick'), pickPath = $('pick-path'), pickList = $('pick-list');
  let pickCurrent = ''; // 현재 보고 있는 폴더 경로('' = 드라이브 목록)

  async function browse(p, ctx) {
    ctx = ctx || { list: pickList, pathEl: pickPath, set: (c) => { pickCurrent = c; } };
    ctx.list.innerHTML = '<div class="loading">불러오는 중…</div>';
    try {
      const d = await (await fetch('/api/browse?uid=' + encodeURIComponent(UID) + '&path=' + encodeURIComponent(p || ''))).json();
      if (!d.ok) { ctx.list.innerHTML = `<div class="loading">${esc(d.error || '열 수 없어요')}</div>`; return; }
      ctx.set(d.path || '');
      ctx.pathEl.textContent = (d.path || '') || '내 컴퓨터 (드라이브 선택)';
      ctx.list.innerHTML = '';
      if (d.parent !== null && d.parent !== undefined) {
        const up = document.createElement('div'); up.className = 'prow up'; up.innerHTML = '<span class="ficon">⬆️</span><span>상위 폴더</span>';
        up.addEventListener('click', () => browse(d.parent, ctx)); ctx.list.appendChild(up);
      }
      (d.drives || []).forEach((dr) => {
        const row = document.createElement('div'); row.className = 'prow'; row.innerHTML = `<span class="ficon">💽</span><span>${esc(dr)}</span>`;
        row.addEventListener('click', () => browse(dr, ctx)); ctx.list.appendChild(row);
      });
      (d.dirs || []).forEach((f) => {
        const row = document.createElement('div'); row.className = 'prow'; row.innerHTML = `<span class="ficon">📁</span><span class="fname">${esc(f.name)}</span>`;
        row.addEventListener('click', () => browse(f.path, ctx)); ctx.list.appendChild(row);
      });
      if (!d.drives && !(d.dirs || []).length && d.parent == null) ctx.list.innerHTML += '<div class="loading">하위 폴더가 없어요. 상단 "이 폴더 선택"을 누르면 여기가 지정돼요.</div>';
    } catch { ctx.list.innerHTML = '<div class="loading">불러오지 못했어요.</div>'; }
  }

  // 진짜 윈도우 폴더 선택창(탐색기) — 서버=본인 PC일 때 절대경로를 받음
  async function pickFolderNative() {
    try { return await (await fetch('/api/pick-folder?uid=' + encodeURIComponent(UID))).json(); }
    catch { return { ok: false, error: '연결 실패' }; }
  }
  // 앱 내 목록 탐색(폴백)
  async function openFolderBrowser() {
    let cur = ''; try { cur = (await (await fetch('/api/folder?uid=' + encodeURIComponent(UID))).json()).folder || ''; } catch {}
    folderpick.classList.add('show');
    browse(cur);
  }
  $('folder-set').addEventListener('click', async () => {
    filepanel.classList.remove('show');
    const d = await pickFolderNative();
    if (d.ok && d.path) { saveFolder(d.path); return; }  // 탐색기로 선택함
    if (d.ok && d.cancelled) return;                      // 취소
    openFolderBrowser();                                  // 미지원/오류 → 목록 탐색 폴백
  });
  $('pick-native') && $('pick-native').addEventListener('click', async () => {
    const d = await pickFolderNative();
    if (d.ok && d.path) { folderpick.classList.remove('show'); saveFolder(d.path); }
    else if (d.ok && d.cancelled) { /* 취소 */ }
    else alert(d.error || '탐색기를 열 수 없어요.');
  });
  $('pick-close').addEventListener('click', () => folderpick.classList.remove('show'));
  async function saveFolder(folderPath) {
    try {
      const d = await (await fetch('/api/folder?uid=' + encodeURIComponent(UID), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid: UID, folder: folderPath }) })).json();
      if (d.ok) {
        folderpick.classList.remove('show');
        addLine('lead', folderPath ? `업무 폴더를 설정했어요: ${d.folder}` : '업무 폴더를 해제했어요.');
        if (folderPath) { analyzed = false; analyzeFolder(true); }
      } else alert('설정 실패: ' + (d.error || ''));
    } catch { alert('설정 중 문제가 생겼어요.'); }
  }
  $('pick-select').addEventListener('click', () => { if (!pickCurrent) return alert('폴더 안으로 들어간 뒤 선택하세요.'); saveFolder(pickCurrent); });
  $('pick-clear').addEventListener('click', () => saveFolder(''));
  function icon(ext) { if (ext === '.pdf') return '📕'; if (/\.(txt|md|log)/.test(ext)) return '📄'; if (/\.(hwp|hwpx)/.test(ext)) return '📘'; if (/\.(xlsx?|csv)/.test(ext)) return '📊'; if (/\.(png|jpe?g|gif)/.test(ext)) return '🖼️'; return '📃'; }
  function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

  // ── 바인딩 ──
  sendBtn.addEventListener('click', () => runAgent('chat'));
  teamBtn.addEventListener('click', () => runAgent('doc'));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') runAgent('chat'); });
  document.querySelectorAll('.quick[data-q]').forEach((b) => b.addEventListener('click', () => { input.value = b.dataset.q; runAgent('chat'); }));
  $('resetbtn').addEventListener('click', async () => {
    try { await fetch('/api/reset?uid=' + encodeURIComponent(UID), { method: 'POST' }); } catch {}
    clearRef(); lastDeliverable = null;
    addLine('lead', '새 작업으로 시작할게요! 이전 대화·초안 기억을 비웠어요 🌱');
  });
  showWho();
  $('whoami').addEventListener('click', changeUser);

  // ── API 키 설정 (공유 키 ↔ 개인 키 교체) ──
  function renderKeyBadge(s) {
    const b = $('keybadge');
    if (s.usingOpenRouter) b.textContent = '🔑 OpenRouter';
    else if (s.usingPersonal) b.textContent = '🔑 내 키';
    else if (s.sharedAvailable) b.textContent = '🔑 공유 키';
    else b.textContent = '🔑 키 없음';
  }
  async function openKeys() {
    $('keypanel').classList.add('show');
    $('key-anthropic').value = ''; $('key-gemini').value = ''; $('key-openrouter').value = ''; $('key-ormodel').value = '';
    try {
      const s = await (await fetch('/api/keys')).json();
      renderKeyBadge(s);
      let txt, cls;
      if (s.usingOpenRouter) { txt = `현재: OpenRouter 사용 중 (${s.openrouterModel || ''})`; cls = 'personal'; if (s.openrouterModel) $('key-ormodel').value = s.openrouterModel; }
      else if (s.usingPersonal) { txt = '현재: 내 개인 Claude 키 사용 중 (공유 한도와 무관)'; cls = 'personal'; }
      else if (s.sharedAvailable) { txt = '현재: 공유(한도) 키 사용 중'; cls = 'shared'; }
      else { txt = '현재: 키 없음 (데모 모드)'; cls = 'none'; }
      // 저장돼 있는 개인키 표시(빈 칸으로 저장해도 안 지워짐을 알림)
      const saved = [];
      if (s.usingPersonal) saved.push('Claude');
      if (s.usingPersonalGemini) saved.push('Gemini');
      if (s.openrouterStored) saved.push('OpenRouter' + (s.openrouterOff ? '(꺼짐)' : ''));
      if (saved.length) txt += `\n저장된 개인키: ${saved.join(', ')} · 빈 칸으로 저장해도 안 지워져요`;
      $('key-status').textContent = txt; $('key-status').className = 'key-status ' + cls;
      // OpenRouter 켜기/끄기 토글 버튼 (키가 저장돼 있을 때만)
      const btnOff = $('key-or-off');
      if (s.openrouterStored) {
        btnOff.hidden = false;
        const on = !s.openrouterOff;
        btnOff.dataset.on = on ? '1' : '0';
        btnOff.textContent = on ? 'OpenRouter 끄기' : `OpenRouter 켜기 (${s.openrouterModel || ''})`;
        btnOff.title = on ? 'OpenRouter를 끄고 저장된 Claude/Gemini(없으면 공유키)로 전환. 키는 보존돼요.' : '저장된 OpenRouter 키로 다시 켜기';
      } else btnOff.hidden = true;
    } catch { $('key-status').textContent = '상태를 못 불러왔어요.'; }
  }
  $('keybadge').addEventListener('click', openKeys);
  $('key-close').addEventListener('click', () => $('keypanel').classList.remove('show'));
  $('key-save').addEventListener('click', async () => {
    const anthropic = $('key-anthropic').value.trim(), gemini = $('key-gemini').value.trim();
    const openrouter = $('key-openrouter').value.trim(), openrouterModel = $('key-ormodel').value.trim();
    if (!anthropic && !gemini && !openrouter) return alert('키를 입력하세요.');
    // 입력한 것만 보냄 → 빈 칸은 기존 저장 키를 건드리지 않음
    const patch = {};
    if (anthropic) patch.anthropic = anthropic;
    if (gemini) patch.gemini = gemini;
    if (openrouter) { patch.openrouter = openrouter; patch.openrouterModel = openrouterModel; }
    const btn = $('key-save'); btn.disabled = true; btn.textContent = '확인 중…';
    try {
      const d = await (await fetch('/api/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })).json();
      if (d.ok) { renderKeyBadge(d); $('keypanel').classList.remove('show'); addLine('lead', d.usingOpenRouter ? `OpenRouter로 바꿨어요 (${d.openrouterModel}). 🔑` : '내 개인 키로 바꿨어요. 이제 공유 한도와 무관하게 쓸 수 있어요 🔑'); }
      else alert(d.error || '저장 실패');
    } catch { alert('저장 중 문제가 생겼어요.'); }
    finally { btn.disabled = false; btn.textContent = '저장하고 내 키 쓰기'; }
  });
  // OpenRouter 켜기/끄기 토글 (키는 보존 — 껐다 켰다 전환)
  $('key-or-off').addEventListener('click', async () => {
    const turnOn = $('key-or-off').dataset.on !== '1'; // 지금 꺼져 있으면 켠다
    try {
      const d = await (await fetch('/api/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openrouterEnabled: turnOn }) })).json();
      if (d.ok) {
        renderKeyBadge(d); $('keypanel').classList.remove('show');
        if (turnOn) addLine('lead', `OpenRouter를 다시 켰어요 (${d.openrouterModel || ''}) 🔑`);
        else addLine('lead', d.usingPersonal ? 'OpenRouter를 끄고 내 개인 Claude 키로 전환했어요 (OpenRouter 키는 보존) 🔑' : (d.sharedAvailable ? 'OpenRouter를 끄고 공유 키로 전환했어요 (OpenRouter 키는 보존) 🔑' : 'OpenRouter를 껐어요.'));
      } else alert(d.error || '처리 실패');
    } catch { alert('처리 중 문제가 생겼어요.'); }
  });
  $('key-reset').addEventListener('click', async () => {
    if (!confirm('공유(한도) 키로 되돌릴까요? 저장된 개인 키가 지워져요.')) return;
    try {
      const d = await (await fetch('/api/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reset: true }) })).json();
      if (d.ok) { renderKeyBadge(d); $('keypanel').classList.remove('show'); addLine('lead', '공유 키로 되돌렸어요.'); }
    } catch { alert('처리 중 문제가 생겼어요.'); }
  });
  // ── 자동 업데이트 (git 없이) ──
  (async () => {
    try {
      const d = await (await fetch('/api/update/check')).json();
      if (d.noSource) return; // 업데이트 출처 미설정 → 버튼 숨김
      $('updatebtn').hidden = false;
      if (d.available) { $('updatebtn').textContent = '🔃 업데이트 있음'; $('updatebtn').classList.add('has-update'); }
    } catch {}
  })();
  $('updatebtn').addEventListener('click', async () => {
    const btn = $('updatebtn'); btn.disabled = true; const label = btn.textContent; btn.textContent = '확인 중…';
    try {
      const c = await (await fetch('/api/update/check')).json();
      if (c.noSource) { alert('업데이트 출처가 설정되지 않았어요.'); return; }
      if (c.error) { addLine('lead', '업데이트 확인 실패: ' + c.error); return; }
      if (!c.available) { addLine('lead', `이미 최신이에요 ✅ (버전 ${c.local})`); return; }
      if (!confirm(`새 버전(${c.remote})이 있어요. 지금 업데이트할까요?\n(잠시 재시작되니, 10초쯤 뒤 새로고침하면 돼요)`)) return;
      btn.textContent = '업데이트 중…';
      const d = await (await fetch('/api/update/apply', { method: 'POST' })).json();
      if (d.ok) addLine('lead', `업데이트했어요! (파일 ${d.copied}개) 🔃 재시작 중이에요. 10초쯤 뒤 F5로 새로고침해주세요.`);
      else addLine('lead', '업데이트 실패: ' + (d.error || ''));
    } catch { addLine('lead', '업데이트 진행 중이에요(연결이 끊겼다면 재시작 중 — 잠시 뒤 F5 새로고침).'); }
    finally { btn.disabled = false; btn.textContent = label; }
  });
  $('filesbtn').addEventListener('click', openFiles);
  $('file-close').addEventListener('click', () => filepanel.classList.remove('show'));
  fileSearch.addEventListener('input', () => renderFiles(fileSearch.value));
  $('docs-only').addEventListener('change', () => renderFiles(fileSearch.value));
  $('refclear').addEventListener('click', clearRef);

  // ── 상태 & 일정 ──
  function bootStatus() {
  return fetch('/api/status?uid=' + encodeURIComponent(UID)).then((r) => r.json()).then((s) => {
    statusEl.textContent = `Claude ${s.claude ? '✅' : '✕'} · Gemini ${s.gemini ? '✅' : '✕'}`;
    statusEl.classList.toggle('on', s.claude || s.gemini);
    renderKeyBadge(s);
    if (s.brand) { const b = document.querySelector('.brand'); if (b) b.textContent = '🌱 ' + s.brand; document.title = s.brand + ' · AI 비서'; }
    $('filesbtn').title = s.hasFolder ? ('업무 폴더: ' + s.folder) : '설정된 업무 폴더 없음 (📂 폴더 설정 또는 ⬆️ 파일 올리기)';
    // 자기 폴더가 있어야 서버 저장 버튼 노출(없으면 다운로드 사용)
    if (!s.hasFolder) $('deliv-save').style.display = 'none';
    if (!s.sharedRoot) $('folder-set').title = '공유 폴더가 설정되지 않아 경로 지정이 제한됩니다. ⬆️ 파일 올리기를 쓰세요.';
    // 손님(다른 선생님)이고 공유 폴더도 없으면 → 폴더 기능 숨기고 업로드로 안내
    if (!s.isOwner && !s.sharedRoot) {
      $('filesbtn').style.display = 'none';
      $('folder-set').style.display = 'none';
      setTimeout(() => addLine('lead', '다른 선생님은 폴더 대신 "⬆️ 파일 올리기"로 자기 PC 파일을 참고하시면 돼요. 문서 결과물은 완성 후 "⬇️ 다운로드"로 받으시면 됩니다 🌱'), 1600);
    }
    if (s.hasFolder && s.claude) setTimeout(analyzeFolder, 1400); // 접속 시 폴더 자동 분석
  }).catch(() => { statusEl.textContent = '상태 확인불가'; });
  }

  function loadSchedule(greet) {
    return fetch('/api/schedule').then((r) => r.json()).then((d) => {
      dateEl.textContent = `${d.today} (오늘)`;
      const up = d.upcoming || [];
      nextEl.textContent = up[0] ? `다음: ${up[0].title} (D-${up[0].dday})` : '다가오는 일정 없음';
      const board = []; const on = d.onToday || [];
      board.push(on.length ? '오늘: ' + on.map((e) => e.title).join(', ') : '오늘 일정 없음');
      up.slice(0, 3).forEach((e) => board.push(`· ${e.title} D-${e.dday}`));
      if (window.Game) Game.setBoard(board);
      window.__schedSource = d.source; window.__schedTotal = d.total;
      if (greet) setTimeout(() => {
        const hi = on.length ? `안녕하세요! 오늘은 "${on[0].title}" 있는 날이에요 🌱` : '안녕하세요 선생님! 무엇을 도와드릴까요? 🌱';
        addLine('lead', hi); if (window.Game) Game.sayMascot(hi, 'happy');
        // 마감 임박(7일 이내) 리마인더
        const dls = (d.deadlines || []).filter((e) => e.dday >= 0 && e.dday <= 7);
        if (dls.length) setTimeout(() => addLine('lead', '⏰ 마감 임박 알림: ' + dls.map((e) => `${e.title} (D-${e.dday})`).join(' · ') + '\n필요하면 "○○ 준비 도와줘"라고 말씀해 주세요.'), 1200);
      }, 900);
    }).catch(() => {});
  }

  // ── 학사일정 불러오기 ──
  $('schedbtn').addEventListener('click', () => {
    const src = window.__schedSource === 'custom' ? `현재: 불러온 일정 사용 중 (${window.__schedTotal || 0}개)` : '현재: 기본(세종늘벗학교 2026) 일정 사용 중';
    $('sched-status').textContent = src;
    $('sched-status').className = 'key-status ' + (window.__schedSource === 'custom' ? 'personal' : 'shared');
    $('schedpanel').classList.add('show');
  });
  $('sched-close').addEventListener('click', () => $('schedpanel').classList.remove('show'));
  $('sched-fromfile').addEventListener('click', () => $('schedfile').click());
  $('schedfile').addEventListener('change', () => {
    const f = $('schedfile').files[0]; if (!f) return; $('schedfile').value = '';
    const isText = /\.(txt|md|csv)$/i.test(f.name); const reader = new FileReader();
    $('sched-text').value = '(파일 읽는 중…)';
    reader.onload = async () => {
      let data = isText ? reader.result : String(reader.result).split(',')[1];
      try {
        const d = await (await fetch('/api/extract-text', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: f.name, data, encoding: isText ? 'utf8' : 'base64' }) })).json();
        $('sched-text').value = d.ok ? d.text : ('(읽기 실패: ' + (d.error || '') + ')');
      } catch { $('sched-text').value = '(파일 읽기 실패)'; }
    };
    if (isText) reader.readAsText(f); else reader.readAsDataURL(f);
  });
  $('sched-import').addEventListener('click', async () => {
    const text = $('sched-text').value.trim();
    if (text.length < 10) return alert('일정 내용을 붙여넣어 주세요.');
    const btn = $('sched-import'); btn.disabled = true; btn.textContent = 'AI가 정리 중…';
    try {
      const d = await (await fetch('/api/schedule/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })).json();
      if (d.ok) { $('schedpanel').classList.remove('show'); addLine('lead', `학사일정 ${d.count}개를 불러왔어요. 이제 이 일정을 기준으로 판단할게요 📅`); await loadSchedule(false); }
      else alert(d.error || '불러오기 실패');
    } catch { alert('처리 중 문제가 생겼어요.'); }
    finally { btn.disabled = false; btn.textContent = '이 내용으로 학사일정 설정'; }
  });
  $('sched-reset').addEventListener('click', async () => {
    if (!confirm('내장(기본) 일정으로 되돌릴까요? 불러온 일정은 지워져요.')) return;
    try { await fetch('/api/schedule/reset', { method: 'POST' }); $('schedpanel').classList.remove('show'); addLine('lead', '기본 일정으로 되돌렸어요.'); await loadSchedule(false); } catch { alert('처리 실패'); }
  });

  // ── 앱 시작(온보딩 이후 또는 재방문) ──
  function startApp() {
    showWho();
    bootStatus();
    loadSchedule(true);
    input.focus();
  }

  // ══ 처음 사용 온보딩 마법사 ══
  const WIZ = $('wizard');
  let wizPickCurrent = '';
  const wizCtx = { list: $('wiz-pick-list'), pathEl: $('wiz-pick-path'), set: (c) => { wizPickCurrent = c; } };

  function wizGo(n) {
    WIZ.querySelectorAll('.wpanel').forEach((p) => { p.hidden = p.dataset.s !== String(n); });
    WIZ.querySelectorAll('.wstep').forEach((s) => s.classList.toggle('active', Number(s.dataset.s) <= n));
    if (n === 3) browse(wizPickCurrent || '', wizCtx);
    if (n === 4) wizUnderstand();
  }
  function openWizard() {
    WIZ.classList.add('show');
    if (UID) $('wiz-name').value = UID;
    wizGo(1);
    setTimeout(() => $('wiz-name').focus(), 120);
  }
  function finishWizard() {
    localStorage.setItem('nb_onboarded', '1');
    WIZ.classList.remove('show');
    startApp();
  }

  WIZ.querySelectorAll('.wback').forEach((b) => b.addEventListener('click', () => wizGo(Number(b.dataset.back))));
  WIZ.querySelectorAll('.wskip').forEach((b) => b.addEventListener('click', () => wizGo(Number(b.dataset.next))));

  // ① 이름
  $('wiz-name-next').addEventListener('click', () => {
    const n = $('wiz-name').value.trim();
    const msg = $('wiz-name-msg');
    if (!n) { msg.textContent = '이름을 입력해주세요.'; msg.className = 'wiz-msg err'; return; }
    UID = n; localStorage.setItem('nb_name', n); showWho();
    msg.textContent = '';
    wizGo(2);
  });
  $('wiz-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('wiz-name-next').click(); });

  // ② 학사일정
  $('wiz-schedfile-btn').addEventListener('click', () => $('wiz-schedfile').click());
  $('wiz-schedfile').addEventListener('change', () => {
    const f = $('wiz-schedfile').files[0]; if (!f) return; $('wiz-schedfile').value = '';
    const isText = /\.(txt|md|csv)$/i.test(f.name); const reader = new FileReader();
    $('wiz-schedtext').value = '(파일 읽는 중…)';
    reader.onload = async () => {
      let data = isText ? reader.result : String(reader.result).split(',')[1];
      try {
        const d = await (await fetch('/api/extract-text', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: f.name, data, encoding: isText ? 'utf8' : 'base64' }) })).json();
        $('wiz-schedtext').value = d.ok ? d.text : ('(읽기 실패: ' + (d.error || '') + ')');
      } catch { $('wiz-schedtext').value = '(파일 읽기 실패)'; }
    };
    if (isText) reader.readAsText(f); else reader.readAsDataURL(f);
  });
  $('wiz-sched-apply').addEventListener('click', async () => {
    const text = $('wiz-schedtext').value.trim();
    const msg = $('wiz-sched-msg');
    if (text.length < 10) { msg.textContent = '일정 내용을 붙여넣거나 파일에서 가져와 주세요. (또는 "건너뛰기")'; msg.className = 'wiz-msg err'; return; }
    const btn = $('wiz-sched-apply'); btn.disabled = true; btn.textContent = 'AI가 정리 중…';
    msg.textContent = '🌱 일정을 날짜·행사로 정리하고 있어요…'; msg.className = 'wiz-msg';
    try {
      const d = await (await fetch('/api/schedule/import?uid=' + encodeURIComponent(UID), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })).json();
      if (d.ok) { msg.textContent = `✅ ${d.count}개 일정을 불러왔어요!`; msg.className = 'wiz-msg ok'; setTimeout(() => wizGo(3), 800); }
      else { msg.textContent = (d.error || '불러오기 실패'); msg.className = 'wiz-msg err'; }
    } catch { msg.textContent = '처리 중 문제가 생겼어요.'; msg.className = 'wiz-msg err'; }
    finally { btn.disabled = false; btn.textContent = '이 일정으로 설정 →'; }
  });

  // ③ 업무 폴더
  async function wizApplyFolder(path) {
    const msg = $('wiz-folder-msg');
    try {
      const d = await (await fetch('/api/folder?uid=' + encodeURIComponent(UID), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid: UID, folder: path }) })).json();
      if (d.ok) { analyzed = false; msg.textContent = '✅ 업무 폴더로 설정했어요: ' + d.folder; msg.className = 'wiz-msg ok'; setTimeout(() => wizGo(4), 800); return true; }
      msg.textContent = (d.error || '설정 실패'); msg.className = 'wiz-msg err'; return false;
    } catch { msg.textContent = '설정 중 문제가 생겼어요.'; msg.className = 'wiz-msg err'; return false; }
  }
  $('wiz-folder-native').addEventListener('click', async () => {
    const msg = $('wiz-folder-msg'); msg.textContent = '탐색기 창에서 폴더를 골라주세요…'; msg.className = 'wiz-msg';
    const d = await pickFolderNative();
    if (d.ok && d.path) await wizApplyFolder(d.path);
    else if (d.ok && d.cancelled) msg.textContent = '';
    else { msg.textContent = (d.error || '탐색기를 열 수 없어요. 아래 목록에서 골라주세요.'); msg.className = 'wiz-msg err'; }
  });
  $('wiz-folder-apply').addEventListener('click', async () => {
    const msg = $('wiz-folder-msg');
    if (!wizPickCurrent) { msg.textContent = '폴더 안으로 들어간 뒤 "이 폴더로 설정"을 누르세요. (또는 "🗂 Windows 탐색기로 찾기")'; msg.className = 'wiz-msg err'; return; }
    const btn = $('wiz-folder-apply'); btn.disabled = true;
    try { await wizApplyFolder(wizPickCurrent); } finally { btn.disabled = false; }
  });

  // ④ 업무 파악·확인
  async function wizUnderstand() {
    const load = $('wiz-understand-load'), ta = $('wiz-understand');
    ta.hidden = true; load.style.display = ''; load.className = 'wiz-msg'; load.textContent = '🌱 폴더와 일정을 살펴보는 중… (10초쯤 걸릴 수 있어요)';
    try {
      const d = await (await fetch('/api/onboard/understand?uid=' + encodeURIComponent(UID), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid: UID }) })).json();
      if (d.ok) { ta.value = d.understanding; ta.hidden = false; load.style.display = 'none'; }
      else { load.textContent = '파악 실패: ' + (d.error || ''); load.className = 'wiz-msg err'; }
    } catch { load.textContent = '파악 중 문제가 생겼어요. "다시 파악"을 눌러보세요.'; load.className = 'wiz-msg err'; }
  }
  $('wiz-understand-redo').addEventListener('click', wizUnderstand);
  $('wiz-finish').addEventListener('click', async () => {
    const work = $('wiz-understand').value.trim();
    const btn = $('wiz-finish'); btn.disabled = true;
    try {
      if (work) await fetch('/api/onboard/confirm?uid=' + encodeURIComponent(UID), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid: UID, work }) });
    } catch {}
    finishWizard();
    setTimeout(() => addLine('lead', `반가워요 ${UID} 선생님! 첫 설정을 마쳤어요. 파악한 업무를 기억하고 도와드릴게요 🌱\n(궁금한 점·오류는 아래 "💬 문의·공지"로 편하게 물어보세요.)`), 400);
    btn.disabled = false;
  });

  // 🧭 첫 설정 — 언제든 마법사 다시 열기(기존 이름/폴더/일정은 그대로, 다시 확인·변경 가능)
  $('setupbtn').addEventListener('click', openWizard);
  // 💬 문의·공지 (카카오톡 오픈채팅)
  $('helpbtn').addEventListener('click', () => $('helppanel').classList.add('show'));
  $('help-close').addEventListener('click', () => $('helppanel').classList.remove('show'));

  // ── 부팅: 이름이 아직 없으면(처음 사용) 마법사, 있으면 바로 시작 ──
  if (UID) { localStorage.setItem('nb_onboarded', '1'); startApp(); }
  else openWizard();
})();
