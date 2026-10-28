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
        progress(`사건번호 ${cs.full} 검색 중...`);
        const r = await exec(tabId, pageSearch, [cs, cfg.caseInputFormat]);
        if (!r.ok) throw new Error(r.error);
        await waitSettle(tabId, 15000);
        await sleep(cfg.stepDelay);
        page = await waitFor(tabId, () => exec(tabId, pageInspect, [cs]), p => p.isDetail || p.hasResult, 15000);
        if (!page || (!page.isDetail && !page.hasResult)) throw new Error(`검색 결과에서 ${cs.full}을(를) 찾지 못했습니다. 종결/취하된 사건이거나 검색 화면 구조가 바뀌었을 수 있습니다.`);
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

    progress('캡처 영역 찾는 중' + (cfg.maskNames ? ' · 개인 이름 가림 처리' : '') + '...');
    const plan = await exec(tabId, pagePrepare, [cs, {
      capAuction: cfg.capAuction, capTenant: cfg.capTenant, capRegistry: cfg.capRegistry,
      tenantTitles: splitList(cfg.tenantTitles), registryTitles: splitList(cfg.registryTitles),
      maskNames: cfg.maskNames
    }]);
    if (!plan.regions.length) throw new Error('캡처할 영역을 찾지 못했습니다. (' + (plan.log || []).join(' / ') + ')');

    progress(`${plan.regions.map(r => r.label).join(', ')} 캡처 중...`);
    const shots = await captureRegions(tabId, plan.regions);
    try { await exec(tabId, pageRestore, []); } catch (e) {}

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

async function exec(tabId, func, args) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
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
async function captureRegions(tabId, regions) {
  const target = { tabId };
  try { await chrome.debugger.attach(target, '1.3'); }
  catch (e) { throw new Error('캡처 권한을 얻지 못했습니다. 탱크옥션 탭에서 개발자도구(F12)가 열려 있다면 닫고 다시 시도해주세요.'); }
  const send = (method, params) => new Promise((ok, no) => chrome.debugger.sendCommand(target, method, params || {}, r => chrome.runtime.lastError ? no(new Error(chrome.runtime.lastError.message)) : ok(r)));
  try {
    await send('Page.enable');
    const out = [];
    for (const r of regions) {
      const shot = await send('Page.captureScreenshot', {
        format: 'jpeg', quality: 88, captureBeyondViewport: true, fromSurface: true,
        clip: { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.w, height: r.h, scale: 1 }
      });
      out.push('data:image/jpeg;base64,' + shot.data);
    }
    return out;
  } finally {
    try { await chrome.debugger.detach(target); } catch (e) {}
  }
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
  const resultLinks = has ? [...document.querySelectorAll('a,[onclick]')].filter(a => {
    const row = a.closest('tr,li') || a.parentElement;
    return row && (row.innerText || '').replace(/\s/g, '').includes(cs.full);
  }).length : 0;
  return { isDetail: has && bigTitle && detailMarks >= 2, hasResult: resultLinks > 0 && !(bigTitle && detailMarks >= 2), url: location.href };
}

// 검색 화면에서 사건번호 입력 후 검색
function pageSearch(cs, fmt) {
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const near = el => { const c = el.closest('td,th,li,dd,dl,label,div'); return ((c && c.innerText) || '').slice(0, 80); };
  const fire = el => ['input', 'change', 'keyup'].forEach(t => el.dispatchEvent(new Event(t, { bubbles: true })));
  // 사건년도 선택칸
  const ysel = [...document.querySelectorAll('select')].filter(vis).find(s => {
    const opts = [...s.options];
    return opts.some(o => o.value.trim() === cs.year || o.text.trim().startsWith(cs.year)) && opts.filter(o => /^\d{4}/.test(o.text.trim())).length >= 3;
  });
  // 사건번호 입력칸 점수 매기기
  const inputs = [...document.querySelectorAll('input[type=text],input[type=search],input[type=tel],input[type=number],input:not([type])')].filter(vis);
  let best = null, bestScore = 0;
  for (const i of inputs) {
    let s = 0;
    const meta = `${i.name} ${i.id} ${i.placeholder} ${i.title}`;
    if (/사건/.test(meta)) s += 6;
    if (/sa_?no|saNo|case|sno|tno|evt|event/i.test(meta)) s += 4;
    if (/사건번호/.test(near(i))) s += 5;
    if (ysel && (ysel.closest('td,li,div') === i.closest('td,li,div'))) s += 4;
    if (/주소|소재지|이름|아이디|비밀|addr|keyword/i.test(meta)) s -= 6;
    if (s > bestScore) { best = i; bestScore = s; }
  }
  if (!best) return { ok: false, error: '검색 화면에서 사건번호 입력칸을 찾지 못했습니다. 확장프로그램 설정에서 "검색 주소"를 지정해주세요.' };
  let value;
  if (fmt === 'full') value = cs.full;
  else if (fmt === 'dash') value = `${cs.year}-${cs.num}`;
  else if (fmt === 'num') value = cs.num;
  else value = ysel ? cs.num : cs.full;
  if (ysel) { const o = [...ysel.options].find(o => o.value.trim() === cs.year || o.text.trim().startsWith(cs.year)); ysel.value = o.value; fire(ysel); }
  best.focus(); best.value = value; fire(best);
  // 검색 버튼
  const scope = best.form || best.closest('form,table,div');
  const btns = [...(scope ? scope.querySelectorAll('button,input[type=submit],input[type=image],input[type=button],a,img') : [])].filter(vis);
  const btn = btns.find(b => /검색|조회|찾기|search/i.test(`${b.innerText || ''} ${b.value || ''} ${b.alt || ''} ${b.title || ''} ${b.id || ''} ${b.className || ''}`));
  if (btn) { btn.click(); return { ok: true, via: 'button' }; }
  if (best.form) { best.form.requestSubmit ? best.form.requestSubmit() : best.form.submit(); return { ok: true, via: 'form' }; }
  ['keydown', 'keypress', 'keyup'].forEach(t => best.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })));
  return { ok: true, via: 'enter' };
}

// 검색 결과 목록에서 해당 사건 열기
function pageOpenResult(cs) {
  const norm = s => (s || '').replace(/\s/g, '');
  const cands = [...document.querySelectorAll('a,[onclick]')].filter(a => {
    const row = a.closest('tr,li') || a.parentElement;
    return row && norm(row.innerText).includes(cs.full);
  });
  if (!cands.length) return { ok: false, error: '검색 결과에서 물건 링크를 찾지 못했습니다.' };
  // 사건번호 글자가 직접 있는 링크 > 그 행의 첫 링크
  const el = cands.find(a => norm(a.innerText).includes(cs.full)) || cands.find(a => a.tagName === 'A') || cands[0];
  const href = el.tagName === 'A' ? el.getAttribute('href') : null;
  if (href && !/^javascript:|^#/.test(href) && !el.target && !el.getAttribute('onclick')) return { ok: true, href: new URL(href, location.href).href };
  el.click();
  return { ok: true };
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
    for (const t of tables) {
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
  const findHeading = titles => {
    for (const raw of titles) {
      const x = norm(raw);
      let exact = null, own = null, prefix = null;
      for (const el of document.querySelectorAll('body *')) {
        if (/^(SCRIPT|STYLE|TABLE|TBODY|TR|TD|TH|A|BUTTON|OPTION|SELECT)$/.test(el.tagName) || el.closest('table,nav,header,#gnb,.gnb')) continue;
        if (!visible(el)) continue;
        const t = norm(el.innerText);
        if (!t || t.length > 80 || !t.startsWith(x)) continue;
        if (t === x) { if (!exact || exact.contains(el)) exact = el; continue; }
        const o = ownText(el);
        if (o === x || (o.startsWith(x) && o.length <= x.length + 2)) { if (!own || own.contains(el)) own = el; continue; }
        if (t.length <= x.length + 40 && (!prefix || prefix.contains(el))) prefix = el;
      }
      const hit = exact || own || prefix;
      if (hit) return hit;
    }
    return null;
  };
  const allTitles = [...opt.tenantTitles, ...opt.registryTitles, '토지등기', '매각사례', '감정평가', '현황조사', '매각물건명세', '예상배당', '관련사건', '인근', '물건사진', '사진', '주의사항', '건축물대장'];
  const headingsBelow = (y) => {
    const hs = [];
    for (const t of allTitles) { const h = findHeading([t]); if (h) { const r = rectOf(h); if (r.t > y + 5) hs.push(r.t); } }
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
      const dateTable = tables.find(t => { const x = norm(t.innerText); return x.includes('최저매각가격') && x.includes('매각기일') && rectOf(t).t > tr.t; })
        || tables.find(t => norm(t.innerText).includes('최저매각') && rectOf(t).t > tr.t);
      const kv = tables.find(t => { const x = norm(t.innerText); return x.includes('감정가') && x.includes('최저가') && rectOf(t).t > tr.t; });
      const parts = [head, ...(dateTable ? [dateTable] : []), ...(kv ? [kv] : [])];
      let box = union(parts);
      // 좌우 폭은 공통 컨테이너 기준
      let anc = head; while (anc && parts.some(p => !anc.contains(p))) anc = anc.parentElement;
      auctionAnc = anc && anc !== document.body ? anc : head.parentElement;
      if (anc && anc !== document.body) { const a = rectOf(anc); if (a.r - a.l <= 1600) { box.l = Math.min(box.l, a.l); box.r = Math.max(box.r, a.r); } }
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
    const limit = headingsBelow(hr.t);
    const below = tables.map(t => ({ t, r: rectOf(t) })).filter(x => x.r.t >= hr.t - 2 && x.r.t < limit && !x.t.parentElement.closest('table')).sort((a, b) => a.r.t - b.r.t);
    const picked = [];
    for (const x of below) {
      if (!picked.length) { if (x.r.t - hr.b > 250) break; picked.push(x); continue; }
      const prev = picked[picked.length - 1].r;
      if (x.r.t - prev.b > 80) break;
      picked.push(x);
    }
    let box = picked.length ? union([head, ...picked.map(x => x.t)]) : { ...hr, b: Math.min(hr.b + 160, limit - 12) };
    if (box.b > limit - 4) box.b = limit - 12;
    pushRegion(key, label, box);
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
  const dt = tables.find(t => norm(t.innerText).includes('최저매각가격'));
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

  // 인근 낙찰가율: '매각사례' 표(구분 | 평균감정가 | 평균매각가 | 평균매각가율 | …)에서
  // 기간별 평균매각가율의 최저~최고를 범위로 표시. 예) 83.4% ~ 87.2% (최근 12개월 17건 · 경기 고양시 … 아파트)
  const rateTables = tables.filter(t => t.rows[0] && [...t.rows[0].cells].some(c => /매각가율|낙찰가율/.test(norm(c.innerText))));
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
