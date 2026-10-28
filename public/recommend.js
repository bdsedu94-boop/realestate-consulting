/* ═══════════════════════════════════════════════════════════════
 * 추천물건 리포트
 *  - 수강생별 추천물건 입력/관리 (작성중 → 검수완료 → 발송완료)
 *  - 탱크옥션 캡처 붙여넣기(Ctrl+V)/드래그 → 자르기·모자이크 → 업로드
 *  - 기존 투자 방향성 리포트와 같은 방식(html2canvas + jsPDF)으로 PDF 생성
 *  - 구글시트 '요약' 탭의 추천물건1~3 칸을 엑셀로 받아 초안 일괄 생성
 *  금액 단위: 만원 (기존 수강생 데이터와 동일)
 * ═══════════════════════════════════════════════════════════════ */
(function(){
const PURPLE='#9314cc', PURPLE_BG='#f4e8fb';
const REC_STATUS=['작성중','검수완료','발송완료'];
const REC_ST_STYLE={'작성중':'background:#f0ede6;color:#5f5e5a','검수완료':'background:#e6f1fb;color:#0c447c','발송완료':'background:#eaf3de;color:#27500a'};
const DISCLAIMER='본 리포트는 탱크옥션 등 공개 자료를 기준으로 작성된 추천물건 참고자료이며, 입찰 전 법원 서류 및 변경사항은 반드시 직접 재확인하시기 바랍니다.';
const REASON_HINTS=[
  {title:'예: 투자 방향성에 맞는 비규제지역 물건',body:'예: 최저가 9,100만원으로 현금 + 신용대출 활용 시 올현금 입찰이 가능하며, 기존 주택 처분·전입 조건이 없습니다.'},
  {title:'예: 권리관계가 깨끗한 물건',body:'예: 말소기준권리(근저당) 이하 가압류까지 모두 소멸되고, 대항력 있는 임차인이 없어 인수할 권리가 없습니다.'},
  {title:'예: 시세·전세가 대비 낮은 최저가',body:'예: 동일 평형 최근 매매가 9,500만~1억 2,000만원, 전세가 1억 1,000만~1억 2,000만원 수준으로 1회 유찰된 현재 가격 메리트가 있습니다.'}
];

let REC_SUMMARY={};
const st={student:null,recs:[],cur:null,dirty:false};

/* ── 공통 유틸 ── */
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const escBr=v=>esc(v).replace(/\n/g,'<br>');
const num=v=>(v===null||v===undefined||v==='')?null:Number(v);
// 1억 3,000만 / 9,100만 형식 (예시 리포트 표기)
function man(v,suffix=''){
  v=num(v); if(v===null||!Number.isFinite(v)) return '-';
  v=Math.round(v);
  if(v>=10000){const a=Math.floor(v/10000),r=v%10000;return r?`${a}억 ${r.toLocaleString()}만${suffix}`:`${a}억${suffix?'원':''}`;}
  return `${v.toLocaleString()}만${suffix}`;
}
const pct=(a,b)=>(num(a)&&num(b))?Math.round(num(a)/num(b)*100):null;
function fmtDate(s){
  if(!s) return '';
  const d=new Date(s+'T00:00:00'); if(isNaN(d)) return s;
  return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')} (${'일월화수목금토'[d.getDay()]})`;
}
function todayStr(){const t=new Date();return `${t.getFullYear()}.${String(t.getMonth()+1).padStart(2,'0')}.${String(t.getDate()).padStart(2,'0')}`;}
function deposit(r){const m=num(r.min_price);return m?Math.round(m*(num(r.deposit_rate)||10)/100):null;}
async function recApi(url,method='GET',body=null){return api(url,method,body);} // index.html 의 api() 재사용

/* ── 스타일 & 모달 마크업 주입 ── */
function injectUI(){
  const css=document.createElement('style');
  css.textContent=`
.rec-line{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:8px;padding-top:8px;border-top:0.5px dashed rgba(0,0,0,0.1);font-size:11px;color:#888}
.rec-line button{font-size:11px;padding:3px 10px;border-color:${PURPLE};color:${PURPLE}}
.rec-line button:hover{background:${PURPLE_BG}}
.rec-chip{display:inline-block;font-size:10px;padding:2px 7px;border-radius:8px;font-weight:600}
#recModal .modal{width:min(980px,96vw)}
.rec-list{display:flex;flex-direction:column;gap:8px;margin-bottom:12px}
.rec-item{display:flex;align-items:center;gap:10px;border:0.5px solid rgba(0,0,0,0.12);border-radius:10px;padding:9px 12px;cursor:pointer;background:#fff}
.rec-item:hover,.rec-item.on{border-color:${PURPLE};background:#fcf8fe}
.rec-item .ri-no{font-size:11px;font-weight:700;color:#fff;background:${PURPLE};border-radius:10px;padding:2px 8px;flex-shrink:0}
.rec-item .ri-main{flex:1;min-width:0}
.rec-item .ri-case{font-size:13px;font-weight:700}
.rec-item .ri-sub{font-size:11px;color:#888;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rec-ed h4{font-size:13px;font-weight:700;color:${PURPLE};margin:16px 0 8px;padding-left:8px;border-left:3px solid ${PURPLE}}
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
.ri-auto{position:absolute;top:6px;left:6px;font-size:10px;background:${PURPLE};color:#fff;border-radius:6px;padding:1px 6px}
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

  const wrap=document.createElement('div');
  wrap.innerHTML=`
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
  const ctrls=document.querySelector('.ctrls');
  if(ctrls){
    const b=document.createElement('button');
    b.textContent='🏠 추천물건 시트 가져오기';
    b.style.cssText=`background:#fff;color:${PURPLE};border-color:${PURPLE}`;
    b.title='구글시트 요약 탭(엑셀로 다운로드)의 추천물건1~3 사건번호로 초안을 만듭니다';
    b.onclick=()=>document.getElementById('recXlsxInput').click();
    const inp=document.createElement('input');
    inp.type='file';inp.id='recXlsxInput';inp.accept='.xlsx,.xls,.csv';inp.style.display='none';
    inp.onchange=()=>importRecSheet(inp);
    ctrls.appendChild(b);ctrls.appendChild(inp);
  }

  // 붙여넣기(Ctrl+V)로 캡처 추가
  document.addEventListener('paste',e=>{
    if(!document.getElementById('recModal').classList.contains('show')||!st.cur) return;
    if(document.getElementById('maskModal').classList.contains('show')) return;
    const item=[...(e.clipboardData?.items||[])].find(i=>i.type.startsWith('image/'));
    if(!item) return;
    e.preventDefault();
    openMask(item.getAsFile());
  });
}

/* ── 카드 배지 ── */
async function loadSummary(){
  try{REC_SUMMARY=await recApi('/api/recommendations/summary');}catch(e){REC_SUMMARY={};}
}
function cardLine(d){
  const s=REC_SUMMARY[d.id];
  const chips=s?REC_STATUS.filter(k=>s[k]).map(k=>`<span class="rec-chip" style="${REC_ST_STYLE[k]}">${k} ${s[k]}</span>`).join(''):'<span>추천물건 없음</span>';
  return `<div class="rec-line"><span style="font-weight:600;color:#555">🏠 추천물건 ${s?s.total+'건':''}</span>${chips}<span style="flex:1"></span><button onclick="RecReport.open(${d.id})">추천물건 관리 · PDF</button></div>`;
}

/* ── 모달 열기/닫기 ── */
async function open(studentId){
  const s=(typeof students!=='undefined'?students:[]).find(x=>x.id===studentId);
  if(!s){alert('수강생 정보를 찾을 수 없습니다.');return;}
  st.student=s;st.cur=null;st.dirty=false;
  document.getElementById('recTitle').textContent=`${s.cohort} ${s.name}님 · 추천물건`;
  document.getElementById('recModal').classList.add('show');
  await reload();
}
async function reload(keepId){
  st.recs=await recApi(`/api/students/${st.student.id}/recommendations`);
  st.cur=keepId?st.recs.find(r=>r.id===keepId)||null:null;
  st.dirty=false;
  renderBody();
}
function close(){
  if(st.dirty&&!confirm('저장하지 않은 변경 내용이 있습니다. 닫을까요?')) return;
  document.getElementById('recModal').classList.remove('show');
  st.cur=null;st.dirty=false;
  loadSummary().then(()=>typeof render==='function'&&render());
}

/* ── 목록 + 편집기 렌더링 ── */
function renderBody(){
  const s=st.student;
  const ctx=InvestmentRules.getReportContext(s);
  const list=st.recs.map((r,i)=>`
    <div class="rec-item ${st.cur&&st.cur.id===r.id?'on':''}" onclick="RecReport.select(${r.id})">
      <span class="ri-no">추천 #${String(i+1).padStart(2,'0')}</span>
      <div class="ri-main">
        <div class="ri-case">${esc(r.case_no||'(사건번호 미입력)')} <span style="font-weight:400;color:#888;font-size:11px">${esc(r.court||'')}</span></div>
        <div class="ri-sub">${esc(r.headline||'')}${r.sale_date?' · 매각기일 '+fmtDate(r.sale_date):''}${r.min_price?' · 최저가 '+man(r.min_price,'원'):''}</div>
      </div>
      <span class="rec-chip" style="${REC_ST_STYLE[r.status]||''}">${esc(r.status)}</span>
      <button onclick="event.stopPropagation();RecReport.pdf([${r.id}])" title="이 물건만 PDF">📄</button>
    </div>`).join('')||'<div style="font-size:12px;color:#aaa;padding:10px">아직 추천물건이 없습니다. [+ 추천물건 추가] 또는 상단 [🏠 추천물건 시트 가져오기]로 시작하세요.</div>';

  document.getElementById('recBody').innerHTML=`
    <div style="font-size:12px;color:#666;background:#f7f6f2;border-radius:8px;padding:8px 12px;margin-bottom:12px">
      ${esc(ctx.seedLine)} · ${esc(s.housing_type)} · ${s.transfer_available==='Y'?'전입가능':s.transfer_available==='N'?'전입불가':'전입 미확인'}
      <div style="margin-top:3px;color:#888">방향성: ${esc(InvestmentRules.consult(s).bid||'')}</div>
    </div>
    <div class="rec-list">${list}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button onclick="RecReport.add()">+ 추천물건 추가</button>
      ${st.recs.length?`<button class="rec-p" onclick="RecReport.pdf()">📄 전체 추천물건 PDF (${st.recs.length}건)</button>`:''}
      ${(()=>{const n=st.recs.filter(r=>!(r.images||[]).some(i=>i.source==='auto')&&r.case_no).length;return n?`<button onclick="RecReport.autoCaptureAll()" style="border-color:${PURPLE};color:${PURPLE}">🤖 캡처 없는 물건 자동 캡처 (${n}건)</button>`:'';})()}
      <span id="recBulkStatus" class="rec-auto-st"></span>
    </div>
    <div id="recEditor">${st.cur?editorHtml(st.cur):''}</div>`;
  if(st.cur) bindEditor();
}

function field(label,f,{type='text',ph='',col=1,calc=''}={}){
  const r=st.cur, v=r[f]??'';
  return `<div style="grid-column:span ${col}"><label class="fl">${label}</label><input data-f="${f}" type="${type}" value="${esc(v)}" placeholder="${esc(ph)}">${calc?`<div class="calc" data-calc="${calc}"></div>`:''}</div>`;
}
function editorHtml(r){
  const reasons=(r.reasons||[]).concat([{},{},{}]).slice(0,3);
  return `<div class="rec-ed">
    <h4>물건 기본 정보</h4>
    <div class="fg">
      ${field('사건번호','case_no',{ph:'2025타경52471'})}
      ${field('법원','court',{ph:'수원지방법원'})}
      ${field('매각기일','sale_date',{type:'date',calc:'sale'})}
      <div><label class="fl">상태</label><select data-f="status">${REC_STATUS.map(x=>`<option ${r.status===x?'selected':''}>${x}</option>`).join('')}</select></div>
      ${field('한 줄 요약','headline',{ph:'경기 남부 비규제지역 · 소형 아파트 · 유찰 1회 진행 물건',col:3})}
      ${field('담당자','manager')}
    </div>
    <details class="rec-opt" ${['prop_type','floor_main','occupancy','rights'].some(k=>r[k])?'open':''}>
    <summary>물건 개요 6칸 (선택) — 캡처에 이미 나오는 내용이면 비워두세요. 비워두면 리포트에서 숨겨집니다.</summary>
    <div class="fg" style="margin-top:8px">
      ${field('물건종류','prop_type',{ph:'아파트'})}
      ${field('면적 (보조문구)','area',{ph:'전용 18평'})}
      ${field('감정가 (만원)','appraisal',{type:'number',ph:'13000',calc:'appraisal'})}
      ${field('최저가 (만원)','min_price',{type:'number',ph:'9100',calc:'min'})}
      ${field('유찰 횟수','fail_count',{type:'number',ph:'1'})}
      ${field('입찰보증금 비율 (%)','deposit_rate',{type:'number',ph:'10',calc:'deposit'})}
      ${field('층/구조','floor_main',{ph:'고층'})}
      ${field('층/구조 (보조)','floor_sub',{ph:'15층 중'})}
      ${field('점유 / 임차인','occupancy',{ph:'소유자 점유'})}
      ${field('점유 (보조)','occupancy_sub',{ph:'임차인 없음'})}
      ${field('인수 권리','rights',{ph:'없음'})}
      ${field('인수 권리 (보조)','rights_sub',{ph:'전부 소멸'})}
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
    <div class="rec-imgs">${(r.images||[]).map((im,i)=>`
      <div class="rec-img">
        <img src="/api/rec-images/${esc(im.file)}" alt="">${im.source==='auto'?'<span class="ri-auto">자동</span>':''}
        <div class="ri-bar">
          <input type="text" data-cap="${esc(im.file)}" value="${esc(im.caption)}" placeholder="설명">
          ${i>0?`<button onclick="RecReport.imgMove(${i},-1)" title="앞으로">◀</button>`:''}
          <button onclick="RecReport.imgEdit('${esc(im.file)}')" title="자르기·모자이크">✏</button>
          <button onclick="RecReport.imgDel('${esc(im.file)}')" title="삭제">✕</button>
        </div>
      </div>`).join('')}</div>
    <div style="margin-top:8px">${field('캡처 하단 안내문','image_note',{ph:'※ 출처: 탱크옥션 (2026.10.27 캡처)'})}</div>
    <h4 style="display:flex;align-items:center;gap:10px">추천 사유 (3가지: 조건 적합 / 권리 / 가격)<button onclick="RecReport.autoReasons()" style="font-size:11px;padding:3px 10px;border-color:${PURPLE};color:${PURPLE};font-weight:600">✨ 자동 작성</button><span style="font-size:11px;color:#888;font-weight:400">자동 캡처하면 빈 칸은 자동으로 채워집니다</span></h4>
    ${reasons.map((x,i)=>`
      <div style="display:grid;grid-template-columns:24px 1fr;gap:8px;margin-bottom:10px">
        <div style="width:22px;height:22px;border-radius:50%;background:${PURPLE};color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;margin-top:4px">${i+1}</div>
        <div>
          <input type="text" data-reason="${i}" data-k="title" value="${esc(x.title)}" placeholder="${esc(REASON_HINTS[i].title)}" style="width:100%;font-weight:600;margin-bottom:4px">
          <textarea data-reason="${i}" data-k="body" rows="2" placeholder="${esc(REASON_HINTS[i].body)}">${esc(x.body)}</textarea>
        </div>
      </div>`).join('')}
    <h4 style="display:flex;align-items:center;gap:10px">입찰 전략<button onclick="RecReport.autoBid()" style="font-size:11px;padding:3px 10px;border-color:${PURPLE};color:${PURPLE};font-weight:600">🧮 낙찰가율로 입찰가 계산</button><span style="font-size:11px;color:#888;font-weight:400">감정가 × 인근 낙찰가율 범위 · 자동 캡처 시 빈 칸이면 자동 계산</span></h4>
    <div class="fg">
      ${field('권장 입찰가 하한 (만원)','bid_low',{type:'number',ph:'10000'})}
      ${field('권장 입찰가 상한 (만원)','bid_high',{type:'number',ph:'10300',calc:'bid'})}
      ${field('인근 낙찰가율 (자동 캡처 시 탱크옥션 통계로 채움)','win_rate',{ph:'72% ~ 100% (최근 동일 지역 아파트)',col:2})}
      ${field('임대 세팅 예상','rent',{ph:'월세 보증금 1,000만 / 월 55~65만원',col:2})}
    </div>
    <label class="fl">전략 메모 / 주의사항 (리포트 박스 하단에 그대로 표시)</label>
    <textarea data-f="strategy_note" rows="3" placeholder="예: 공시가격 1억원 이하 주택으로 1주택자도 취득세 중과 대상에서 제외됩니다.&#10;폐문으로 점유자 확인이 되지 않은 상태이므로 입찰 전 현장 임장과 관리비 체납 여부를 꼭 확인해주세요.">${esc(r.strategy_note)}</textarea>
    <div id="recCheck"></div>
    <div class="rec-actions">
      <button class="btn-p" onclick="RecReport.save()">💾 저장</button>
      <button class="rec-p" onclick="RecReport.pdf([${r.id}])">📄 이 물건 PDF</button>
      <span id="recDirty" style="font-size:11px;color:#a3690a"></span>
      <span style="flex:1"></span>
      ${(()=>{const i=st.recs.findIndex(x=>x.id===r.id);return i>0?`<button onclick="RecReport.move(-1)">▲ 순서 위로</button>`:'';})()}
      <button onclick="RecReport.remove()" style="color:#a32d2d">삭제</button>
    </div>
  </div>`;
}

function readEditor(){
  const ed=document.getElementById('recEditor'); if(!ed||!st.cur) return;
  ed.querySelectorAll('[data-f]').forEach(el=>{st.cur[el.dataset.f]=el.value;});
  const reasons=[0,1,2].map(i=>({title:'',body:''}));
  ed.querySelectorAll('[data-reason]').forEach(el=>{reasons[+el.dataset.reason][el.dataset.k]=el.value;});
  st.cur.reasons=reasons;
  const caps={};ed.querySelectorAll('[data-cap]').forEach(el=>caps[el.dataset.cap]=el.value);
  st.cur.images=(st.cur.images||[]).map(im=>({...im,caption:caps[im.file]??im.caption}));
}
function bindEditor(){
  const ed=document.getElementById('recEditor');
  ed.addEventListener('input',()=>{st.dirty=true;document.getElementById('recDirty').textContent='● 저장되지 않은 변경';readEditor();updateCalc();});
  ed.addEventListener('change',()=>{readEditor();updateCalc();});
  const drop=document.getElementById('recDrop');
  drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('over');});
  drop.addEventListener('dragleave',()=>drop.classList.remove('over'));
  drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('over');const f=[...e.dataTransfer.files].find(x=>x.type.startsWith('image/'));if(f)openMask(f);});
  document.getElementById('recImgFile').addEventListener('change',e=>{const f=e.target.files[0];e.target.value='';if(f)openMask(f);});
  updateCalc();
}
function updateCalc(){
  const r=st.cur; if(!r) return;
  const set=(k,t)=>{const el=document.querySelector(`[data-calc="${k}"]`);if(el)el.textContent=t;};
  set('appraisal',num(r.appraisal)?man(r.appraisal,'원'):'');
  set('min',num(r.min_price)?`${man(r.min_price,'원')} · 감정가 대비 ${pct(r.min_price,r.appraisal)??'-'}%`:'');
  set('deposit',deposit(r)?`보증금 ${man(deposit(r),'원')}`:'');
  set('bid',num(r.bid_low)?`감정가 대비 ${pct(r.bid_low,r.appraisal)??'-'}~${pct(r.bid_high||r.bid_low,r.appraisal)??'-'}%`:'');
  set('sale',r.sale_date?fmtDate(r.sale_date):'');
  const issues=checkRec(r);
  const box=document.getElementById('recCheck');
  if(box) box.innerHTML=issues.length
    ?`<div class="rec-check warn"><b>발송 전 확인</b><br>${issues.map(x=>'· '+esc(x)).join('<br>')}</div>`
    :`<div class="rec-check ok"><b>발송 전 확인</b> · 필수 항목이 모두 입력되었습니다.${r.status==='작성중'?' 검수 후 상태를 [검수완료]로 바꿔주세요.':''}</div>`;
}

/* ── 추천 사유 자동 작성 ──
 * 1차 기준(투자 방향성에 맞는 지역 + 권리상 문제 없는 물건)에 맞춰
 * 수강생 조건 + 자동 캡처에서 읽은 사실(지역·말소기준권리·임차인·낙찰가율)로 3가지 사유를 만든다. */
// 수도권 규제지역 (투자 방향성 기준과 동일: 서울 전역 + 경기 12곳)
const REG_GG=['과천시','광명시','성남시 분당구','성남시 수정구','성남시 중원구','수원시 영통구','수원시 장안구','수원시 팔달구','안양시 동안구','용인시 수지구','의왕시','하남시'];
function facts(r){try{return JSON.parse(r.auto_facts||'{}')||{};}catch(e){return {};}}
function regionOf(r){
  const a=(facts(r).address||r.headline||'').replace(/\s+/g,' ');
  if(/^서울/.test(a)) return {key:'reg',label:'수도권 규제지역'};
  if(/^경기/.test(a)) return REG_GG.some(g=>a.replace(/^경기(도)?\s*/,'').startsWith(g))?{key:'reg',label:'수도권 규제지역'}:{key:'nreg',label:'수도권 비규제지역'};
  if(/^인천/.test(a)) return {key:'nreg',label:'수도권 비규제지역'};
  if(a) return {key:'local',label:'비수도권'};
  return null;
}
function rateRange(txt){const m=(txt||'').match(/(\d{1,3}(?:\.\d+)?)%(?:\s*~\s*(\d{1,3}(?:\.\d+)?)%)?/);return m?{lo:+m[1],hi:+(m[2]||m[1])}:null;}
// 권장 입찰가 = 감정가 × 인근 낙찰가율 범위 (10만원 단위 반올림, 최저가 미만이면 최저가로)
function calcBid(r){
  const ap=num(r.appraisal), wr=rateRange(r.win_rate), min=num(r.min_price);
  if(!ap||!wr) return null;
  const rd=v=>Math.round(v/10)*10;
  let lo=rd(ap*wr.lo/100), hi=rd(ap*wr.hi/100);
  if(min){ if(lo<min) lo=min; if(hi<min) hi=min; }
  return {bid_low:lo,bid_high:hi,belowMin:!!(min&&rd(ap*wr.hi/100)<min)};
}
async function autoBid(){
  if(!st.cur) return;
  readEditor();
  const b=calcBid(st.cur);
  if(!b){alert('감정가와 인근 낙찰가율이 있어야 계산할 수 있습니다. 먼저 [🤖 탱크옥션 자동 캡처]를 해주세요.');return;}
  if((num(st.cur.bid_low)||num(st.cur.bid_high))&&!confirm(`권장 입찰가를 ${man(b.bid_low,'원')} ~ ${man(b.bid_high,'원')}로 바꿀까요?`)) return;
  Object.assign(st.cur,{bid_low:b.bid_low,bid_high:b.bid_high,bid_auto:`${b.bid_low}-${b.bid_high}`});
  await save();
  if(b.belowMin) alert('인근 낙찰가율로 계산한 금액이 최저가보다 낮아 최저가 기준으로 맞췄습니다. 입찰 여부를 다시 검토해주세요.');
}
function genReasons(s,r){
  const f=facts(r), rg=regionOf(r), prop=f.propType||r.prop_type||'물건';
  const seed=s.seed_amount||0, cr=s.credit_amount||0, min=num(r.min_price), dep=deposit(r);
  const many=s.housing_type==='1주택'||s.housing_type==='다주택'||s.housing_type==='일시적2주택';
  // 1. 투자 방향성(지역·자금) 적합
  const b1=[];
  if(min) b1.push(`최저가 ${man(min,'원')}${dep?`(입찰보증금 ${man(dep,'원')})`:''}으로 ${cr>0?`현금 ${man(seed,'원')}과 신용대출 ${man(cr,'원')}을 활용해`:`보유 현금 ${man(seed,'원')} 범위에서`} 입찰이 가능합니다.`);
  if(rg&&rg.key==='nreg') b1.push(many?'비규제지역이라 기존 주택 처분·전입 조건이 없습니다.':'비규제지역이라 전입·처분 조건 부담이 적습니다.');
  if(rg&&rg.key==='local') b1.push('비수도권 물건으로 수도권 대출 한도 규제를 받지 않습니다.');
  if(many&&/1억(원)?(이하|미만)|^~?1억$/.test(f.pubPrice||'')) b1.push('공시가격 1억원 이하 주택으로 취득세 중과 대상에서 제외됩니다.');
  const r1={title:`투자 방향성에 맞는 ${rg?rg.label+' ':''}${prop}`.replace(/\s+/g,' '),body:b1.join(' ')};
  // 2. 권리
  const b2=[];let clean=true;
  if(f.baseRight) b2.push(`말소기준권리(${f.baseRight.kind}${f.baseRight.date?', '+f.baseRight.date:''}) 이하 권리는 매각으로 모두 소멸됩니다.`);
  else b2.push('말소기준권리 이하 권리는 매각으로 모두 소멸됩니다.');
  if(f.tenants===0) b2.push('조사된 임차인이 없어 매수인이 인수할 권리가 없습니다.');
  else if(f.tenants>0&&!f.tenantsWithPriority) b2.push(`임차인 ${f.tenants}명은 대항력이 없어 매수인이 인수할 보증금이 없습니다.`);
  else if(f.tenantsWithPriority>0){clean=false;b2.push(`대항력 있는 임차인이 ${f.tenantsWithPriority}명 있어 배당 결과에 따라 보증금을 인수할 수 있으니 확인이 필요합니다.`);}
  if((f.assumedRights||[]).length){clean=false;b2.push(`소멸되지 않는 권리(${f.assumedRights.join(', ')})가 있어 확인이 필요합니다.`);}
  if(f.closedDoor) b2.push('다만 폐문으로 점유자 확인이 되지 않아 입찰 전 현장 확인이 필요합니다.');
  const r2={title:clean?'권리관계가 깨끗한 물건':'권리 확인이 필요한 물건',body:b2.join(' ')};
  // 3. 가격
  const b3=[], p=pct(r.min_price,r.appraisal), fc=num(r.fail_count), wr=rateRange(r.win_rate);
  if(num(r.appraisal)&&min) b3.push(`감정가 ${man(r.appraisal,'원')} 대비 최저가 ${man(min,'원')}(${p}%)${fc?`로 ${fc}회 유찰된 상태입니다.`:'입니다.'}`);
  if(wr) b3.push(p&&p<wr.lo?`인근 매각사례 낙찰가율(${r.win_rate.replace(/\s*\(.*$/,'')})보다 낮은 가격에서 시작해 가격 메리트가 있습니다.`:`인근 매각사례 낙찰가율은 ${r.win_rate.replace(/\s*\(.*$/,'')} 수준으로, 입찰가 산정 시 참고하세요.`);
  const r3={title:fc?`${fc}회 유찰로 낮아진 최저가`:'시세 대비 가격 메리트',body:b3.join(' ')};
  return [r1,r2,r3];
}
async function autoReasons(){
  if(!st.cur) return;
  readEditor();
  const has=(st.cur.reasons||[]).some(x=>(x.title||'').trim()||(x.body||'').trim());
  if(has&&!confirm('이미 입력된 추천 사유를 자동 작성 내용으로 바꿀까요?')) return;
  if(!st.cur.auto_facts&&!confirm('자동 캡처 정보가 없어 일부 문장만 만들어집니다. 먼저 [🤖 탱크옥션 자동 캡처]를 하면 더 정확합니다. 그래도 작성할까요?')) return;
  st.cur.reasons=genReasons(st.student,st.cur);
  await save();
}

/* ── 발송 전 품질 체크 ── */
function checkRec(r){
  const out=[];
  if(!/^\d{4}타경\d+/.test((r.case_no||'').replace(/\s/g,''))) out.push('사건번호를 "2025타경12345" 형식으로 입력하세요.');
  if(r.sale_date&&new Date(r.sale_date+'T23:59:59')<new Date()) out.push('매각기일이 이미 지났습니다. 변경·유찰 여부를 확인하세요.');
  if(num(r.min_price)&&num(r.appraisal)&&num(r.min_price)>num(r.appraisal)) out.push('최저가가 감정가보다 큽니다.');
  if((r.reasons||[]).filter(x=>x.title&&x.title.trim()).length<3) out.push('추천 사유 3가지를 모두 입력하세요.');
  if(num(r.bid_low)){
    if(num(r.min_price)&&num(r.bid_low)<num(r.min_price)) out.push('권장 입찰가 하한이 최저가보다 낮습니다.');
    if(num(r.bid_high)&&num(r.bid_high)<num(r.bid_low)) out.push('권장 입찰가 상한이 하한보다 낮습니다.');
  }else out.push('권장 입찰가를 입력하세요.');
  const s=st.student;
  if(s&&deposit(r)){
    const total=(s.seed_amount||0)+(s.credit_amount||0);
    if(total&&deposit(r)>total) out.push(`입찰보증금(${man(deposit(r),'원')})이 수강생 투자금 합산(${man(total,'원')})보다 큽니다.`);
  }
  if(!(r.images||[]).length) out.push('탱크옥션 캡처 이미지가 없습니다. [🤖 탱크옥션 자동 캡처]를 눌러주세요.');
  const f=facts(r);
  if(f.tenantsWithPriority>0) out.push(`대항력 있는 임차인 ${f.tenantsWithPriority}명 — 추천 기준(권리상 문제 없음)에 맞는지 확인하세요.`);
  if((f.assumedRights||[]).length) out.push(`소멸되지 않는 권리(${f.assumedRights.join(', ')}) — 추천 기준에 맞는지 확인하세요.`);
  return out;
}

/* ── CRUD ── */
async function select(id){
  if(st.dirty&&!confirm('저장하지 않은 변경 내용이 있습니다. 이동할까요?')) return;
  st.cur=JSON.parse(JSON.stringify(st.recs.find(r=>r.id===id)));st.dirty=false;renderBody();
  document.getElementById('recEditor').scrollIntoView({behavior:'smooth',block:'start'});
}
async function add(){
  if(st.dirty&&!confirm('저장하지 않은 변경 내용이 있습니다. 새로 추가할까요?')) return;
  const rec=await recApi(`/api/students/${st.student.id}/recommendations`,'POST',{});
  await reload(rec.id);select(rec.id);
}
async function save(silent){
  if(!st.cur) return;
  readEditor();
  try{
    const saved=await recApi(`/api/recommendations/${st.cur.id}`,'PUT',st.cur);
    const i=st.recs.findIndex(r=>r.id===saved.id);if(i>=0)st.recs[i]=saved;
    st.cur=JSON.parse(JSON.stringify(saved));st.dirty=false;
    if(!silent) renderBody();
    else{const d=document.getElementById('recDirty');if(d)d.textContent='';}
  }catch(e){alert('저장 오류: '+e.message);throw e;}
}
async function remove(){
  if(!st.cur||!confirm(`${st.cur.case_no||'이 추천물건'}을(를) 삭제할까요? 첨부 이미지도 함께 삭제됩니다.`)) return;
  await recApi(`/api/recommendations/${st.cur.id}`,'DELETE');
  await reload();
}
async function move(dir){
  // 순서 변경: 바로 위 항목과 order 값을 맞바꿈
  if(st.dirty) await save(true);
  const i=st.recs.findIndex(r=>r.id===st.cur.id),j=i+dir;
  if(j<0||j>=st.recs.length) return;
  const a=st.recs[i],b=st.recs[j];
  await recApi(`/api/recommendations/${a.id}`,'PUT',{order:b.order});
  await recApi(`/api/recommendations/${b.id}`,'PUT',{order:a.order});
  await reload(a.id);select(a.id);
}
async function imgDel(file){
  if(!confirm('이미지를 삭제할까요?')) return;
  if(st.dirty) await save(true);
  await recApi(`/api/recommendations/${st.cur.id}/images/${encodeURIComponent(file)}`,'DELETE');
  await reload(st.cur.id);select(st.cur.id);
}
async function imgMove(i,dir){
  readEditor();
  const imgs=[...st.cur.images];const [x]=imgs.splice(i,1);imgs.splice(i+dir,0,x);
  st.cur.images=imgs;await save();
}

/* ── 캡처 이미지 다듬기 (자르기 / 모자이크) ── */
const mk={canvas:null,ctx:null,undo:[],mode:'blur',sel:null,drag:null,scale:1};
function openMask(file,replace){
  mk.replace=replace||null;
  if(!replace&&(st.cur.images||[]).length>=6){alert('이미지는 최대 6장까지 첨부할 수 있습니다.');return;}
  const img=new Image();
  img.onload=()=>{
    const MAXW=1600;const k=Math.min(1,MAXW/img.width);
    const c=document.getElementById('maskCanvas');
    c.width=Math.round(img.width*k);c.height=Math.round(img.height*k);
    mk.canvas=c;mk.ctx=c.getContext('2d');mk.ctx.drawImage(img,0,0,c.width,c.height);
    mk.undo=[];mk.sel=null;
    document.getElementById('maskCaption').value=replace?replace.caption||'':'';
    document.getElementById('maskModal').classList.add('show');
    fitMask();maskMode(replace?'blur':'crop');
    URL.revokeObjectURL(img.src);
  };
  img.src=URL.createObjectURL(file);
}
function fitMask(){
  const wrapW=document.getElementById('maskWrap').clientWidth-2;
  mk.scale=Math.min(1,wrapW/mk.canvas.width);
  mk.canvas.style.width=(mk.canvas.width*mk.scale)+'px';
  mk.canvas.style.height=(mk.canvas.height*mk.scale)+'px';
  document.getElementById('maskSel').style.display='none';
}
function maskMode(m){
  mk.mode=m;mk.sel=null;
  document.getElementById('mtCrop').classList.toggle('on',m==='crop');
  document.getElementById('mtBlur').classList.toggle('on',m==='blur');
  document.getElementById('mtCropApply').style.display='none';
  document.getElementById('maskSel').style.display='none';
}
function pushUndo(){mk.undo.push({w:mk.canvas.width,h:mk.canvas.height,data:mk.ctx.getImageData(0,0,mk.canvas.width,mk.canvas.height)});if(mk.undo.length>20)mk.undo.shift();}
function maskUndo(){
  const u=mk.undo.pop();if(!u)return;
  mk.canvas.width=u.w;mk.canvas.height=u.h;mk.ctx.putImageData(u.data,0,0);fitMask();
}
function pixelate(x,y,w,h){
  if(w<2||h<2) return;
  pushUndo();
  const block=Math.max(8,Math.min(14,Math.round(Math.min(w,h)/3)));
  const data=mk.ctx.getImageData(x,y,w,h);
  for(let by=0;by<h;by+=block)for(let bx=0;bx<w;bx+=block){
    let r=0,g=0,b=0,n=0;
    for(let yy=by;yy<Math.min(by+block,h);yy++)for(let xx=bx;xx<Math.min(bx+block,w);xx++){const i=(yy*w+xx)*4;r+=data.data[i];g+=data.data[i+1];b+=data.data[i+2];n++;}
    mk.ctx.fillStyle=`rgb(${r/n|0},${g/n|0},${b/n|0})`;
    mk.ctx.fillRect(x+bx,y+by,Math.min(block,w-bx),Math.min(block,h-by));
  }
}
function maskCropApply(){
  const s=mk.sel;if(!s||s.w<10||s.h<10)return;
  pushUndo();
  const data=mk.ctx.getImageData(s.x,s.y,s.w,s.h);
  mk.canvas.width=s.w;mk.canvas.height=s.h;mk.ctx.putImageData(data,0,0);
  fitMask();maskMode('blur');
}
function bindMask(){
  const c=document.getElementById('maskCanvas'),sel=document.getElementById('maskSel');
  const pos=e=>{const b=c.getBoundingClientRect();return{x:Math.max(0,Math.min(mk.canvas.width,(e.clientX-b.left)/mk.scale)),y:Math.max(0,Math.min(mk.canvas.height,(e.clientY-b.top)/mk.scale))};};
  c.addEventListener('mousedown',e=>{mk.drag=pos(e);e.preventDefault();});
  window.addEventListener('mousemove',e=>{
    if(!mk.drag) return;
    const p=pos(e);
    const x=Math.min(p.x,mk.drag.x),y=Math.min(p.y,mk.drag.y),w=Math.abs(p.x-mk.drag.x),h=Math.abs(p.y-mk.drag.y);
    mk.sel={x:Math.round(x),y:Math.round(y),w:Math.round(w),h:Math.round(h)};
    Object.assign(sel.style,{display:'block',left:(c.offsetLeft+x*mk.scale)+'px',top:(c.offsetTop+y*mk.scale)+'px',width:(w*mk.scale)+'px',height:(h*mk.scale)+'px'});
  });
  window.addEventListener('mouseup',()=>{
    if(!mk.drag) return;
    mk.drag=null;
    if(!mk.sel) return;
    if(mk.mode==='blur'){const s=mk.sel;pixelate(s.x,s.y,s.w,s.h);mk.sel=null;sel.style.display='none';}
    else document.getElementById('mtCropApply').style.display='';
  });
}
async function maskDone(){
  const dataUrl=mk.canvas.toDataURL('image/jpeg',0.88);
  const caption=document.getElementById('maskCaption').value;
  try{
    if(st.dirty) await save(true);
    const rep=mk.replace; mk.replace=null;
    let rec=await recApi(`/api/recommendations/${st.cur.id}/images`,'POST',{dataUrl,caption,source:rep?rep.source:'manual'});
    if(rep){
      // 다듬은 이미지를 원래 자리로 옮기고 원본 삭제
      const newer=rec.images[rec.images.length-1];
      const order=rec.images.filter(i=>i.file!==newer.file&&i.file!==rep.file);
      order.splice(Math.min(rep.index,order.length),0,newer);
      await recApi(`/api/recommendations/${st.cur.id}`,'PUT',{images:[...order,...rec.images.filter(i=>i.file===rep.file)]});
      await recApi(`/api/recommendations/${st.cur.id}/images/${encodeURIComponent(rep.file)}`,'DELETE');
    }
    document.getElementById('maskModal').classList.remove('show');
    await reload(st.cur.id);select(st.cur.id);
  }catch(e){alert('이미지 업로드 오류: '+e.message);}
}
function maskCancel(){mk.replace=null;document.getElementById('maskModal').classList.remove('show');}
async function imgEdit(file){
  if(st.dirty) await save(true);
  const idx=(st.cur.images||[]).findIndex(i=>i.file===file);if(idx<0)return;
  const im=st.cur.images[idx];
  const blob=await (await fetch('/api/rec-images/'+encodeURIComponent(file),{credentials:'same-origin'})).blob();
  openMask(blob,{file,index:idx,caption:im.caption,source:im.source});
}

/* ── 탱크옥션 자동 캡처 (크롬 확장프로그램 '추천물건 캡처 도우미'와 연동) ── */
const ext={ready:false,version:null,pending:{}};
window.addEventListener('message',e=>{
  if(e.source!==window||!e.data||e.data.source!=='tank-ext') return;
  const d=e.data;
  if(d.type==='PONG'){ext.ready=true;ext.version=d.version;}
  else if(d.type==='PROGRESS'){const p=ext.pending[d.reqId];if(p&&p.progress)p.progress(d.message);}
  else if(d.type==='RESULT'){const p=ext.pending[d.reqId];if(p){delete ext.pending[d.reqId];p.resolve(d);}}
});
function pingExt(){window.postMessage({source:'rec-site',type:'PING'},location.origin);}
function extCapture(caseNo,progress){
  return new Promise(resolve=>{
    const reqId=Date.now().toString(36)+Math.random().toString(36).slice(2);
    ext.pending[reqId]={resolve,progress};
    window.postMessage({source:'rec-site',type:'CAPTURE',reqId,caseNo},location.origin);
    setTimeout(()=>{if(ext.pending[reqId]){delete ext.pending[reqId];resolve({ok:false,error:'시간 초과 (3분). 탱크옥션 창을 확인해주세요.'});}},180000);
  });
}
const EXT_GUIDE='탱크옥션 자동 캡처를 쓰려면 크롬 확장프로그램 "추천물건 캡처 도우미"가 필요합니다.\n\n설치 방법\n1. 크롬 주소창에 chrome://extensions 입력\n2. 오른쪽 위 [개발자 모드] 켜기\n3. [압축해제된 확장 프로그램을 로드합니다] → 프로젝트의 tank-capture-extension 폴더 선택\n4. 이 페이지 새로고침\n\n※ 같은 크롬에서 탱크옥션에 로그인되어 있어야 합니다.';
// 캡처를 4MB 이하 JPEG로 정리 (가로 최대 1600px)
function shrink(dataUrl,maxW=1600){
  return new Promise((ok,no)=>{const im=new Image();im.onload=()=>{
    let k=Math.min(1,maxW/im.width);let q=0.86;
    const c=document.createElement('canvas');
    for(let t=0;t<6;t++){
      c.width=Math.round(im.width*k);c.height=Math.round(im.height*k);
      const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);g.drawImage(im,0,0,c.width,c.height);
      const out=c.toDataURL('image/jpeg',q);
      if(out.length<5.2e6) return ok(out);
      k*=0.8;q=Math.max(0.7,q-0.05);
    }
    no(new Error('캡처 이미지가 너무 큽니다.'));
  };im.onerror=()=>no(new Error('캡처 이미지를 읽지 못했습니다.'));im.src=dataUrl;});
}
async function captureInto(rec,status){
  if(!ext.ready){pingExt();await new Promise(r=>setTimeout(r,400));}
  if(!ext.ready){alert(EXT_GUIDE);throw new Error('확장프로그램 미설치');}
  if(!/^\d{4}타경\d+/.test((rec.case_no||'').replace(/\s/g,''))) throw new Error('사건번호를 먼저 입력·저장해주세요.');
  const manual=(rec.images||[]).filter(i=>i.source!=='auto').length;
  const res=await extCapture(rec.case_no,m=>status(m));
  if(!res.ok) throw new Error(res.error||'자동 캡처 실패');
  if(!res.images||!res.images.length) throw new Error('캡처할 영역을 찾지 못했습니다.');
  if(manual+res.images.length>6) throw new Error(`이미지는 최대 6장입니다. 직접 올린 이미지(${manual}장)를 줄여주세요.`);
  status('리포트에 저장하는 중...');
  for(const im of (rec.images||[]).filter(i=>i.source==='auto'))
    await recApi(`/api/recommendations/${rec.id}/images/${encodeURIComponent(im.file)}`,'DELETE');
  for(const im of res.images)
    await recApi(`/api/recommendations/${rec.id}/images`,'POST',{dataUrl:await shrink(im.dataUrl),caption:im.label,source:'auto'});
  // 캡처에서 읽은 값은 비어 있는 칸만 채움 (매각기일·법원 등 → 발송 전 체크에 사용)
  const patch={};
  for(const [k,v] of Object.entries(res.fields||{})){if(v!==null&&v!==undefined&&v!==''&&(rec[k]===null||rec[k]===undefined||rec[k]===''))patch[k]=v;}
  // 낙찰가율은 시세 정보라 재캡처 때 최신 값으로 갱신 (직접 고친 값은 유지)
  if(res.fields&&res.fields.win_rate&&rec.win_rate&&rec.win_rate===rec.win_rate_auto) patch.win_rate=res.fields.win_rate;
  if(res.fields&&res.fields.win_rate&&(patch.win_rate||!rec.win_rate)) patch.win_rate_auto=patch.win_rate||res.fields.win_rate;
  if(!rec.image_note) patch.image_note=`※ 출처: 탱크옥션 (${todayStr()} 캡처) · 개인정보는 가림 처리`;
  if(res.fields&&res.fields.auto_facts) patch.auto_facts=res.fields.auto_facts;
  // 권장 입찰가: 비어 있거나 이전 자동 계산값 그대로면 낙찰가율로 다시 계산 (직접 고친 값은 유지)
  {
    const m0={...rec,...patch}, b=calcBid(m0);
    const untouched=!num(rec.bid_low)&&!num(rec.bid_high) || (rec.bid_auto&&rec.bid_auto===`${num(rec.bid_low)}-${num(rec.bid_high)}`);
    if(b&&untouched) Object.assign(patch,{bid_low:b.bid_low,bid_high:b.bid_high,bid_auto:`${b.bid_low}-${b.bid_high}`});
  }
  // 추천 사유가 비어 있으면 자동 작성 (직접 쓴 내용은 그대로 둠)
  const merged={...rec,...patch};
  if(!(rec.reasons||[]).some(x=>(x.title||'').trim()||(x.body||'').trim())){
    const stu=(st.student&&st.student.id===rec.student_id)?st.student:(typeof students!=='undefined'?students.find(x=>x.id===rec.student_id):null);
    if(stu) patch.reasons=genReasons(stu,merged);
  }
  if(Object.keys(patch).length) await recApi(`/api/recommendations/${rec.id}`,'PUT',patch);
  return res;
}
async function autoCapture(){
  if(!st.cur) return;
  const btn=document.getElementById('recAutoBtn'),stEl=document.getElementById('recAutoStatus');
  const status=(m,err)=>{if(stEl){stEl.textContent=m;stEl.classList.toggle('err',!!err);}};
  try{
    readEditor();
    if(st.dirty||!st.cur.case_no) await save(true);
    if(btn) btn.disabled=true;
    status('탱크옥션 창을 여는 중... (작업이 끝날 때까지 그 창을 닫지 마세요)');
    const id=st.cur.id;
    const res=await captureInto(st.cur,status);
    await reload(id);select(id);
    const s2=document.getElementById('recAutoStatus');
    if(s2){s2.textContent=`✓ ${res.images.length}장 캡처 완료 (${res.images.map(i=>i.label).join(', ')})${res.masked?` · 이름 ${res.masked}건 가림`:''}${res.fields&&res.fields.win_rate?` · 낙찰가율 입력됨`:' · 낙찰가율은 직접 입력 필요'}${res.missing&&res.missing.length?` · 못 찾음: ${res.missing.join(', ')}`:''}`;}
  }catch(e){status('⚠ '+e.message,true);console.error(e);}
  finally{if(btn)btn.disabled=false;}
}
async function autoCaptureAll(){
  const targets=st.recs.filter(r=>!(r.images||[]).some(i=>i.source==='auto')&&r.case_no);
  if(!targets.length) return;
  if(!confirm(`${targets.length}건을 차례대로 자동 캡처합니다. 끝날 때까지 탱크옥션 창을 닫지 마세요. 진행할까요?`)) return;
  if(st.dirty) await save(true);
  const el=()=>document.getElementById('recBulkStatus');
  const fails=[];
  for(let i=0;i<targets.length;i++){
    const r=targets[i];
    try{await captureInto(r,m=>{const e=el();if(e)e.textContent=`(${i+1}/${targets.length}) ${r.case_no} · ${m}`;});}
    catch(e){fails.push(`${r.case_no}: ${e.message}`);if(e.message==='확장프로그램 미설치')break;}
    await new Promise(ok=>setTimeout(ok,1500));
  }
  await reload(st.cur&&st.cur.id);if(st.cur)select(st.cur.id);
  alert(`자동 캡처 완료: ${targets.length-fails.length}건 성공${fails.length?`\n\n실패 ${fails.length}건\n${fails.join('\n')}`:''}`);
}

/* ── PDF 생성 ── */
async function toDataUrl(url){
  const res=await fetch(url,{credentials:'same-origin'});
  if(!res.ok) throw new Error('이미지를 불러오지 못했습니다: '+url);
  const blob=await res.blob();
  return await new Promise((ok,no)=>{const fr=new FileReader();fr.onload=()=>ok(fr.result);fr.onerror=no;fr.readAsDataURL(blob);});
}
function imgSize(src){return new Promise(ok=>{const im=new Image();im.onload=()=>ok({w:im.naturalWidth||1,h:im.naturalHeight||1});im.onerror=()=>ok({w:1,h:1});im.src=src;});}
let LOGO=null;
async function logo(){if(!LOGO){try{LOGO=await toDataUrl('/report-logo.png');}catch(e){LOGO='';}}return LOGO;}

function secTitle(t,mt=22){
  return `<table style="border-collapse:collapse;margin:${mt}px 0 12px"><tr>
    <td style="width:4px;padding:0"><div style="width:4px;height:16px;background:${PURPLE}"></div></td>
    <td style="padding:0 0 0 8px"><div style="font-size:14.5px;font-weight:700;color:${PURPLE};line-height:16px">${t}</div></td>
  </tr></table>`;
}
function tile(label,value,sub,hl){
  return `<td style="width:16.66%;padding:0 3px;vertical-align:top">
    <div style="background:${hl?PURPLE_BG:'#f6f6f8'};border-radius:6px;padding:9px 9px 10px;height:62px;box-sizing:border-box">
      <div style="font-size:10px;color:#888;margin-bottom:5px;white-space:nowrap">${esc(label)}</div>
      <div style="font-size:13.5px;font-weight:800;color:${hl?PURPLE:'#222'};white-space:nowrap">${esc(value||'-')}</div>
      <div style="font-size:10px;color:#777;margin-top:3px;white-space:nowrap">${esc(sub||'')}</div>
    </div></td>`;
}
function stratRow(label,value,hl,first){
  return `<tr><td style="padding:9px 16px 9px 0;font-size:12px;color:#777;white-space:nowrap;vertical-align:top;${first?'':'border-top:1px solid #e9e9ec;'}">${esc(label)}</td>
    <td style="padding:9px 0;font-size:12.5px;font-weight:700;text-align:right;color:${hl?PURPLE:'#222'};${first?'':'border-top:1px solid #e9e9ec;'}">${esc(value||'-')}</td></tr>`;
}

async function renderRecPage(s,r,idx){
  const ctx=InvestmentRules.getReportContext(s);
  const noHouse=s.housing_type==='무주택'||s.housing_type==='생애최초',oneHouse=s.housing_type==='1주택';
  const transferLabel=s.transfer_available==='Y'?'전입가능':s.transfer_available==='N'?'전입불가':'미확인';
  const minPct=pct(r.min_price,r.appraisal);
  // 캡처에 이미 나오는 정보는 중복 입력하지 않아도 되므로, 6칸이 모두 비어 있으면 숨김
  const hasTiles=[r.prop_type,r.floor_main,r.occupancy,r.rights].some(v=>(v||'').trim());
  const pill=`<span style="display:inline-block;vertical-align:middle;background:${PURPLE};color:#fff;font-size:11.5px;font-weight:700;border-radius:12px;padding:3px 11px;line-height:16px">추천 #${String(idx+1).padStart(2,'0')}</span>`;
  const failTxt=num(r.fail_count)?`유찰 ${num(r.fail_count)}회`:'신건';
  const bidTxt=num(r.bid_low)
    ?`${man(r.bid_low)}${num(r.bid_high)&&num(r.bid_high)!==num(r.bid_low)?' ~ '+man(r.bid_high,'원'):'원'}${num(r.appraisal)?` (감정가 ${pct(r.bid_low,r.appraisal)}${num(r.bid_high)&&num(r.bid_high)!==num(r.bid_low)?'~'+pct(r.bid_high,r.appraisal):''}%)`:''}`
    :'';
  const caseLine=[r.case_no&&`사건번호 <b style="color:#222">${esc(r.case_no)}</b>`,r.court&&esc(r.court),r.sale_date&&`매각기일 <b style="color:#222">${fmtDate(r.sale_date)}</b>`,deposit(r)&&`입찰보증금 <b style="color:#222">${man(deposit(r),'원')}</b>`].filter(Boolean).join('<span style="color:#ccc"> &nbsp;|&nbsp; </span>');

  // 캡처 이미지: 가로로 긴 캡처(표·상세정보)는 전체 폭, 세로형은 2장씩 나란히
  const imgs=[];
  for(const im of r.images||[]){try{const src=await toDataUrl('/api/rec-images/'+im.file);const sz=await imgSize(src);imgs.push({src,caption:im.caption,wide:sz.w/sz.h>=1.25});}catch(e){console.error(e);}}
  let imgHtml='';
  if(imgs.length){
    const rows=[];
    for(let i=0;i<imgs.length;){
      if(imgs[i].wide||!imgs[i+1]||imgs[i+1].wide){rows.push([imgs[i]]);i++;}
      else{rows.push([imgs[i],imgs[i+1]]);i+=2;}
    }
    imgHtml=rows.map(row=>`<table style="width:100%;border-collapse:collapse;margin-bottom:8px"><tr>${row.map(im=>`
      <td style="width:${row.length===1?100:50}%;vertical-align:top;padding:0 ${row.length===1?0:4}px">
        <div style="border:1px solid #e3e3e6;border-radius:6px;overflow:hidden;background:#fff">
          ${im.caption?`<div style="font-size:9.5px;color:#888;background:#f6f6f8;padding:5px 8px;border-bottom:1px solid #eee">${esc(im.caption)}</div>`:''}
          <img src="${im.src}" style="width:100%;display:block">
        </div></td>`).join('')}</tr></table>`).join('')
      +(r.image_note?`<div style="font-size:10px;color:#999;margin-top:2px">${esc(r.image_note)}</div>`:'');
  }

  const reasons=(r.reasons||[]).filter(x=>(x.title||'').trim()||(x.body||'').trim());
  const reasonsHtml=reasons.map((x,i)=>`<table style="width:100%;border-collapse:collapse;margin-bottom:12px"><tr>
      <td style="width:30px;vertical-align:top;padding:0">
        <table style="width:22px;height:22px;border-collapse:collapse"><tr><td style="width:22px;height:22px;border-radius:50%;background:${PURPLE};color:#fff;font-size:12px;font-weight:700;text-align:center;vertical-align:middle;line-height:1;padding:0">${i+1}</td></tr></table>
      </td>
      <td style="vertical-align:top;padding:0">
        <div style="font-size:13px;font-weight:700;line-height:22px;color:#222">${esc(x.title)}</div>
        ${x.body?`<div style="font-size:12px;line-height:1.65;color:#555;margin-top:2px">${escBr(x.body)}</div>`:''}
      </td></tr></table>`).join('');

  const hasStrat=bidTxt||r.win_rate||r.rent||r.strategy_note;
  const stratHtml=hasStrat?`<div style="background:#f6f6f8;border-left:4px solid #333;border-radius:4px;padding:14px 18px;margin-top:8px">
      <div style="font-size:13px;font-weight:700;color:#222;margin-bottom:6px">※ 입찰 전략</div>
      <table style="width:100%;border-collapse:collapse">
        ${[bidTxt&&['권장 입찰가',bidTxt,true],r.win_rate&&['인근 낙찰가율',r.win_rate],r.rent&&['임대 세팅 예상',r.rent]].filter(Boolean).map((x,i)=>stratRow(x[0],x[1],x[2],i===0)).join('')}
      </table>
      ${r.strategy_note?`<div style="font-size:11.5px;line-height:1.75;color:#444;margin-top:10px;padding-top:10px;border-top:1px solid #e3e3e6">${escBr(r.strategy_note)}</div>`:''}
    </div>`:'';

  const lg=await logo();
  const container=document.createElement('div');
  container.style.cssText='position:fixed;left:-9999px;top:0;width:600px;background:#fff;font-family:"Apple SD Gothic Neo","Pretendard","Malgun Gothic",sans-serif;';
  container.innerHTML=`
  <div style="width:600px;box-sizing:border-box;background:#fff;border:1px solid #e3e3e3;border-radius:6px;overflow:hidden">
    <div style="background:${PURPLE};padding:20px 28px">
      <table style="width:100%;border-collapse:collapse"><tr>
        <td style="vertical-align:middle;padding:0"><div style="font-size:19px;font-weight:700;color:#fff">경매 추천물건 리포트</div></td>
        <td style="vertical-align:middle;padding:0;text-align:right">${lg?`<img src="${lg}" style="height:28px;width:104px;display:inline-block">`:''}</td>
      </tr></table>
    </div>
    <div style="padding:16px 28px 0">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <tr><td style="width:70px;padding:7px 0;color:#888">기수</td><td style="padding:7px 0;font-weight:600;color:#222">${esc(s.cohort)}</td>
            <td style="width:70px;padding:7px 0;color:#888">이름</td><td style="padding:7px 0;font-weight:600;color:#222">${esc(s.name)}님</td></tr>
        <tr><td style="padding:7px 0;color:#888;border-top:1px solid #f0f0f0">투자금</td><td style="padding:7px 0;font-weight:600;color:#222;border-top:1px solid #f0f0f0">${esc(ctx.seedLine.replace('시드 : ',''))}</td>
            <td style="padding:7px 0;color:#888;border-top:1px solid #f0f0f0">주택유형</td><td style="padding:7px 0;font-weight:600;color:#222;border-top:1px solid #f0f0f0">${esc(s.housing_type)}${(noHouse||oneHouse)?` (${transferLabel})`:''}</td></tr>
      </table>
    </div>
    <div style="padding:0 28px 22px">
      ${imgs.length?'':`${secTitle('추천 물건 개요',18)}
      <table style="border-collapse:collapse;margin-bottom:8px"><tr>
        <td style="padding:0;white-space:nowrap">${pill}</td>
        <td style="padding:0 0 0 10px;font-size:13px;color:#333">${esc(r.headline)}</td>
      </tr></table>`}
      ${caseLine&&!imgs.length?`<div style="font-size:11.5px;color:#777;margin:0 0 10px 2px">${caseLine}</div>`:''}
      ${hasTiles?`<table style="width:100%;border-collapse:collapse;margin:0 -3px;width:calc(100% + 6px)"><tr>
        ${tile('물건종류',r.prop_type,r.area)}
        ${tile('감정가',num(r.appraisal)?man(r.appraisal):'','')}
        ${tile(`최저가 (${failTxt})`,num(r.min_price)?man(r.min_price):'',minPct?minPct+'%':'',true)}
        ${tile('층 / 구조',r.floor_main,r.floor_sub)}
        ${tile('점유 / 임차인',r.occupancy,r.occupancy_sub)}
        ${tile('인수 권리',r.rights,r.rights_sub)}
      </tr></table>`:''}
      ${imgHtml?secTitle(`탱크옥션 물건 정보 &nbsp;${pill}`,18)+imgHtml:''}
      ${reasonsHtml?secTitle('추천 사유')+reasonsHtml:''}
      ${stratHtml}
    </div>
    <table style="width:100%;border-collapse:collapse;background:#fafafa;border-top:1px solid #eee"><tr>
      <td style="padding:14px 28px;font-size:10.5px;color:#999;line-height:1.6">${DISCLAIMER}</td>
    </tr></table>
  </div>`;
  document.body.appendChild(container);
  try{
    await Promise.all([...container.querySelectorAll('img')].map(im=>im.complete?null:new Promise(ok=>{im.onload=im.onerror=ok;})));
    return await html2canvas(container,{scale:2,backgroundColor:'#ffffff'});
  }finally{document.body.removeChild(container);}
}

async function dateImage(){
  const el=document.createElement('div');
  el.style.cssText='position:fixed;left:-9999px;top:0;font-family:"Apple SD Gothic Neo","Pretendard","Malgun Gothic",sans-serif;font-size:11px;color:#999;white-space:nowrap;background:#fff;padding:2px';
  el.textContent=`작성일 ${todayStr()}`;
  document.body.appendChild(el);
  try{return await html2canvas(el,{scale:2,backgroundColor:'#ffffff'});}finally{document.body.removeChild(el);}
}

/** 수강생 1명의 추천물건(들)을 PDF 1개로 생성 — 물건 1건당 1페이지 */
async function buildRecPDF(s,recs){
  const {jsPDF}=window.jspdf;
  const A4_W=595.28,A4_H=841.89;
  const dc=await dateImage();const dW=dc.width/2,dH=dc.height/2;const dImg=dc.toDataURL('image/png');
  let pdf=null;
  for(let i=0;i<recs.length;i++){
    const idx=st.recs.findIndex(x=>x.id===recs[i].id);
    const canvas=await renderRecPage(s,recs[i],idx>=0?idx:i);
    const imgW=A4_W-60,imgH=canvas.height*imgW/canvas.width;
    const pageH=Math.max(A4_H,imgH+60+30); // 내용이 길면 페이지를 늘림 (압축하지 않음)
    if(!pdf) pdf=new jsPDF({unit:'pt',format:[A4_W,pageH]});
    else pdf.addPage([A4_W,pageH]);
    pdf.addImage(canvas.toDataURL('image/jpeg',0.92),'JPEG',30,30,imgW,imgH);
    pdf.addImage(dImg,'PNG',A4_W-30-dW,pageH-25-dH,dW,dH);
  }
  const fname=recs.length===1
    ?`${s.cohort}_${s.name}_추천물건_${(recs[0].case_no||'미정').replace(/[\\/:*?"<>|]/g,'')}.pdf`
    :`${s.cohort}_${s.name}_추천물건리포트.pdf`;
  return {pdf,filename:fname};
}

async function pdf(ids){
  try{
    if(st.dirty) await save(true);
    const recs=ids?st.recs.filter(r=>ids.includes(r.id)):st.recs;
    if(!recs.length){alert('추천물건이 없습니다.');return;}
    const issues=recs.flatMap(r=>checkRec(r).map(x=>`[${r.case_no||'사건번호 없음'}] ${x}`));
    const notReviewed=recs.filter(r=>r.status==='작성중');
    if(issues.length||notReviewed.length){
      const msg=[...issues,...(notReviewed.length?[`검수완료 전 상태인 물건 ${notReviewed.length}건`]:[])].slice(0,12).join('\n');
      if(!confirm(`아래 항목을 확인하세요. 그래도 PDF를 만들까요?\n\n${msg}`)) return;
    }
    document.body.style.cursor='progress';
    const {pdf:doc,filename}=await buildRecPDF(st.student,recs);
    doc.save(filename);
    const sendable=recs.filter(r=>r.status==='검수완료');
    if(sendable.length&&confirm(`카톡으로 발송하셨다면 ${sendable.length}건을 [발송완료]로 표시할까요?`)){
      for(const r of sendable) await recApi(`/api/recommendations/${r.id}`,'PUT',{status:'발송완료'});
      await reload(st.cur&&st.cur.id);if(st.cur)select(st.cur.id);
    }
  }catch(e){alert('PDF 생성 오류: '+e.message);console.error(e);}
  finally{document.body.style.cursor='';}
}

/* ── 구글시트 요약 탭 → 추천물건 초안 일괄 생성 ── */
const CASE_RE=/(\d{4})\s*타경\s*(\d+)/g;
function parseRecCell(text){
  // "2025타경52471\n경기 광주 아파트" / "2024타경52015 평택 아파트" → [{case_no, headline}]
  const s=String(text||'');const out=[];const ms=[...s.matchAll(CASE_RE)];
  ms.forEach((m,i)=>{
    const end=i+1<ms.length?ms[i+1].index:s.length;
    const rest=s.slice(m.index+m[0].length,end).replace(/\s+/g,' ').replace(/^[\s,·/\-]+|[\s,·/\-]+$/g,'').trim();
    out.push({case_no:`${m[1]}타경${m[2]}`,headline:rest});
  });
  return out;
}
async function importRecSheet(input){
  const file=input.files[0];input.value='';if(!file) return;
  try{
    const wb=XLSX.read(await file.arrayBuffer(),{type:'array'});
    const sheetName=wb.SheetNames.find(n=>n.trim()==='요약')||wb.SheetNames.find(n=>n.includes('요약'))||wb.SheetNames[0];
    const rows=XLSX.utils.sheet_to_json(wb.Sheets[sheetName],{header:1,defval:''});
    let hi=rows.findIndex(r=>r.some(c=>String(c).includes('추천물건')));
    if(hi<0){alert(`'${sheetName}' 시트에서 '추천물건' 열을 찾지 못했습니다.`);return;}
    const header=rows[hi].map(h=>String(h).replace(/\s/g,''));
    const iC=header.findIndex(h=>h.includes('기수')),iN=header.findIndex(h=>h==='이름'||h.includes('성함')||h.includes('이름'));
    const recCols=header.map((h,i)=>h.startsWith('추천물건')?i:-1).filter(i=>i>=0);
    const items=[];
    for(let r=hi+1;r<rows.length;r++){
      const row=rows[r];const name=String(row[iN]||'').trim();if(!name) continue;
      const cohort=String(row[iC]||'').trim();
      for(const ci of recCols){
        const manager=header[ci+1]&&header[ci+1].includes('담당자')?String(row[ci+1]||'').trim():'';
        for(const p of parseRecCell(row[ci])) items.push({cohort,name,manager,...p});
      }
    }
    if(!items.length){alert('사건번호가 입력된 추천물건이 없습니다.');return;}
    const people=new Set(items.map(x=>x.cohort+x.name)).size;
    if(!confirm(`'${sheetName}' 시트에서 추천물건 ${items.length}건 (수강생 ${people}명)을 찾았습니다.\n이미 등록된 사건번호는 건너뛰고, 새 물건만 '작성중' 초안으로 만듭니다. 진행할까요?`)) return;
    const res=await recApi('/api/recommendations/import','POST',{items});
    let msg=`새 초안 ${res.created}건 생성 · 중복/형식오류 ${res.skipped}건 건너뜀`;
    if(res.unmatched.length) msg+=`\n\n사이트에 없는 수강생 ${res.unmatched.length}명 (기수·이름 확인 필요):\n${res.unmatched.slice(0,15).join(', ')}${res.unmatched.length>15?' 외':''}`;
    alert(msg);
    await loadSummary();if(typeof render==='function')render();
  }catch(e){alert('시트 가져오기 오류: '+e.message);console.error(e);}
}

/* ── 초기화 ── */
function init(){injectUI();bindMask();pingExt();window.addEventListener('resize',()=>{if(document.getElementById('maskModal').classList.contains('show'))fitMask();});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();

window.RecReport={autoBid,calcBid,autoReasons,genReasons,autoCapture,autoCaptureAll,imgEdit,open,close,select,add,save,remove,move,pdf,imgDel,imgMove,maskMode,maskUndo,maskCropApply,maskDone,maskCancel,loadSummary,cardLine,parseRecCell,checkRec,buildRecPDF};
})();
