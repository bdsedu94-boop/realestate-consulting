// 수강생 컨설팅 화면 — 공통: 상태(students 등)·서버 API 호출·동기화 표시·수강생 목록 불러오기
// (일반 script: 함수·변수는 다른 app/*.js 와 전역으로 공유, index.html 에서 순서대로 불러옴)
const { fmt, tierLabel, formatBidNarrative, appendCreditCheckNote, formatBidNarrativeCSV, consult } = InvestmentRules;
/* ── 투자 유형 ── */
/* ── 초기 데이터 ── */
// 수강생 정보는 인증된 서버 API에서만 불러옵니다. 공개 코드에 개인별 자료를 포함하지 않습니다.
const BASE = [];

let students = [],
  editId = null,
  curView = 'card',
  debounceTimer = null,
  previewMode = false;

/* ── 동기화 상태 ── */
function setSyncBar(cls, msg) {
  document.getElementById('syncBar').className = 'sync-bar ' + cls;
  document.getElementById('syncMsg').textContent = msg;
}
function timeStr() {
  return new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}
function debounceLoad() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(loadStudents, 300);
}

/* ── API 호출 ── */
async function api(url, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
  try {
    const json = JSON.parse(text);
    if (!res.ok) throw new Error(json.error || `서버 오류 (${res.status})`);
    return json;
  } catch (e) {
    if (!res.ok) throw new Error(`서버에 연결할 수 없습니다 (HTTP ${res.status})`);
    throw e;
  }
}

/* ── 수강생 로드 ── */
async function loadStudents() {
  const c = document.getElementById('fC').value,
    h = document.getElementById('fH').value;
  const q = document.getElementById('fQ').value.trim();

  if (previewMode) {
    // 미리보기 모드: 클라이언트 필터링
    let list = BASE.map((d, i) => ({ ...d, id: i + 1 }));
    if (c) list = list.filter(s => s.cohort === c);
    if (h) list = list.filter(s => s.housing_type === h);
    if (q) list = list.filter(s => s.name && s.name.includes(q));
    students = list;
    render();
    return;
  }

  setSyncBar('sync-syncing', '불러오는 중...');
  try {
    const params = new URLSearchParams();
    if (c) params.set('cohort', c);
    if (h) params.set('housing_type', h);
    if (q) params.set('search', q);
    students = await api('/api/students?' + params);
    if (window.RecReport) await RecReport.loadSummary();
    setSyncBar('sync-ok', '마지막 동기화: ' + timeStr());
    await loadCohorts();
    render();
  } catch (e) {
    if (!previewMode) setSyncBar('sync-error', '⚠ 오류: ' + e.message);
  }
}

async function loadCohorts() {
  try {
    const cohorts = previewMode ? [...new Set(BASE.map(s => s.cohort))].sort() : await api('/api/cohorts');
    const sel = document.getElementById('fC'),
      cur = sel.value;
    sel.innerHTML =
      '<option value="">전체 기수</option>' + cohorts.map(c => `<option value="${c}">${c}</option>`).join('');
    if (cohorts.includes(cur)) sel.value = cur;
  } catch (e) {}
}

/* ── 서버에 보관된 수강생 데이터 불러오기 ── */
async function initData() {
  await loadStudents();
}
