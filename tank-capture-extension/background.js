/*
 * 추천물건 캡처 도우미 — 백그라운드
 * 흐름: 사이트에서 CAPTURE 요청 → (이미 열린 탭에 해당 사건이 있으면 사용)
 *       → 없으면 새 창에서 탱크옥션 검색 → 결과 클릭 → 상세 페이지
 *       → 지연 로딩 영역 스크롤 → 이름 가림 → 영역 측정 → 영역별 스크린샷 → 사이트로 반환
 * 담당자 크롬에 로그인된 탱크옥션 세션을 그대로 사용하며, 요청할 때 1건씩만 실행합니다.
 */

const DEFAULTS = {
  tankBase: 'https://www.tankauction.com',
  searchPath: '/ca/caList.php',
  // 검색 결과 주소를 직접 열 수 있으면 사용 (예: https://www.tankauction.com/ca/caList.php?...={year}...={num})
  // {year}=2024 {num}=53537 {case}=2024타경53537 {caseEnc}=URL인코딩된 사건번호
  searchUrlTemplate: '',
  caseInputFormat: 'auto', // auto | full(2024타경53537) | dash(2024-53537) | num(53537, 연도는 선택칸)
  capAuction: true,
  capTenant: true,
  capRegistry: true,
  tenantTitles: '임차인 현황, 임차인현황',
  registryTitles: '건물등기, 집합건물등기, 건물 등기, 토지등기, 등기부 현황',
  maskNames: true,
  keepWindow: false,
  stepDelay: 900
};

async function getSettings() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...s };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
let busy = false;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'CAPTURE') {
    if (busy) { sendResponse({ ok: false, error: '다른 캡처가 진행 중입니다. 끝난 뒤 다시 시도해주세요.' }); return; }
    busy = true;
    capture(msg, sender).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message || String(e) })).finally(() => { busy = false; });
    return true;
  }
  if (msg?.type === 'DIAGNOSE') {
    diagnose().then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }
});

function parseCase(caseNo) {
  const m = String(caseNo).replace(/\s/g, '').match(/(\d{4})타경(\d+)/);
  if (!m) throw new Error('사건번호 형식이 올바르지 않습니다: ' + caseNo);
  return { year: m[1], num: m[2], full: `${m[1]}타경${m[2]}` };
}

async function capture({ reqId, caseNo }, sender) {
  const cfg = await getSettings();
  const cs = parseCase(caseNo);
  const siteTab = sender.tab;
  const log = [];
  const progress = message => { log.push(message); if (siteTab) chrome.tabs.sendMessage(siteTab.id, { type: 'PROGRESS', reqId, message }).catch(() => {}); };

  let tabId = null, winId = null, ownWindow = false;
  try {
    // 1) 이미 열려 있는 탱크옥션 탭 중 해당 사건 상세 페이지가 있으면 그대로 사용
    progress('열려 있는 탱크옥션 탭 확인 중...');
    tabId = await findOpenDetailTab(cfg, cs);

    if (!tabId) {
      // 2) 새 창에서 검색
      const url = cfg.searchUrlTemplate
        ? fillTemplate(cfg.searchUrlTemplate, cs)
        : cfg.tankBase.replace(/\/$/, '') + cfg.searchPath;
      progress('탱크옥션 검색 페이지 여는 중...');
      const win = await chrome.windows.create({ url, focused: true, width: 1480, height: 1000, type: 'normal' });
      winId = win.id; ownWindow = true;
      tabId = win.tabs[0].id;
      await waitComplete(tabId, 30000);
      await sleep(cfg.stepDelay);
      await assertLoggedIn(tabId);

      let page = await exec(tabId, pageInspect, [cs]);
      if (!page.isDetail && !page.hasResult) {
        if (cfg.searchUrlTemplate) throw new Error('검색 주소로 열었지만 결과에서 사건을 찾지 못했습니다. 확장프로그램 설정의 검색 주소를 확인해주세요.');
        const searchUrl = cfg.tankBase.replace(/\/$/, '') + cfg.searchPath;
        const tried = [];
        for (let attempt = 0; attempt < 3; attempt++) {
          progress(`사건번호 ${cs.full} 검색 중...` + (attempt ? ` (다른 검색칸으로 재시도 ${attempt + 1})` : ''));
          if (attempt) { await chrome.tabs.update(tabId, { url: searchUrl }); await waitSettle(tabId, 20000); await sleep(cfg.stepDelay); }
          const before = new Set((await chrome.tabs.query({})).map(t => t.id));
          const r = await exec(tabId, pageSearch, [cs, cfg.caseInputFormat, attempt]);
          tried.push(r.detail || r.error || '');
          if (!r.ok) { if (r.noMore) break; continue; }
          await waitSettle(tabId, 15000);
          await sleep(cfg.stepDelay);
          const found = await waitFor(tabId, async () => {
            const all = await chrome.tabs.query({});
            for (const t of all.filter(t => !before.has(t.id))) {
              try { const p = await exec(t.id, pageInspect, [cs]); if (p.isDetail) return { id: t.id, p }; } catch (e) {}
            }
            const p = await exec(tabId, pageInspect, [cs]);
            return (p.isDetail || p.hasResult) ? { id: tabId, p } : null;
          }, x => !!x, 12000);
          if (found) {
            if (found.id !== tabId) {
              const t = await chrome.tabs.get(found.id);
              if (ownWindow) { try { await chrome.tabs.remove(tabId); } catch (e) {} }
              tabId = found.id; winId = t.windowId; ownWindow = true;
              try { await chrome.windows.update(winId, { width: 1480, height: 1000, focused: true }); } catch (e) {}
            }
            page = found.p;
            break;
          }
        }
        if (!page || (!page.isDetail && !page.hasResult)) throw new Error(`검색 결과에서 ${cs.full}을(를) 찾지 못했습니다. 종결/취하된 사건이거나 검색 화면 인식에 실패했습니다. [진단: ${tried.filter(Boolean).join(' / ')}]`);
      }
      if (!page.isDetail) {
        progress('검색 결과에서 물건을 여는 중...');
        const before = await chrome.tabs.query({});
        const beforeIds = new Set(before.map(t => t.id));
        const clicked = await exec(tabId, pageOpenResult, [cs]);
        if (!clicked.ok) throw new Error(clicked.error);
        if (clicked.href) await chrome.tabs.update(tabId, { url: clicked.href });
        // 상세가 새 탭/팝업으로 열리는 경우와 같은 탭에서 열리는 경우 모두 대응
        const detail = await waitFor(tabId, async () => {
          const all = await chrome.tabs.query({});
          const fresh = all.filter(t => !beforeIds.has(t.id) && t.status === 'complete');
          for (const t of [...fresh, { id: tabId }]) {
            try { const p = await exec(t.id, pageInspect, [cs]); if (p.isDetail) return { id: t.id, p }; } catch (e) { /* 아직 로딩 중 */ }
          }
          return null;
        }, x => !!x, 25000);
        if (!detail) throw new Error('물건 상세 페이지가 열리지 않았습니다. 팝업 차단 여부를 확인해주세요.');
        if (detail.id !== tabId) {
          const t = await chrome.tabs.get(detail.id);
          if (ownWindow) { try { await chrome.tabs.remove(tabId); } catch (e) {} }
          tabId = detail.id; winId = t.windowId;
          // 팝업 창이면 폭을 넓혀 PC 화면 기준으로 캡처
          try { await chrome.windows.update(winId, { width: 1480, height: 1000, focused: true }); } catch (e) {}
          ownWindow = true;
        }
      }
    } else {
      const t = await chrome.tabs.get(tabId);
      winId = t.windowId;
      await chrome.windows.update(winId, { focused: true });
      await chrome.tabs.update(tabId, { active: true });
    }

    await waitComplete(tabId, 20000);
    await sleep(cfg.stepDelay);
    progress('상세 페이지 내용 불러오는 중...');
    await exec(tabId, pageLoadAll, []);
    await sleep(500);

    // 탱크옥션 자체 개인정보 가림(물건종류 배지 클릭 → 주소·이름 ○○○ 처리)
    let privacy = { state: 'off' };
    if (cfg.maskNames) {
      progress('탱크옥션 개인정보 가림 켜는 중...');
      privacy = await exec(tabId, pagePrivacyToggle, [false]);
      if (privacy.state === 'clicked') await sleep(700);
    }
    progress('캡처 영역 찾는 중' + (cfg.maskNames ? ' · 개인 이름 가림 처리' : '') + '...');
    const plan = await exec(tabId, pagePrepare, [cs, {
      capAuction: cfg.capAuction, capTenant: cfg.capTenant, capRegistry: cfg.capRegistry,
      tenantTitles: splitList(cfg.tenantTitles), registryTitles: splitList(cfg.registryTitles),
      maskNames: cfg.maskNames
    }]);
    if (!plan.regions.length) throw new Error('캡처할 영역을 찾지 못했습니다. (' + (plan.log || []).join(' / ') + ')');

    progress(`${plan.regions.map(r => r.label).join(', ')} 캡처 중...`);
    const shots = await captureRegions(tabId, plan.regions, () => progress('캡처 연결이 끊겨 다시 연결하는 중...'));
    try { await exec(tabId, pageRestore, []); } catch (e) {}
    // 원래 열려 있던 탭이면 가림 상태를 원래대로 되돌림
    if (privacy.state === 'clicked' && !ownWindow) { try { await exec(tabId, pagePrivacyToggle, [true]); } catch (e) {} }
    if (privacy.log) plan.log = [...(plan.log || []), privacy.log];

    return {
      ok: true,
      images: plan.regions.map((r, i) => ({ key: r.key, label: '탱크옥션 · ' + r.label, dataUrl: shots[i] })),
      fields: plan.fields,
      masked: plan.masked,
      missing: plan.missing,
      log: [...log, ...(plan.log || [])]
    };
  } finally {
    if (ownWindow && winId && !cfg.keepWindow) { try { await chrome.windows.remove(winId); } catch (e) {} }
    if (siteTab) {
      try { await chrome.windows.update(siteTab.windowId, { focused: true }); await chrome.tabs.update(siteTab.id, { active: true }); } catch (e) {}
    }
  }
}

function splitList(s) { return String(s || '').split(/[,\n]/).map(x => x.trim()).filter(Boolean); }
function fillTemplate(t, cs) {
  return t.replace(/\{year\}/g, cs.year).replace(/\{num\}/g, cs.num).replace(/\{caseEnc\}/g, encodeURIComponent(cs.full)).replace(/\{case\}/g, cs.full);
}

// 검색·클릭은 페이지와 같은 환경(MAIN)에서 실행해야 'javascript:' 링크/검색 함수가 정상 동작함
const MAIN_WORLD = new Set(['pageSearch', 'pageOpenResult', 'pagePrivacyToggle']);
async function exec(tabId, func, args) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func, args, world: MAIN_WORLD.has(func.name) ? 'MAIN' : 'ISOLATED' });
  if (!res) throw new Error('페이지 스크립트 실행 실패');
  return res.result;
}
async function waitComplete(tabId, timeout) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const t = await chrome.tabs.get(tabId);
    if (t.status === 'complete') return;
    await sleep(250);
  }
}
async function waitSettle(tabId, timeout) {
  await sleep(700);
  await waitComplete(tabId, timeout);
}
async function waitFor(tabId, probe, ok, timeout) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { const v = await probe(); if (ok(v)) return v; } catch (e) { /* 이동 중 */ }
    await sleep(600);
  }
  return null;
}
async function assertLoggedIn(tabId) {
  const r = await exec(tabId, () => {
    const pw = [...document.querySelectorAll('input[type=password]')].some(i => i.offsetParent !== null);
    const t = document.body ? document.body.innerText : '';
    return { loginForm: pw && /로그인/.test(t) && !/로그아웃/.test(t), loggedOut: !/로그아웃|마이페이지/.test(t) && /로그인/.test(t) };
  }, []);
  if (r.loginForm) throw new Error('탱크옥션 로그인이 필요합니다. 이 크롬에서 탱크옥션에 로그인한 뒤 다시 시도해주세요.');
}

async function findOpenDetailTab(cfg, cs) {
  const host = new URL(cfg.tankBase).host.replace(/^www\./, '');
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    if (!t.url) continue;
    let h = ''; try { h = new URL(t.url).host.replace(/^www\./, ''); } catch (e) { continue; }
    if (h !== host) continue;
    try { const p = await exec(t.id, pageInspect, [cs]); if (p.isDetail) return t.id; } catch (e) {}
  }
  return null;
}

/* ── 디버거(CDP)로 영역별 스크린샷: 화면 밖 영역도 한 장으로 캡처 ── */
// 크롬이 캡처 도중 연결을 끊으면 이유를 남겨 두었다가 안내 문구로 바꿈
const detachReason = new Map();
chrome.debugger.onDetach.addListener((src, reason) => { if (src.tabId) detachReason.set(src.tabId, reason); });
const DETACH_MESSAGES = {
  canceled_by_user: '캡처 중 탱크옥션 창 위쪽 "디버깅 중" 안내줄의 [취소]가 눌려 캡처가 중단되었습니다. 캡처가 끝날 때까지 안내줄은 그대로 두고 다시 시도해주세요.',
  target_closed: '캡처 중 탱크옥션 탭이 닫혔거나 다른 페이지로 이동했습니다. 캡처가 끝날 때까지 탱크옥션 창을 그대로 두고 다시 시도해주세요.'
};
const MAX_SHOT_H = 3000; // 아주 긴 영역은 이 높이(CSS px)씩 나눠 찍은 뒤 이어 붙임

async function captureRegions(tabId, regions, onRetry) {
  const target = { tabId };
  // 재연결 전에 같은 문서(이름 가림 상태 유지)인지 확인하기 위한 표식
  const token = Math.random().toString(36).slice(2);
  await exec(tabId, t => { window.__tcToken = t; return true; }, [token]);
  const send = (method, params) => new Promise((ok, no) => chrome.debugger.sendCommand(target, method, params || {}, r => chrome.runtime.lastError ? no(new Error(chrome.runtime.lastError.message)) : ok(r)));
  const attach = async () => {
    detachReason.delete(tabId);
    try { await chrome.debugger.attach(target, '1.3'); }
    catch (e) {
      throw new Error(/already attached/i.test(e.message || '')
        ? '탱크옥션 탭에 개발자도구(F12)나 다른 확장프로그램이 이미 연결되어 있습니다. 개발자도구를 닫거나 다른 확장프로그램을 잠시 끄고 다시 시도해주세요.'
        : '캡처 권한을 얻지 못했습니다. 탱크옥션 탭에서 개발자도구(F12)가 열려 있다면 닫고 다시 시도해주세요. (' + (e.message || e) + ')');
    }
    await send('Page.enable');
  };
  let attached = false, retried = false;
  try {
    await attach(); attached = true;
    const out = [];
    for (const r of regions) {
      for (;;) {
        try { out.push(await shootRegion(send, r)); break; }
        catch (e) {
          const reason = detachReason.get(tabId);
          if (!reason && !/not attached|detached/i.test(e.message || '')) throw e;
          attached = false;
          // 사용자가 취소했거나 페이지가 바뀌었으면(이름 가림이 풀렸을 수 있음) 다시 찍지 않음
          if (retried || reason === 'canceled_by_user' || !(await sameDocument(tabId, token))) {
            throw new Error(DETACH_MESSAGES[reason] || `캡처 중 크롬이 탱크옥션 탭 연결을 끊었습니다 (${reason || e.message}). 다시 시도해주세요.`);
          }
          retried = true;
          if (onRetry) onRetry();
          await sleep(500);
          await attach(); attached = true;
        }
      }
    }
    return out;
  } finally {
    if (attached) { try { await chrome.debugger.detach(target); } catch (e) {} }
  }
}
async function sameDocument(tabId, token) {
  try { return await exec(tabId, t => window.__tcToken === t, [token]); } catch (e) { return false; }
}
async function shootRegion(send, r) {
  const x = Math.max(0, r.x), top = Math.max(0, r.y), bottom = top + r.h;
  const parts = [];
  for (let y = top; y < bottom; y += MAX_SHOT_H) {
    const shot = await send('Page.captureScreenshot', {
      format: 'jpeg', quality: 88, captureBeyondViewport: true, fromSurface: true,
      clip: { x, y, width: r.w, height: Math.min(MAX_SHOT_H, bottom - y), scale: 1 }
    });
    parts.push(shot.data);
  }
  return parts.length === 1 ? 'data:image/jpeg;base64,' + parts[0] : stitch(parts);
}
// 나눠 찍은 JPEG(base64)들을 세로로 이어 붙여 한 장으로
async function stitch(parts) {
  const bmps = await Promise.all(parts.map(b64 => createImageBitmap(new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: 'image/jpeg' }))));
  const w = Math.max(...bmps.map(b => b.width)), h = bmps.reduce((a, b) => a + b.height, 0);
  const k = Math.min(1, 32000 / h); // 캔버스 최대 높이 제한
  const cv = new OffscreenCanvas(Math.round(w * k), Math.round(h * k)), ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  let y = 0;
  for (const b of bmps) { ctx.drawImage(b, 0, Math.round(y * k), Math.round(b.width * k), Math.round(b.height * k)); y += b.height; b.close(); }
  const buf = new Uint8Array(await (await cv.convertToBlob({ type: 'image/jpeg', quality: 0.88 })).arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return 'data:image/jpeg;base64,' + btoa(bin);
}

/* ── 설정 화면의 [열린 탱크옥션 탭 진단] ── */
async function diagnose() {
  const cfg = await getSettings();
  const host = new URL(cfg.tankBase).host.replace(/^www\./, '');
  const tabs = (await chrome.tabs.query({})).filter(t => { try { return new URL(t.url).host.replace(/^www\./, '') === host; } catch (e) { return false; } });
  if (!tabs.length) return { ok: false, error: '열려 있는 탱크옥션 탭이 없습니다. 물건 상세 페이지를 하나 열어두고 다시 눌러주세요.' };
  const results = [];
  for (const t of tabs) {
    try {
      const info = await exec(t.id, () => {
        const m = (document.body.innerText || '').match(/(\d{4})\s*타경\s*(\d+)/);
        return m ? { year: m[1], num: m[2], full: `${m[1]}타경${m[2]}` } : null;
      }, []);
      if (!info) { results.push({ url: t.url, note: '사건번호 없음 (검색/목록 페이지)' }); continue; }
      const plan = await exec(t.id, pagePrepare, [info, {
        capAuction: true, capTenant: true, capRegistry: true,
        tenantTitles: splitList(cfg.tenantTitles), registryTitles: splitList(cfg.registryTitles), maskNames: false, dryRun: true
      }]);
      results.push({ url: t.url, case: info.full, regions: plan.regions.map(r => `${r.label} ${Math.round(r.w)}×${Math.round(r.h)}`), missing: plan.missing, fields: plan.fields, log: plan.log });
    } catch (e) { results.push({ url: t.url, error: e.message }); }
  }
  return { ok: true, results };
}

/* ════════════ 아래 함수들은 탱크옥션 페이지 안에서 실행됩니다 ════════════ */

// 현재 페이지가 해당 사건의 상세인지 / 검색결과에 해당 사건이 있는지
function pageInspect(cs) {
  const txt = (document.body && document.body.innerText || '').replace(/\s/g, '');
  const has = txt.includes(cs.full) || txt.includes(`${cs.year}-${cs.num}`);
  const detailMarks = ['최저매각가격', '임차인현황', '매각기일', '감정가'].filter(k => txt.includes(k)).length;
  // 상세: 큰 제목에 사건번호 + 상세 표지 2개 이상
  let bigTitle = false;
  for (const el of document.querySelectorAll('h1,h2,h3,div,span,strong,b,p,td')) {
    const t = (el.innerText || '').replace(/\s/g, '');
    if (t.length > 40 || !t.includes(cs.full)) continue;
    if (parseFloat(getComputedStyle(el).fontSize) >= 20) { bigTitle = true; break; }
  }
  const keys = [cs.full, `${cs.year}-${cs.num}`];
  // 레이아웃용 큰 표의 행은 제외하고, 실제 결과 표의 행(다른 표를 품지 않은 행)만 본다
  const rowOf = a => { let r = a.closest('tr'); while (r && r.querySelector('table')) r = null; return r || a.closest('li'); };
  const resultLinks = has ? [...document.querySelectorAll('a,[onclick]')].filter(a => {
    const row = rowOf(a);
    const t = row ? (row.innerText || '').replace(/\s/g, '') : '';
    return keys.some(k => t.includes(k));
  }).length : 0;
  return { isDetail: has && bigTitle && detailMarks >= 2, hasResult: resultLinks > 0 && !(bigTitle && detailMarks >= 2), url: location.href };
}

// 검색 화면에서 사건번호 입력 후 검색
// 탱크옥션 검색 화면에는 '경매사건(상단 빠른검색)'과 '사건번호(상세검색)' 두 곳에 [연도 선택 + 타경 + 번호칸]이 있음.
// 연도 선택칸과 바로 뒤 번호칸을 한 쌍으로 찾아 점수순으로 시도(attempt번째 후보).
function pageSearch(cs, fmt, attempt) {
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const fire = el => ['input', 'change', 'keyup'].forEach(t => el.dispatchEvent(new Event(t, { bubbles: true })));
  const all = [...document.querySelectorAll('select,input,button,a,img')];
  const idx = el => all.indexOf(el);
  const yearSel = [...document.querySelectorAll('select')].filter(vis).filter(s => [...s.options].filter(o => /^\s*(19|20)\d{2}/.test(o.text)).length >= 3);
  const isText = i => i.tagName === 'INPUT' && /^(text|search|tel|number|)$/.test((i.getAttribute('type') || '').toLowerCase()) && vis(i) && !i.readOnly;
  const pairs = [];
  for (const sel of yearSel) {
    // 연도칸 뒤 10개 요소 안의 첫 번째 텍스트 입력칸 = 번호칸
    let input = null;
    for (let k = idx(sel) + 1; k < Math.min(all.length, idx(sel) + 12); k++) { if (isText(all[k])) { input = all[k]; break; } }
    if (!input) continue;
    let box = sel.parentElement; for (let d = 0; d < 4 && box && !box.contains(input); d++) box = box.parentElement;
    const ctx = ((box && box.innerText) || '').slice(0, 200);
    let score = 0;
    if (/사건번호/.test(ctx)) score += 4;
    if (/경매사건/.test(ctx)) score += 3;
    if (/타경/.test(ctx)) score += 3;
    if (/주소|소재지|물건명/.test(`${input.name} ${input.id} ${input.placeholder}`)) score -= 6;
    pairs.push({ sel, input, score, ctx: ctx.replace(/\s+/g, ' ').slice(0, 30) });
  }
  pairs.sort((a, b) => b.score - a.score);
  if (!pairs.length) return { ok: false, noMore: true, error: '검색 화면에서 사건번호 입력칸을 찾지 못했습니다.', detail: `연도칸 ${yearSel.length}개, 쌍 0개` };
  const pr = pairs[attempt];
  if (!pr) return { ok: false, noMore: true, detail: `후보 ${pairs.length}개 모두 시도` };
  const opt = [...pr.sel.options].find(o => o.value.trim() === cs.year || o.text.trim().startsWith(cs.year));
  if (!opt) return { ok: false, detail: `연도 ${cs.year} 없음` };
  pr.sel.value = opt.value; fire(pr.sel);
  const value = fmt === 'full' ? cs.full : fmt === 'dash' ? `${cs.year}-${cs.num}` : cs.num;
  pr.input.focus(); pr.input.value = value; fire(pr.input);
  // 검색 버튼: 번호칸 바로 뒤의 클릭 요소(버튼/이미지 버튼/이미지 링크)
  let btn = null;
  for (let k = idx(pr.input) + 1; k < Math.min(all.length, idx(pr.input) + 8); k++) {
    const el = all[k];
    if (!vis(el)) continue;
    if (el.tagName === 'SELECT' || isText(el)) break;
    if (el.tagName === 'BUTTON' || (el.tagName === 'INPUT' && /submit|image|button/i.test(el.type)) || (el.tagName === 'IMG' && (el.closest('a,button') || el.onclick || el.getAttribute('onclick'))) || (el.tagName === 'A' && (el.querySelector('img') || /검색|조회/.test(el.innerText)))) { btn = el.tagName === 'IMG' ? (el.closest('a,button') || el) : el; break; }
  }
  const detail = `후보${attempt + 1}/${pairs.length}[${pr.ctx}] 입력칸=${pr.input.name || pr.input.id || '?'} 버튼=${btn ? (btn.tagName + (btn.name ? ':' + btn.name : '')) : '없음'}`;
  // Enter 키 먼저(대부분 검색칸은 Enter로 검색됨) → 버튼 클릭 → 폼 제출
  ['keydown', 'keypress', 'keyup'].forEach(t => pr.input.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true })));
  if (btn) { btn.click(); return { ok: true, detail: detail + ' via=버튼' }; }
  if (pr.input.form) { pr.input.form.requestSubmit ? pr.input.form.requestSubmit() : pr.input.form.submit(); return { ok: true, detail: detail + ' via=폼' }; }
  return { ok: true, detail: detail + ' via=Enter' };
}

// 검색 결과 목록에서 해당 사건 열기
function pageOpenResult(cs) {
  const norm = s => (s || '').replace(/\s/g, '');
  const keys = [cs.full, `${cs.year}-${cs.num}`];
  const rowOf = a => { let r = a.closest('tr'); if (r && r.querySelector('table')) r = null; return r || a.closest('li'); };
  const cands = [...document.querySelectorAll('a,[onclick]')].filter(a => {
    const row = rowOf(a);
    return row && keys.some(k => norm(row.innerText).includes(k));
  }).sort((x, y) => norm(rowOf(x).innerText).length - norm(rowOf(y).innerText).length);
  if (!cands.length) return { ok: false, error: '검색 결과에서 물건 링크를 찾지 못했습니다.' };
  // 사건번호 글자가 직접 있는 링크 > 그 행의 첫 링크
  const el = cands.find(a => keys.some(k => norm(a.innerText).includes(k))) || cands.find(a => a.tagName === 'A') || cands[0];
  const href = el.tagName === 'A' ? el.getAttribute('href') : null;
  if (href && !/^javascript:|^#/.test(href) && !el.target && !el.getAttribute('onclick')) return { ok: true, href: new URL(href, location.href).href };
  el.click();
  return { ok: true };
}

// 탱크옥션 상세 상단의 물건종류 배지(예: '아파트')를 누르면 주소·소유자 등 개인정보가 ○○○로 가려짐.
// undo=false: 가려져 있지 않으면 배지를 눌러 가림 / undo=true: 다시 눌러 원래대로
async function pagePrivacyToggle(undo) {
  const KINDS = ['아파트', '오피스텔', '다세대', '빌라', '연립', '다가구', '단독주택', '주택', '도시형생활주택', '주상복합', '근린주택', '근린시설', '근린상가', '상가', '점포', '사무실', '토지', '대지', '임야', '전', '답', '공장', '아파트형공장', '창고', '숙박시설', '기타'];
  const norm = t => (t || '').replace(/\s/g, '');
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  // 사건번호 제목(가장 큰 글씨) 찾기
  let title = null, fs = 0;
  for (const el of document.querySelectorAll('h1,h2,h3,h4,div,span,strong,b,p')) {
    const t = norm(el.innerText);
    if (t.length > 40 || !/\d{4}타경\d+/.test(t) || !vis(el)) continue;
    const f = parseFloat(getComputedStyle(el).fontSize);
    if (f > fs) { title = el; fs = f; }
  }
  if (!title) return { state: 'notfound', log: '개인정보 가림: 제목 못 찾음' };
  const tr = title.getBoundingClientRect();
  // 제목 아래 250px 안의 상단 영역 텍스트에서 ○ 개수로 가림 여부 판단
  const topArea = () => {
    let n = 0;
    for (const el of document.querySelectorAll('td,span,div,p,b,strong,h3,h4')) {
      if (el.children.length > 3) continue;
      const r = el.getBoundingClientRect();
      if (r.top < tr.top - 10 || r.top > tr.bottom + 450) continue;
      n += ((el.innerText || '').match(/○/g) || []).length;
    }
    return n;
  };
  const before = topArea();
  const masked = before >= 4;
  if (!undo && masked) return { state: 'already', log: '개인정보 가림: 이미 가려져 있음' };
  if (undo && !masked) return { state: 'already' };
  // 배지: 제목 바로 아래, 물건종류 글자만 있는 작은 요소
  const cands = [...document.querySelectorAll('span,a,button,div,em,strong,b,label,li,p')].filter(el => {
    if (!vis(el)) return false;
    const t = norm(el.innerText);
    if (!KINDS.includes(t)) return false;
    const r = el.getBoundingClientRect();
    return r.top >= tr.top - 5 && r.top <= tr.bottom + 200 && r.width < 260;
  }).sort((a, b) => (parseFloat(getComputedStyle(b).fontSize) - parseFloat(getComputedStyle(a).fontSize)) || (a.contains(b) ? 1 : -1));
  const badge = cands[0];
  if (!badge) return { state: 'notfound', log: '개인정보 가림: 물건종류 배지 못 찾음' };
  const clickable = badge.closest('a,button,[onclick]') || badge;
  ['mousedown', 'mouseup'].forEach(t => clickable.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })));
  clickable.click();
  await new Promise(r => setTimeout(r, 600));
  let after = topArea();
  // 가리려고 눌렀는데 오히려 ○가 줄었으면(이미 가려진 상태였음) 다시 눌러 되돌림
  if (!undo && after < before) { clickable.click(); await new Promise(r => setTimeout(r, 600)); after = topArea(); return { state: 'already', log: `개인정보 가림: 이미 가려져 있어 원래대로 유지 (○ ${after})` }; }
  const ok = undo ? after < before : after > before;
  return { state: ok ? 'clicked' : 'nochange', log: `개인정보 가림: 배지('${norm(badge.innerText)}') 클릭 ${ok ? '성공' : '했지만 변화 없음'} (○ ${before}→${after})` };
}

// 지연 로딩 영역이 모두 나오도록 끝까지 천천히 스크롤
async function pageLoadAll() {
  const step = Math.max(400, window.innerHeight * 0.8);
  for (let y = 0, n = 0; y < document.documentElement.scrollHeight && n < 40; y += step, n++) {
    window.scrollTo(0, y);
    await new Promise(r => setTimeout(r, 150));
  }
  window.scrollTo(0, 0);
  await new Promise(r => setTimeout(r, 300));
  return true;
}

// 이름 가림 + 고정 헤더 숨김 + 캡처 영역 계산 + 주요 값 읽기
function pagePrepare(cs, opt) {
  const log = [], regions = [], missing = [];
  const norm = s => (s || '').replace(/\s/g, '');
  const rectOf = el => { const r = el.getBoundingClientRect(); return { l: r.left + scrollX, t: r.top + scrollY, r: r.right + scrollX, b: r.bottom + scrollY }; };
  const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  window.scrollTo(0, 0);

  // ── 1. 고정(fixed/sticky) 요소 숨김: 캡처 시 위에 겹치지 않도록 ──
  if (!opt.dryRun) {
    for (const el of document.querySelectorAll('body *')) {
      const p = getComputedStyle(el).position;
      if ((p === 'fixed' || p === 'sticky') && visible(el)) { el.dataset.tcHidden = el.style.visibility || '-'; el.style.visibility = 'hidden'; }
    }
  }

  // ── 2. 표 읽기 도우미 ──
  const tables = [...document.querySelectorAll('table')].filter(visible);
  const leafTables = tables.filter(t => !t.querySelector('table'));
  const headerIdx = (table, names) => {
    const row = table.rows[0]; if (!row) return -1;
    let col = 0;
    for (const c of row.cells) { if (names.includes(norm(c.innerText))) return col; col += c.colSpan || 1; }
    return -1;
  };
  const colCells = (table, idx) => {
    const out = [];
    for (let i = 1; i < table.rows.length; i++) {
      let col = 0;
      for (const c of table.rows[i].cells) { if (col === idx) { out.push(c); break; } col += c.colSpan || 1; }
    }
    return out;
  };
  const kvCell = label => {
    for (const c of document.querySelectorAll('th,td')) {
      if (norm(c.innerText) === label && visible(c)) { const n = c.nextElementSibling; if (n) return n; }
    }
    return null;
  };

  // ── 3. 개인 이름 가림 (소유자·채무자·임차인·권리자 중 사람 이름으로 보이는 값) ──
  let masked = 0;
  if (opt.maskNames && !opt.dryRun) {
    const STOP = ['없음', '미상', '소유자', '채무자', '채권자', '임차인', '권리자', '공유자', '본인', '국가', '해당없음', '미등기', '확인불가'];
    const isPerson = s => {
      s = (s || '').trim().replace(/\s*외\s*\d+\s*(명|인)?$/, '');
      return /^[가-힣]{2,4}$/.test(s) && !STOP.includes(s);
    };
    const names = new Set();
    const addFrom = cell => { if (!cell) return; for (const part of (cell.innerText || '').split(/[\n,·]/)) { const v = part.trim().replace(/\s*외\s*\d+\s*(명|인)?$/, ''); if (isPerson(v)) names.add(v); } };
    ['소유자', '채무자', '채권자'].forEach(l => addFrom(kvCell(l)));
    for (const t of leafTables) {
      for (const h of [['임차인', '임차인명', '점유자'], ['권리자', '권리자명'], ['소유자']]) {
        const i = headerIdx(t, h); if (i >= 0) colCells(t, i).forEach(addFrom);
      }
    }
    const maskOf = n => n[0] + '○'.repeat(n.length - 1);
    if (names.size) {
      const re = new RegExp([...names].sort((a, b) => b.length - a.length).join('|'), 'g');
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const n of nodes) {
        if (!re.test(n.nodeValue)) continue; re.lastIndex = 0;
        if (!n.parentElement || /SCRIPT|STYLE|TEXTAREA/.test(n.parentElement.tagName)) continue;
        (window.__tcOrig = window.__tcOrig || []).push([n, n.nodeValue]);
        n.nodeValue = n.nodeValue.replace(re, m => { masked++; return maskOf(m); });
      }
    }
    log.push(`이름 ${names.size}명 가림`);
  }

  // ── 4. 영역 찾기 ──
  const pad = 10, MAXH = 3200;
  const pushRegion = (key, label, box) => {
    const w = Math.min(box.r - box.l + pad * 2, 1600), h = Math.min(box.b - box.t + pad * 2, MAXH);
    if (w > 50 && h > 30) regions.push({ key, label, x: Math.round(box.l - pad), y: Math.round(box.t - pad), w: Math.round(w), h: Math.round(h) });
  };
  const union = els => els.map(rectOf).reduce((a, b) => ({ l: Math.min(a.l, b.l), t: Math.min(a.t, b.t), r: Math.max(a.r, b.r), b: Math.max(a.b, b.b) }));
  // 섹션 제목 찾기: 후보 제목을 앞에서부터 순서대로 시도.
  // '임차인 현황  말소기준일…'처럼 제목 옆에 부가설명이 붙은 경우도 인식 (요소 자체의 텍스트 기준)
  const ownText = el => norm([...el.childNodes].filter(n => n.nodeType === 3).map(n => n.nodeValue).join(''));
  const fsOf = el => parseFloat(getComputedStyle(el).fontSize) || 0;
  const findHeading = titles => {
    for (const raw of titles) {
      const x = norm(raw);
      const cands = [];
      for (const el of document.querySelectorAll('body *')) {
        if (/^(SCRIPT|STYLE|TABLE|TBODY|THEAD|TR|A|BUTTON|OPTION|SELECT|LABEL)$/.test(el.tagName) || el.closest('nav,header,#gnb,.gnb,a,button')) continue;
        if (!visible(el)) continue;
        const t = norm(el.innerText);
        if (!t || t.length > 80 || !t.startsWith(x)) continue;
        const o = ownText(el);
        let rank = 0;
        if (t === x) rank = 3;
        else if (o === x || (o.startsWith(x) && o.length <= x.length + 2)) rank = 2;
        else if (t.length <= x.length + 40 && !/^(TD|TH)$/.test(el.tagName)) rank = 1;
        if (!rank) continue;
        if (/^(TD|TH)$/.test(el.tagName) && rank < 2) continue;
        cands.push({ el, rank, fs: fsOf(el) });
      }
      if (!cands.length) continue;
      // 제목답게 글자가 큰 것 우선 → 일치도 → 더 안쪽 요소
      cands.sort((a, b) => (b.fs - a.fs) || (b.rank - a.rank) || (a.el.contains(b.el) ? 1 : b.el.contains(a.el) ? -1 : 0));
      return cands[0].el;
    }
    return null;
  };
  const allTitles = [...opt.tenantTitles, ...opt.registryTitles, '토지등기', '매각사례', '감정평가', '현황조사', '매각물건명세', '예상배당', '관련사건', '인근', '물건사진', '사진', '주의사항', '건축물대장'];
  const headingsBelow = (y, minFs = 0) => {
    const hs = [];
    for (const t of allTitles) { const h = findHeading([t]); if (h && fsOf(h) >= minFs * 0.85) { const r = rectOf(h); if (r.t > y + 5) hs.push(r.t); } }
    return hs.length ? Math.min(...hs) : Infinity;
  };

  // 4-1. 경매정보 (상단: 사건번호 제목 ~ 매각기일 표)
  let auctionBox = null, auctionAnc = null;
  if (opt.capAuction) {
    let title = null, size = 0;
    for (const el of document.querySelectorAll('h1,h2,h3,h4,div,span,strong,b,p')) {
      const t = norm(el.innerText);
      if (t.length > 40 || !t.includes(cs.full) || !visible(el)) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs > size || (fs === size && title && title.contains(el))) { title = el; size = fs; }
    }
    if (title) {
      // 제목이 '경매' 글자와 나뉘어 있으면 부모까지 포함
      let head = title;
      while (head.parentElement && norm(head.parentElement.innerText).length <= norm(title.innerText).length + 6) head = head.parentElement;
      const tr = rectOf(head);
      const dateTable = leafTables.find(t => { const x = norm(t.innerText); return x.includes('최저매각가격') && x.includes('매각기일') && rectOf(t).t > tr.t; })
        || leafTables.find(t => norm(t.innerText).includes('최저매각') && rectOf(t).t > tr.t);
      const kv = leafTables.find(t => { const x = norm(t.innerText); return x.includes('감정가') && x.includes('최저가') && rectOf(t).t > tr.t; });
      const parts = [head, ...(dateTable ? [dateTable] : []), ...(kv ? [kv] : [])];
      let box = union(parts);
      // 좌우 폭은 공통 컨테이너 기준
      let anc = head; while (anc && parts.some(p => !anc.contains(p))) anc = anc.parentElement;
      auctionAnc = anc && anc !== document.body ? anc : head.parentElement;
      if (!dateTable) { box.b = Math.min(Math.max(box.b, tr.t + 900), headingsBelow(tr.t) - 12); log.push('매각기일 표 못 찾음 → 제목 아래 고정 높이'); }
      auctionBox = box;
      pushRegion('auction', '경매정보', box);
    } else { missing.push('경매정보'); log.push('사건번호 제목 못 찾음'); }
  }

  // 4-2. 제목 + 아래 표들 (임차인 현황 / 등기)
  const sectionBox = (titles, key, label) => {
    const h = findHeading(titles);
    if (!h) { missing.push(label); log.push(`'${titles[0]}' 제목 못 찾음`); return; }
    let head = h;
    while (head.parentElement && !head.parentElement.querySelector('table') && norm(head.parentElement.innerText).length < 120) head = head.parentElement;
    const hr = rectOf(head);
    let limit = headingsBelow(hr.t, fsOf(h));
    if (limit < hr.b + 40) limit = Infinity;
    const below = leafTables.map(t => ({ t, r: rectOf(t) })).filter(x => x.r.t >= hr.t - 2 && x.r.t < limit).sort((a, b) => a.r.t - b.r.t);
    const picked = [];
    for (const x of below) {
      if (!picked.length) { if (x.r.t - hr.b > 250) break; picked.push(x); continue; }
      const prev = picked[picked.length - 1].r;
      if (x.r.t - prev.b > 80) break;
      picked.push(x);
    }
    let box = picked.length ? union([head, ...picked.map(x => x.t)]) : { ...hr, b: Math.min(hr.b + 160, limit - 12) };
    if (box.b > limit - 4) box.b = limit - 12;
    const n0 = regions.length;
    pushRegion(key, label, box);
    if (regions.length === n0) { missing.push(label); log.push(`${label}: 영역 크기 이상 (${Math.round(box.r - box.l)}×${Math.round(box.b - box.t)})`); }
    if (!picked.length) log.push(`${label}: 표 없음(제목 아래만 캡처)`);
  };
  if (opt.capTenant) sectionBox(opt.tenantTitles, 'tenant', '임차인 현황');
  if (opt.capRegistry) sectionBox(opt.registryTitles, 'registry', '등기');

  // ── 5. 주요 값 읽기 (리포트 발송 전 체크·한 줄 요약용, 빈 칸만 채움) ──
  const fields = {};
  const topText = ((auctionAnc || document.body).innerText || '').slice(0, 6000);
  const toMan = s => { const d = (s || '').replace(/[^\d]/g, ''); return d.length >= 6 ? Math.round(parseInt(d, 10) / 10000) : null; };
  const firstMoney = s => { const m = (s || '').match(/\d{1,3}(?:,\d{3}){2,}/); return m ? toMan(m[0]) : null; };
  const sd = topText.match(/매각(?:일자|기일)\s*:?\s*(\d{4})[.\-](\d{2})[.\-](\d{2})/);
  if (sd) fields.sale_date = `${sd[1]}-${sd[2]}-${sd[3]}`;
  const court = (document.body.innerText.slice(0, 3000).match(/([가-힣]+(?:지방법원|지원))(?:\s*본원)?\s*\d+\s*계/) || [])[1];
  if (court) fields.court = court;
  const ap = kvCell('감정가'); if (ap) fields.appraisal = firstMoney(ap.innerText);
  const mp = kvCell('최저가'); if (mp) fields.min_price = firstMoney(mp.innerText);
  const dt = leafTables.find(t => norm(t.innerText).includes('최저매각가격'));
  if (dt) {
    const tx = dt.innerText;
    const skipped = (tx.match(/(\d+)\s*개\s*항목\]?\s*생략/) || [])[1];
    fields.fail_count = (tx.match(/유찰/g) || []).length + (skipped ? parseInt(skipped, 10) : 0);
  }
  const kinds = ['아파트', '오피스텔', '다세대', '빌라', '연립', '다가구', '단독주택', '도시형생활주택', '근린', '상가', '토지', '공장'];
  const pt = kinds.find(k => topText.slice(0, 600).includes(k));
  const addr = (topText.match(/(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주|전라|충청|경상)[가-힣]*\s+[가-힣]+(?:시|군|구)(?:\s+[가-힣]+(?:구|읍|면|동))?/) || [])[0];
  const hl = [addr, pt, fields.fail_count ? `유찰 ${fields.fail_count}회` : (dt ? '신건' : '')].filter(Boolean);
  if (hl.length >= 2) fields.headline = hl.join(' · ');

  // ── 추천 사유 자동 작성용 사실 정보 (사이트에서 문장으로 만듦) ──
  const facts = {};
  const fullAddr = (topText.match(/(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)[^\n(]{4,60}/) || [])[0];
  if (fullAddr) facts.address = fullAddr.trim();
  const pub = topText.match(/공시가\s*[:：]?\s*([0-9~∼.\-억천만원\s]*(?:이하|이상|미만|초과)?)/);
  if (pub && pub[1].trim()) facts.pubPrice = pub[1].replace(/\s+/g, '').trim();
  if (pt) facts.propType = pt;
  const colOf = (t, re) => { const h = t.rows[0] ? [...t.rows[0].cells] : []; let col = 0; for (const c of h) { if (re.test(norm(c.innerText))) return col; col += c.colSpan || 1; } return -1; };
  const cellAt = (row, i) => { let col = 0; for (const c of row.cells) { if (col === i) return (c.innerText || '').replace(/\s+/g, ' ').trim(); col += c.colSpan || 1; } return ''; };
  // 등기: 말소기준권리와 소멸되지 않는(인수) 권리
  for (const t of leafTables) {
    const ki = colOf(t, /^권리종류/), di = colOf(t, /^접수일/), xi = colOf(t, /^소멸/);
    if (ki < 0 || di < 0) continue;
    const assumed = [];
    for (let r = 1; r < t.rows.length; r++) {
      const row = t.rows[r], tx = norm(row.innerText), kind = cellAt(row, ki), date = (cellAt(row, di).match(/\d{4}[.\-]\d{2}[.\-]\d{2}/) || [])[0] || '';
      if (!facts.baseRight && tx.includes('말소기준')) facts.baseRight = { kind: kind.replace(/설정$/, ''), date };
      if (xi >= 0 && kind && !/소유권|소유자|경매개시|임의경매|강제경매|공유자/.test(norm(kind)) && !/소멸/.test(cellAt(row, xi)) && !tx.includes('말소기준')) assumed.push(kind);
    }
    if (facts.baseRight) { if (xi >= 0) facts.assumedRights = assumed; break; }
  }
  // 임차인 현황: 인원·대항력
  const tt = leafTables.find(t => colOf(t, /^임차인/) >= 0 && colOf(t, /대항력/) >= 0);
  if (tt) {
    const ni = colOf(tt, /^임차인/), di = colOf(tt, /대항력/);
    let n = 0, dh = 0;
    for (let r = 1; r < tt.rows.length; r++) {
      const nm = cellAt(tt.rows[r], ni);
      if (!nm || /없음|해당없/.test(nm)) continue;
      n++; if (/있음|유/.test(cellAt(tt.rows[r], di))) dh++;
    }
    facts.tenants = n; facts.tenantsWithPriority = dh;
  } else if (/임차인\s*현황/.test(document.body.innerText) && /(임차|임대차)\s*(내역|관계)?\s*(이|은)?\s*없/.test(document.body.innerText)) {
    facts.tenants = 0; facts.tenantsWithPriority = 0;
  }
  if (/폐문/.test(document.body.innerText)) facts.closedDoor = true;
  fields.auto_facts = JSON.stringify(facts);

  // 인근 낙찰가율: '매각사례' 표(구분 | 평균감정가 | 평균매각가 | 평균매각가율 | …)에서
  // 기간별 평균매각가율의 최저~최고를 범위로 표시. 예) 83.4% ~ 87.2% (최근 12개월 17건 · 경기 고양시 … 아파트)
  const rateTables = leafTables.filter(t => t.rows[0] && [...t.rows[0].cells].some(c => /매각가율|낙찰가율/.test(norm(c.innerText))));
  for (const t of rateTables) {
    const hdr = [...t.rows[0].cells].map(c => norm(c.innerText));
    const ri = hdr.findIndex(h => /매각가율|낙찰가율/.test(h));
    const rates = [];
    let maxCnt = 0, maxLabel = '';
    for (let i = 1; i < t.rows.length; i++) {
      const cells = [...t.rows[i].cells].map(c => (c.innerText || '').replace(/\s+/g, ' ').trim());
      if (cells.length !== hdr.length) continue;
      const v = parseFloat((cells[ri].match(/\d{1,3}(?:\.\d+)?/) || [])[0]);
      if (!Number.isFinite(v) || v <= 0 || v > 300) continue;
      rates.push(v);
      const cnt = parseInt((cells[0].match(/(\d+)\s*건/) || [])[1] || '0', 10);
      if (cnt >= maxCnt) { maxCnt = cnt; maxLabel = cells[0].replace(/\(\s*\d+\s*건\s*\)/, '').replace(/^최근\s*(\d)/, '최근 $1').trim(); }
    }
    if (!rates.length) continue;
    const f = v => (Math.round(v * 10) / 10).toString().replace(/\.0$/, '') + '%';
    const lo = Math.min(...rates), hi = Math.max(...rates);
    // 표 위 제목 줄의 괄호 안 지역·유형 (예: '(경기 고양시 일산서구 주엽동 아파트)')
    let area = '';
    for (let p = t, hops = 0; p && hops < 4 && !area; hops++) {
      let q = p.previousElementSibling;
      for (let k = 0; q && k < 3 && !area; k++, q = q.previousElementSibling) {
        const m = (q.innerText || '').match(/\(([^()]{4,40})\)/);
        if (m && /[가-힣]/.test(m[1]) && !/건\)?$/.test(m[1])) area = m[1].trim();
      }
      p = p.parentElement;
    }
    const basis = [maxLabel && maxCnt ? `${maxLabel} ${maxCnt}건` : '', area].filter(Boolean).join(' · ');
    fields.win_rate = (lo === hi ? f(lo) : `${f(lo)} ~ ${f(hi)}`) + (basis ? ` (${basis})` : '');
    log.push('매각사례 낙찰가율 인식');
    break;
  }
  if (!fields.win_rate) log.push('매각사례(낙찰가율) 표 못 찾음');

  return { regions, fields, masked, missing, log };
}

// 캡처 후 페이지를 원래대로 (이름·고정 요소 복원)
function pageRestore() {
  for (const [n, v] of window.__tcOrig || []) { try { n.nodeValue = v; } catch (e) {} }
  window.__tcOrig = [];
  for (const el of document.querySelectorAll('[data-tc-hidden]')) { el.style.visibility = el.dataset.tcHidden === '-' ? '' : el.dataset.tcHidden; delete el.dataset.tcHidden; }
  return true;
}
