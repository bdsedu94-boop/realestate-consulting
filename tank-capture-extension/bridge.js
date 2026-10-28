// 컨설팅 사이트 ↔ 확장프로그램 연결 (사이트 페이지에만 주입됨)
(() => {
  if (window.__tankBridge) return; window.__tankBridge = true;
  const send = m => window.postMessage({ ...m, source: 'tank-ext' }, location.origin);
  const version = chrome.runtime.getManifest().version;
  window.addEventListener('message', e => {
    if (e.source !== window || !e.data || e.data.source !== 'rec-site') return;
    const d = e.data;
    if (d.type === 'PING') return send({ type: 'PONG', version });
    if (d.type === 'CAPTURE') {
      chrome.runtime.sendMessage({ type: 'CAPTURE', reqId: d.reqId, caseNo: String(d.caseNo || '') }, res => {
        if (chrome.runtime.lastError) return send({ type: 'RESULT', reqId: d.reqId, ok: false, error: '확장프로그램 오류: ' + chrome.runtime.lastError.message });
        send({ type: 'RESULT', reqId: d.reqId, ...(res || { ok: false, error: '응답 없음' }) });
      });
    }
  });
  chrome.runtime.onMessage.addListener(m => { if (m && m.type === 'PROGRESS') send(m); });
  send({ type: 'PONG', version });
})();
