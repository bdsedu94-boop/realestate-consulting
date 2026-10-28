const DEFAULTS = {
  tankBase: 'https://www.tankauction.com', searchPath: '/ca/caList.php', searchUrlTemplate: '', caseInputFormat: 'auto',
  capAuction: true, capTenant: true, capRegistry: true,
  tenantTitles: '임차인 현황, 임차인현황', registryTitles: '건물등기, 집합건물등기, 건물 등기, 토지등기, 등기부 현황',
  maskNames: true, keepWindow: false, stepDelay: 900
};
const ids = ['tankBase', 'searchUrlTemplate', 'caseInputFormat', 'capAuction', 'capTenant', 'capRegistry', 'tenantTitles', 'registryTitles', 'maskNames', 'keepWindow'];
const $ = id => document.getElementById(id);
function fill(s) { for (const k of ids) { const el = $(k); if (el.type === 'checkbox') el.checked = !!s[k]; else el.value = s[k] ?? ''; } }
chrome.storage.sync.get(DEFAULTS, fill);
$('save').onclick = () => {
  const s = {}; for (const k of ids) { const el = $(k); s[k] = el.type === 'checkbox' ? el.checked : el.value.trim(); }
  if (!s.tankBase) s.tankBase = DEFAULTS.tankBase;
  chrome.storage.sync.set(s, () => { $('msg').textContent = '저장되었습니다'; setTimeout(() => $('msg').textContent = '', 2000); });
};
$('reset').onclick = () => { fill(DEFAULTS); chrome.storage.sync.set(DEFAULTS); $('msg').textContent = '기본값으로 되돌렸습니다'; };
$('diag').onclick = () => {
  $('out').style.display = 'block'; $('out').textContent = '진단 중...';
  chrome.runtime.sendMessage({ type: 'DIAGNOSE' }, r => { $('out').textContent = JSON.stringify(r, null, 2); });
};
