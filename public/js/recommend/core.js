/* ═══════════════════════════════════════════════════════════════
 * 추천물건 리포트 — 기본 (상태·공통 기능·화면·저장)
 *  - 수강생별 추천물건 입력/관리 (작성중 → 검수완료 → 발송완료)
 *  금액 단위: 만원 (기존 수강생 데이터와 동일)
 *
 *  기능별 파일 (모두 이 파일 다음에 불러옴, RecCore로 기능을 주고받음)
 *   recommend/auto.js     추천 사유·권장 입찰가 자동 작성, 발송 전 확인
 *   recommend/mask.js     캡처 이미지 다듬기 (자르기 / 모자이크)
 *   recommend/capture.js  탱크옥션 자동 캡처 (크롬 확장프로그램 연동)
 *   recommend/pdf.js      리포트 PDF 만들기 (html2canvas + jsPDF)
 *   recommend/sheet.js    구글시트 요약 탭 → 추천물건 초안 일괄 생성
 *   infosheet/import.js   경매 정보지 PDF → 물건 자동 작성
 * ═══════════════════════════════════════════════════════════════ */
(function () {
  // 다른 기능 파일과 주고받는 내부 기능 모음
  const R = (window.RecCore = {});
  const PURPLE = '#9314cc',
    PURPLE_BG = '#f4e8fb';
  const REC_STATUS = ['작성중', '검수완료', '발송완료'];
  const REC_ST_STYLE = {
    작성중: 'background:#f0ede6;color:#5f5e5a',
    검수완료: 'background:#e6f1fb;color:#0c447c',
    발송완료: 'background:#eaf3de;color:#27500a'
  };
  const DISCLAIMER =
    '본 리포트는 탱크옥션 등 공개 자료를 기준으로 작성된 경매 물건 참고자료이며, 입찰 전 법원 서류 및 변경사항은 반드시 직접 재확인하시기 바랍니다.';
  const REASON_HINTS = [
    {
      title: '예: 투자 방향성에 맞는 비규제지역 물건',
      body: '예: 최저가 9,100만원으로 현금 + 신용대출 활용 시 올현금 입찰이 가능하며, 기존 주택 처분·전입 조건이 없습니다.'
    },
    {
      title: '예: 권리관계가 깨끗한 물건',
      body: '예: 말소기준권리(근저당) 이하 가압류까지 모두 소멸되고, 대항력 있는 임차인이 없어 인수할 권리가 없습니다.'
    },
    {
      title: '예: 시세·전세가 대비 낮은 최저가',
      body: '예: 동일 평형 최근 매매가 9,500만~1억 2,000만원, 전세가 1억 1,000만~1억 2,000만원 수준으로 1회 유찰된 현재 가격 메리트가 있습니다.'
    }
  ];

  let REC_SUMMARY = {};
  const st = { student: null, recs: [], cur: null, dirty: false };
  const AUTO_BTN = `style="font-size:11px;padding:3px 10px;border-color:${PURPLE};color:${PURPLE};font-weight:600"`;
  const HINT = 'style="font-size:11px;color:#888;font-weight:400"';

  /* ── 공통 유틸 ── */
  const esc = v =>
    String(v ?? '').replace(
      /[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  const escBr = v => esc(v).replace(/\n/g, '<br>');
  const num = v => (v === null || v === undefined || v === '' ? null : Number(v));
  // 1억 3,000만 / 9,100만 형식 (예시 리포트 표기)
  function man(v, suffix = '') {
    v = num(v);
    if (v === null || !Number.isFinite(v)) return '-';
    v = Math.round(v);
    if (v >= 10000) {
      const a = Math.floor(v / 10000),
        r = v % 10000;
      return r ? `${a}억 ${r.toLocaleString()}만${suffix}` : `${a}억${suffix ? '원' : ''}`;
    }
    return `${v.toLocaleString()}만${suffix}`;
  }
  const pct = (a, b) => (num(a) && num(b) ? Math.round((num(a) / num(b)) * 100) : null);
  function fmtDate(s) {
    if (!s) return '';
    const d = new Date(s + 'T00:00:00');
    if (isNaN(d)) return s;
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} (${'일월화수목금토'[d.getDay()]})`;
  }
  function todayStr() {
    const t = new Date();
    return `${t.getFullYear()}.${String(t.getMonth() + 1).padStart(2, '0')}.${String(t.getDate()).padStart(2, '0')}`;
  }
  function deposit(r) {
    const m = num(r.min_price);
    return m ? Math.round((m * (num(r.deposit_rate) || 10)) / 100) : null;
  }
  async function recApi(url, method = 'GET', body = null) {
    return api(url, method, body);
  } // index.html 의 api() 재사용

  // 캡처를 4MB 이하 JPEG로 정리 (가로 최대 1600px)
  function shrink(dataUrl, maxW = 1600) {
    return new Promise((ok, no) => {
      const im = new Image();
      im.onload = () => {
        let k = Math.min(1, maxW / im.width);
        let q = 0.86;
        const c = document.createElement('canvas');
        for (let t = 0; t < 6; t++) {
          c.width = Math.round(im.width * k);
          c.height = Math.round(im.height * k);
          const g = c.getContext('2d');
          g.fillStyle = '#fff';
          g.fillRect(0, 0, c.width, c.height);
          g.drawImage(im, 0, 0, c.width, c.height);
          const out = c.toDataURL('image/jpeg', q);
          if (out.length < 5.2e6) return ok(out);
          k *= 0.8;
          q = Math.max(0.7, q - 0.05);
        }
        no(new Error('캡처 이미지가 너무 큽니다.'));
      };
      im.onerror = () => no(new Error('캡처 이미지를 읽지 못했습니다.'));
      im.src = dataUrl;
    });
  }

  /* ── 스타일 & 모달 마크업 주입 ── */
  function injectUI() {
    const css = document.createElement('style');
    css.textContent = `
.rec-btn{height:32px;font-size:13px;padding:0 10px 0 12px;font-weight:600;white-space:nowrap;border-color:${PURPLE};color:${PURPLE};display:inline-flex;align-items:center;gap:6px}
.rec-btn:hover{background:${PURPLE_BG}}
.rec-btn .rec-chip{font-size:11px;font-weight:600}
.rec-chip{display:inline-block;font-size:12px;padding:2px 7px;border-radius:8px;font-weight:600}
#recModal .modal{width:min(980px,96vw)}
.rec-list{display:flex;flex-direction:column;gap:8px;margin-bottom:12px}
.rec-item{display:flex;align-items:center;gap:10px;border:0.5px solid rgba(0,0,0,0.12);border-radius:10px;padding:9px 12px;cursor:pointer;background:#fff}
.rec-item:hover,.rec-item.on{border-color:${PURPLE};background:#fcf8fe}
.rec-item .ri-no{font-size:11px;font-weight:700;color:#fff;background:${PURPLE};border-radius:10px;padding:2px 8px;flex-shrink:0}
.rec-item .ri-main{flex:1;min-width:0}
.rec-item .ri-case{font-size:13px;font-weight:700}
.rec-item .ri-sub{font-size:11px;color:#888;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rec-item .ri-pdf{flex-shrink:0;font-size:12px;padding:5px 10px;font-weight:600;border-color:${PURPLE};color:${PURPLE};white-space:nowrap}
.rec-item .ri-pdf:hover{background:${PURPLE_BG}}
.rec-ed h4{font-size:13px;font-weight:700;color:${PURPLE};margin:16px 0 8px;padding-left:8px;border-left:3px solid ${PURPLE}}
.rec-waiver{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:14px 0 4px;padding:9px 12px;border:1px solid #e3d3ee;border-radius:8px;background:#fcf8fe;font-size:13px;color:#333;cursor:pointer}
.rec-waiver input{width:auto!important;margin:0}
.rec-waiver span{font-size:11px;color:#999}
.rec-ed .fg{grid-template-columns:repeat(4,1fr)}
@media(max-width:720px){.rec-ed .fg{grid-template-columns:1fr 1fr}}
.rec-ed input,.rec-ed select,.rec-ed textarea{width:100%}
.rec-ed textarea{border:1px solid rgba(0,0,0,0.15);border-radius:7px;padding:6px 10px;font-size:13px;font-family:inherit;resize:vertical}
.rec-ed .calc{font-size:11px;color:${PURPLE};margin-top:3px;min-height:14px}
.rec-drop{border:1.5px dashed rgba(0,0,0,0.2);border-radius:10px;padding:14px;text-align:center;font-size:12px;color:#888;background:#fafaf8}
.rec-drop.over{border-color:${PURPLE};background:${PURPLE_BG}}
.rec-imgs{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin-top:10px}
.rec-auto{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px}
.rec-auto-st{font-size:12px;color:#666}
.rec-auto-st.err{color:#a32d2d}
.rec-opt{margin-top:14px;border:0.5px solid rgba(0,0,0,0.1);border-radius:8px;padding:8px 12px;background:#fcfcfb}
.rec-opt summary{cursor:pointer;font-size:12px;color:#666}
.ri-auto{position:absolute;top:6px;left:6px;font-size:11px;background:${PURPLE};color:#fff;border-radius:6px;padding:1px 6px}
.rec-img{position:relative;border:0.5px solid rgba(0,0,0,0.12);border-radius:8px;overflow:hidden;background:#fff}
.rec-img img{width:100%;height:130px;object-fit:cover;object-position:left top;display:block;background:#f3f3f3}
.rec-img .ri-bar{display:flex;gap:4px;padding:6px}
.rec-img .ri-bar input{flex:1;font-size:11px;padding:4px 6px}
.rec-img .ri-bar button{font-size:11px;padding:3px 7px}
.rec-check{border-radius:10px;padding:10px 12px;font-size:12px;line-height:1.7;margin-top:14px}
.rec-check.ok{background:#eaf3de;color:#27500a}
.rec-check.warn{background:#faeeda;color:#633806}
.rec-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:14px;position:sticky;bottom:-1.5rem;background:#fff;padding:10px 0 4px;border-top:0.5px solid rgba(0,0,0,0.08)}
.rec-p{background:${PURPLE};color:#fff;border-color:${PURPLE}}
.rec-p:hover{background:#7a10aa}
#maskModal .modal{width:min(1100px,96vw)}
#maskWrap{position:relative;overflow:auto;max-height:68vh;border:0.5px solid rgba(0,0,0,0.12);border-radius:8px;background:#eee}
#maskCanvas{display:block;cursor:crosshair;max-width:none}
#maskSel{position:absolute;border:2px dashed ${PURPLE};background:rgba(147,20,204,0.12);pointer-events:none;display:none}
.mask-tools{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
.mask-tools .on{background:#1a1a1a;color:#fff;border-color:#1a1a1a}
`;
    document.head.appendChild(css);

    const wrap = document.createElement('div');
    wrap.innerHTML = `
<div class="modal-bg" id="recModal">
  <div class="modal">
    <button class="modal-close" onclick="RecReport.close()">✕</button>
    <h3 id="recTitle">추천물건</h3>
    <div id="recBody"></div>
  </div>
</div>
<div class="modal-bg" id="maskModal" style="z-index:1000">
  <div class="modal">
    <button class="modal-close" onclick="RecReport.maskCancel()">✕</button>
    <h3>캡처 이미지 다듬기</h3>
    <div class="mask-tools">
      <button id="mtCrop" onclick="RecReport.maskMode('crop')">✂ 자르기</button>
      <button id="mtBlur" onclick="RecReport.maskMode('blur')">▦ 모자이크(가리기)</button>
      <button onclick="RecReport.maskUndo()">↶ 되돌리기</button>
      <span style="font-size:11px;color:#888">드래그로 영역 선택 · 자르기는 선택 후 [자르기 적용] · 임차인 이름 등 개인정보는 모자이크 처리</span>
      <button id="mtCropApply" onclick="RecReport.maskCropApply()" style="display:none">자르기 적용</button>
    </div>
    <div id="maskWrap"><canvas id="maskCanvas"></canvas><div id="maskSel"></div></div>
    <div style="display:flex;gap:8px;margin-top:12px;align-items:center">
      <input type="text" id="maskCaption" placeholder="이미지 설명 (예: 탱크옥션 · 경매 상세정보)" style="flex:1">
      <button class="rec-p" onclick="RecReport.maskDone()">이미지 추가</button>
      <button onclick="RecReport.maskCancel()">취소</button>
    </div>
  </div>
</div>`;
    document.body.appendChild(wrap);

    // 상단 버튼: 시트 추천물건 가져오기
    const ctrls = document.getElementById('ctrlActs') || document.querySelector('.ctrls');
    if (ctrls) {
      const b = document.createElement('button');
      b.textContent = '🏠 추천물건 시트';
      b.style.cssText = `background:#fff;color:${PURPLE};border-color:${PURPLE}`;
      b.title = '구글시트 요약 탭(엑셀로 다운로드)의 추천물건1~3 사건번호로 초안을 만듭니다';
      b.onclick = () => document.getElementById('recXlsxInput').click();
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.id = 'recXlsxInput';
      inp.accept = '.xlsx,.xls,.csv';
      inp.style.display = 'none';
      inp.onchange = () => R.importRecSheet(inp);
      // 작업 버튼 맨 끝에
      ctrls.appendChild(b);
      ctrls.appendChild(inp);
    }

    // 붙여넣기(Ctrl+V)로 캡처 추가
    document.addEventListener('paste', e => {
      if (!document.getElementById('recModal').classList.contains('show') || !st.cur) return;
      if (document.getElementById('maskModal').classList.contains('show')) return;
      const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
      if (!item) return;
      e.preventDefault();
      R.openMask(item.getAsFile());
    });
  }

  /* ── 카드 배지 ── */
  async function loadSummary() {
    try {
      REC_SUMMARY = await recApi('/api/recommendations/summary');
    } catch (e) {
      REC_SUMMARY = {};
    }
  }
  // 수강생 카드 오른쪽 위: 추천물건 현황 + [추천물건 리포트] 버튼
  function cardLine(d) {
    const s = REC_SUMMARY[d.id];
    const chips = s
      ? REC_STATUS.filter(k => s[k])
          .map(k => `<span class="rec-chip" style="${REC_ST_STYLE[k]}">${k} ${s[k]}</span>`)
          .join('')
      : '';
    return `<button class="rec-btn" onclick="RecReport.open(${d.id})" title="2차: 추천물건 리포트 작성·PDF">🏠 추천물건 리포트${chips}</button>`;
  }

  /* ── 모달 열기/닫기 ── */
  async function open(studentId) {
    const s = (typeof students !== 'undefined' ? students : []).find(x => x.id === studentId);
    if (!s) {
      alert('수강생 정보를 찾을 수 없습니다.');
      return;
    }
    st.student = s;
    st.cur = null;
    st.dirty = false;
    document.getElementById('recTitle').textContent = `${s.cohort} ${s.name}님 · 추천물건`;
    document.getElementById('recModal').classList.add('show');
    await reload();
  }
  async function reload(keepId) {
    st.recs = await recApi(`/api/students/${st.student.id}/recommendations`);
    st.cur = keepId ? st.recs.find(r => r.id === keepId) || null : null;
    st.dirty = false;
    renderBody();
  }
  function close() {
    if (st.dirty && !confirm('저장하지 않은 변경 내용이 있습니다. 닫을까요?')) return;
    document.getElementById('recModal').classList.remove('show');
    st.cur = null;
    st.dirty = false;
    loadSummary().then(() => typeof render === 'function' && render());
  }

  /* ── 목록 + 편집기 렌더링 ── */
  function renderBody() {
    const s = st.student;
    const ctx = InvestmentRules.getReportContext(s);
    const list =
      st.recs
        .map(
          (r, i) => `
    <div class="rec-item ${st.cur && st.cur.id === r.id ? 'on' : ''}" onclick="RecReport.select(${r.id})">
      <span class="ri-no">추천 #${String(i + 1).padStart(2, '0')}</span>
      <div class="ri-main">
        <div class="ri-case">${esc(r.case_no || '(사건번호 미입력)')} <span style="font-weight:400;color:#888;font-size:11px">${esc(r.court || '')}</span></div>
        <div class="ri-sub">${esc(r.headline || '')}${r.sale_date ? ' · 매각기일 ' + fmtDate(r.sale_date) : ''}${r.min_price ? ' · 최저가 ' + man(r.min_price, '원') : ''}</div>
      </div>
      <span class="rec-chip" style="${REC_ST_STYLE[r.status] || ''}">${esc(r.status)}</span>
      <button class="ri-pdf" onclick="event.stopPropagation();RecReport.pdf([${r.id}])" title="이 물건의 리포트 PDF 받기 (수강생 발송용)">📄 리포트 PDF</button>
    </div>`
        )
        .join('') ||
      '<div style="font-size:12px;color:#aaa;padding:10px">아직 추천물건이 없습니다. [📄 경매 정보지 PDF로 추가], [+ 추천물건 추가] 또는 상단 [🏠 추천물건 시트]로 시작하세요.</div>';

    document.getElementById('recBody').innerHTML = `
    <div style="font-size:12px;color:#666;background:#f7f6f2;border-radius:8px;padding:8px 12px;margin-bottom:12px">
      ${esc(ctx.seedLine)} · ${esc(s.housing_type)} · ${s.transfer_available === 'Y' ? '전입가능' : s.transfer_available === 'N' ? '전입불가' : '전입 미확인'}
      <div style="margin-top:3px;color:#888">방향성: ${esc(InvestmentRules.consult(s).bid || '')}</div>
    </div>
    <div class="rec-list">${list}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="rec-p" onclick="InfoSheetImport.pick()" title="탱크옥션 상세정보 화면을 PDF로 저장한 파일 (여러 개 선택 가능)">📄 경매 정보지 PDF로 추가</button>
      <button onclick="RecReport.add()">+ 추천물건 추가</button>
      ${(() => {
        const n = st.recs.filter(r => !(r.images || []).some(i => i.source === 'auto') && r.case_no).length;
        return n
          ? `<button onclick="RecReport.autoCaptureAll()" style="border-color:${PURPLE};color:${PURPLE}">🤖 캡처 없는 물건 자동 캡처 (${n}건)</button>`
          : '';
      })()}
      <span id="recBulkStatus" class="rec-auto-st"></span>
    </div>
    <div id="recEditor">${st.cur ? editorHtml(st.cur) : ''}</div>`;
    if (st.cur) bindEditor();
  }

  function field(label, f, { type = 'text', ph = '', col = 1, calc = '' } = {}) {
    const r = st.cur,
      v = r[f] ?? '';
    return `<div style="grid-column:span ${col}"><label class="fl">${label}</label><input data-f="${f}" type="${type}" value="${esc(v)}" placeholder="${esc(ph)}">${calc ? `<div class="calc" data-calc="${calc}"></div>` : ''}</div>`;
  }
  function editorHtml(r) {
    const reasons = (r.reasons || []).concat([{}, {}, {}]).slice(0, 3);
    return `<div class="rec-ed">
    <h4>물건 기본 정보</h4>
    <div class="fg">
      ${field('사건번호', 'case_no', { ph: '2025타경52471' })}
      ${field('법원', 'court', { ph: '수원지방법원' })}
      ${field('매각기일', 'sale_date', { type: 'date', calc: 'sale' })}
      <div><label class="fl">상태</label><select data-f="status">${REC_STATUS.map(x => `<option ${r.status === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
      ${field('한 줄 요약', 'headline', { ph: '경기 남부 비규제지역 · 소형 아파트 · 유찰 1회 진행 물건', col: 3 })}
      ${field('담당자', 'manager')}
    </div>
    <details class="rec-opt" ${['prop_type', 'floor_main', 'occupancy', 'rights'].some(k => r[k]) ? 'open' : ''}>
    <summary>물건 개요 6칸 (선택) — 캡처에 이미 나오는 내용이면 비워두세요. 비워두면 리포트에서 숨겨집니다.</summary>
    <div class="fg" style="margin-top:8px">
      ${field('물건종류', 'prop_type', { ph: '아파트' })}
      ${field('면적 (보조문구)', 'area', { ph: '전용 18평' })}
      ${field('감정가 (만원)', 'appraisal', { type: 'number', ph: '13000', calc: 'appraisal' })}
      ${field('최저가 (만원)', 'min_price', { type: 'number', ph: '9100', calc: 'min' })}
      ${field('유찰 횟수', 'fail_count', { type: 'number', ph: '1' })}
      ${field('입찰보증금 비율 (%)', 'deposit_rate', { type: 'number', ph: '10', calc: 'deposit' })}
      ${field('층/구조', 'floor_main', { ph: '고층' })}
      ${field('층/구조 (보조)', 'floor_sub', { ph: '15층 중' })}
      ${field('점유 / 임차인', 'occupancy', { ph: '소유자 점유' })}
      ${field('점유 (보조)', 'occupancy_sub', { ph: '임차인 없음' })}
      ${field('인수 권리', 'rights', { ph: '없음' })}
      ${field('인수 권리 (보조)', 'rights_sub', { ph: '전부 소멸' })}
    </div>
    </details>
    <h4>탱크옥션 물건 정보 (캡처)</h4>
    <div class="rec-auto">
      <button class="rec-p" id="recAutoBtn" onclick="RecReport.autoCapture()">🤖 탱크옥션 자동 캡처</button>
      <span id="recAutoStatus" class="rec-auto-st"></span>
    </div>
    <div class="rec-drop" id="recDrop">📋 탱크옥션 화면을 캡처(Win+Shift+S)한 뒤 이 창에서 <b>Ctrl+V</b> · 또는 이미지를 끌어다 놓기 ·
      <a href="#" onclick="document.getElementById('recImgFile').click();return false">파일 선택</a>
      <input type="file" id="recImgFile" accept="image/*" style="display:none">
      <div style="font-size:11px;margin-top:4px">자동 캡처가 안 될 때 직접 추가 · 최대 6장 · 가로로 긴 캡처는 리포트에 전체 폭으로 들어갑니다</div>
    </div>
    <div class="rec-imgs">${(r.images || [])
      .map(
        (im, i) => `
      <div class="rec-img">
        <img src="/api/rec-images/${esc(im.file)}" alt="">${im.source === 'auto' ? '<span class="ri-auto">자동</span>' : ''}
        <div class="ri-bar">
          <input type="text" data-cap="${esc(im.file)}" value="${esc(im.caption)}" placeholder="설명">
          ${i > 0 ? `<button onclick="RecReport.imgMove(${i},-1)" title="앞으로">◀</button>` : ''}
          <button onclick="RecReport.imgEdit('${esc(im.file)}')" title="자르기·모자이크">✏</button>
          <button onclick="RecReport.imgDel('${esc(im.file)}')" title="삭제">✕</button>
        </div>
      </div>`
      )
      .join('')}</div>
    <div style="margin-top:8px">${field('캡처 하단 안내문', 'image_note', { ph: '※ 출처: 탱크옥션 (2026.10.27 캡처)' })}</div>
    <label class="rec-waiver"><input type="checkbox" data-f="tenant_waiver" ${r.tenant_waiver === 'Y' ? 'checked' : ''}>
      <b>대항력 포기 확약서 제출</b> (특별매각조건 등) — 낙찰자 인수사항 없음
      <span>정보지에 '대항력 포기'·'확약서'·'반환청구권 포기' 문구가 있으면 자동 체크됩니다</span></label>
    <h4 style="display:flex;align-items:center;gap:10px">추천 사유 (3가지: 조건 적합 / 권리 / 가격)
      <button onclick="RecReport.autoReasons()" ${AUTO_BTN}>✨ 자동 작성</button>
      <span ${HINT}>정보지 PDF·자동 캡처로 추가하면 빈 칸은 자동으로 채워집니다</span></h4>
    ${reasons
      .map(
        (x, i) => `
      <div style="display:grid;grid-template-columns:24px 1fr;gap:8px;margin-bottom:10px">
        <div style="width:22px;height:22px;border-radius:50%;background:${PURPLE};color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;margin-top:4px">${i + 1}</div>
        <div>
          <input type="text" data-reason="${i}" data-k="title" value="${esc(x.title)}" placeholder="${esc(REASON_HINTS[i].title)}" style="width:100%;font-weight:600;margin-bottom:4px">
          <textarea data-reason="${i}" data-k="body" rows="2" placeholder="${esc(REASON_HINTS[i].body)}">${esc(x.body)}</textarea>
        </div>
      </div>`
      )
      .join('')}
    <h4 style="display:flex;align-items:center;gap:10px">입찰 전략
      <button onclick="RecReport.autoBid()" ${AUTO_BTN}>🧮 낙찰가율로 입찰가 계산</button>
      <span ${HINT}>감정가 × 인근 낙찰가율 범위 · 정보지 PDF·자동 캡처 시 빈 칸이면 자동 계산</span></h4>
    <div class="fg">
      ${field('권장 입찰가 하한 (만원)', 'bid_low', { type: 'number', ph: '10000' })}
      ${field('권장 입찰가 상한 (만원)', 'bid_high', { type: 'number', ph: '10300', calc: 'bid' })}
      ${field('인근 낙찰가율 (자동 캡처 시 탱크옥션 통계로 채움)', 'win_rate', { ph: '72% ~ 100% (최근 동일 지역 아파트)', col: 2 })}
      ${field('임대 세팅 예상', 'rent', { ph: '월세 보증금 1,000만 / 월 55~65만원', col: 2 })}
    </div>
    <label class="fl">전략 메모 / 주의사항 (리포트 박스 하단에 그대로 표시)</label>
    <textarea data-f="strategy_note" rows="3"
      placeholder="예: 공시가격 1억원 이하 주택으로 1주택자도 취득세 중과 대상에서 제외됩니다.&#10;폐문으로 점유자 확인이 되지 않은 상태이므로 입찰 전 현장 임장과 관리비 체납 여부를 꼭 확인해주세요.">${esc(r.strategy_note)}</textarea>
    <div id="recCheck"></div>
    <div class="rec-actions">
      <button class="btn-p" id="recSaveBtn" onclick="RecReport.saveClick()">💾 저장</button>
      <button class="rec-p" onclick="RecReport.pdf([${r.id}])">📄 리포트 PDF 받기</button>
      <span id="recDirty" style="font-size:11px;color:#a3690a"></span>
      <span style="flex:1"></span>
      ${(() => {
        const i = st.recs.findIndex(x => x.id === r.id);
        return i > 0 ? `<button onclick="RecReport.move(-1)">▲ 순서 위로</button>` : '';
      })()}
      <button onclick="RecReport.remove()" style="color:#a32d2d">삭제</button>
    </div>
  </div>`;
  }

  function readEditor() {
    const ed = document.getElementById('recEditor');
    if (!ed || !st.cur) return;
    ed.querySelectorAll('[data-f]').forEach(el => {
      st.cur[el.dataset.f] = el.type === 'checkbox' ? (el.checked ? 'Y' : '') : el.value;
    });
    const reasons = [0, 1, 2].map(i => ({ title: '', body: '' }));
    ed.querySelectorAll('[data-reason]').forEach(el => {
      reasons[+el.dataset.reason][el.dataset.k] = el.value;
    });
    st.cur.reasons = reasons;
    const caps = {};
    ed.querySelectorAll('[data-cap]').forEach(el => (caps[el.dataset.cap] = el.value));
    st.cur.images = (st.cur.images || []).map(im => ({ ...im, caption: caps[im.file] ?? im.caption }));
  }
  // 글이 길면 입력칸 높이를 늘려 내용이 잘리지 않게
  function fitTextarea(t) {
    t.style.height = 'auto';
    t.style.height = t.scrollHeight + 2 + 'px';
  }
  function bindEditor() {
    const ed = document.getElementById('recEditor');
    ed.querySelectorAll('textarea').forEach(fitTextarea);
    ed.addEventListener('input', e => {
      if (e.target.tagName === 'TEXTAREA') fitTextarea(e.target);
      st.dirty = true;
      const d = document.getElementById('recDirty');
      d.style.color = '#a3690a';
      d.textContent = '● 저장되지 않은 변경';
      readEditor();
      updateCalc();
    });
    ed.addEventListener('change', e => {
      readEditor();
      updateCalc();
      // 확약서 체크를 바꾸면 검토 포인트 ②(권리)를 새로 쓸지 묻기
      if (e.target.dataset.f === 'tenant_waiver' && R.genReasons && st.student) {
        const g = R.genReasons(st.student, st.cur)[1];
        const cur = st.cur.reasons[1] || {};
        if (
          (g.title !== cur.title || g.body !== cur.body) &&
          confirm('검토 포인트 ②(권리)를 확약서 반영 내용으로 다시 쓸까요?')
        ) {
          ed.querySelector('[data-reason="1"][data-k="title"]').value = g.title;
          const tb = ed.querySelector('[data-reason="1"][data-k="body"]');
          tb.value = g.body;
          fitTextarea(tb);
          readEditor();
        }
        st.dirty = true;
        const d = document.getElementById('recDirty');
        d.style.color = '#a3690a';
        d.textContent = '● 저장되지 않은 변경';
        updateCalc(); // 발송 전 확인 다시 표시
      }
    });
    const drop = document.getElementById('recDrop');
    drop.addEventListener('dragover', e => {
      e.preventDefault();
      drop.classList.add('over');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => {
      e.preventDefault();
      drop.classList.remove('over');
      const f = [...e.dataTransfer.files].find(x => x.type.startsWith('image/'));
      if (f) R.openMask(f);
    });
    document.getElementById('recImgFile').addEventListener('change', e => {
      const f = e.target.files[0];
      e.target.value = '';
      if (f) R.openMask(f);
    });
    updateCalc();
  }
  function updateCalc() {
    const r = st.cur;
    if (!r) return;
    const set = (k, t) => {
      const el = document.querySelector(`[data-calc="${k}"]`);
      if (el) el.textContent = t;
    };
    set('appraisal', num(r.appraisal) ? man(r.appraisal, '원') : '');
    set(
      'min',
      num(r.min_price) ? `${man(r.min_price, '원')} · 감정가 대비 ${pct(r.min_price, r.appraisal) ?? '-'}%` : ''
    );
    set('deposit', deposit(r) ? `보증금 ${man(deposit(r), '원')}` : '');
    set(
      'bid',
      num(r.bid_low)
        ? `감정가 대비 ${pct(r.bid_low, r.appraisal) ?? '-'}~${pct(r.bid_high || r.bid_low, r.appraisal) ?? '-'}%`
        : ''
    );
    set('sale', r.sale_date ? fmtDate(r.sale_date) : '');
    const issues = R.checkRec(r);
    const box = document.getElementById('recCheck');
    if (box)
      box.innerHTML = issues.length
        ? `<div class="rec-check warn"><b>발송 전 확인</b><br>${issues.map(x => '· ' + esc(x)).join('<br>')}</div>`
        : `<div class="rec-check ok"><b>발송 전 확인</b> · 필수 항목이 모두 입력되었습니다.${r.status === '작성중' ? ' 검수 후 상태를 [검수완료]로 바꿔주세요.' : ''}</div>`;
  }

  /* ── CRUD ── */
  async function select(id) {
    if (st.dirty && !confirm('저장하지 않은 변경 내용이 있습니다. 이동할까요?')) return;
    st.cur = JSON.parse(JSON.stringify(st.recs.find(r => r.id === id)));
    st.dirty = false;
    renderBody();
    document.getElementById('recEditor').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  async function add() {
    if (st.dirty && !confirm('저장하지 않은 변경 내용이 있습니다. 새로 추가할까요?')) return;
    const rec = await recApi(`/api/students/${st.student.id}/recommendations`, 'POST', {});
    await reload(rec.id);
    select(rec.id);
  }
  async function save(silent) {
    if (!st.cur) return;
    readEditor();
    try {
      const saved = await recApi(`/api/recommendations/${st.cur.id}`, 'PUT', st.cur);
      const i = st.recs.findIndex(r => r.id === saved.id);
      if (i >= 0) st.recs[i] = saved;
      st.cur = JSON.parse(JSON.stringify(saved));
      st.dirty = false;
      if (!silent) renderBody();
      const d = document.getElementById('recDirty');
      if (d) {
        const t = new Date(),
          hm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
        d.style.color = '#27500a';
        d.textContent = silent ? '' : `✓ 저장되었습니다 (${hm})`;
      }
    } catch (e) {
      alert('저장 오류: ' + e.message);
      throw e;
    }
  }
  // 저장 버튼: 누르는 동안 '저장 중...' 표시, 두 번 눌림 방지
  async function saveClick() {
    const b = document.getElementById('recSaveBtn');
    if (b) {
      if (b.disabled) return;
      b.disabled = true;
      b.textContent = '저장 중...';
    }
    try {
      await save();
    } catch (e) {
    } finally {
      const nb = document.getElementById('recSaveBtn');
      if (nb) {
        nb.disabled = false;
        nb.textContent = '💾 저장';
      }
    }
  }
  async function remove() {
    if (!st.cur || !confirm(`${st.cur.case_no || '이 추천물건'}을(를) 삭제할까요? 첨부 이미지도 함께 삭제됩니다.`))
      return;
    await recApi(`/api/recommendations/${st.cur.id}`, 'DELETE');
    await reload();
  }
  async function move(dir) {
    // 순서 변경: 바로 위 항목과 order 값을 맞바꿈
    if (st.dirty) await save(true);
    const i = st.recs.findIndex(r => r.id === st.cur.id),
      j = i + dir;
    if (j < 0 || j >= st.recs.length) return;
    const a = st.recs[i],
      b = st.recs[j];
    await recApi(`/api/recommendations/${a.id}`, 'PUT', { order: b.order });
    await recApi(`/api/recommendations/${b.id}`, 'PUT', { order: a.order });
    await reload(a.id);
    select(a.id);
  }
  async function imgDel(file) {
    if (!confirm('이미지를 삭제할까요?')) return;
    if (st.dirty) await save(true);
    await recApi(`/api/recommendations/${st.cur.id}/images/${encodeURIComponent(file)}`, 'DELETE');
    await reload(st.cur.id);
    select(st.cur.id);
  }
  async function imgMove(i, dir) {
    readEditor();
    const imgs = [...st.cur.images];
    const [x] = imgs.splice(i, 1);
    imgs.splice(i + dir, 0, x);
    st.cur.images = imgs;
    await save();
  }

  /* ── 초기화 ── */
  function init() {
    injectUI();
    R.bindMask();
    R.pingExt();
    window.addEventListener('resize', () => {
      if (document.getElementById('maskModal').classList.contains('show')) R.fitMask();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  Object.assign(R, {
    PURPLE,
    PURPLE_BG,
    DISCLAIMER,
    st,
    esc,
    escBr,
    num,
    man,
    pct,
    fmtDate,
    todayStr,
    deposit,
    recApi,
    shrink,
    reload,
    readEditor,
    select,
    save,
    loadSummary
  });
  // 화면 버튼(onclick)에서 부르는 기능. 기능별 파일이 자기 기능을 더함
  window.RecReport = {
    open,
    close,
    select,
    add,
    save,
    saveClick,
    remove,
    move,
    imgDel,
    imgMove,
    loadSummary,
    cardLine
  };
})();
