// 수강생 컨설팅 화면 — 카드 뷰: 색상·요약칸·수강생 카드
// (일반 script: 함수·변수는 다른 app/*.js 와 전역으로 공유, index.html 에서 순서대로 불러옴)
/* ── 색상 ── */
const SC={O:{bg:'#eaf3de',tx:'#27500a'},T:{bg:'#faeeda',tx:'#633806'},X:{bg:'#fcebeb',tx:'#791f1f'},E:{bg:'#ececec',tx:'#555'}};
const SM={O:'✓',T:'△',X:'✕',E:'⚠'};
const HC={'생애최초':{bg:'#e6f1fb',tx:'#0c447c'},'무주택':{bg:'#eaf3de',tx:'#27500a'},'1주택':{bg:'#faeeda',tx:'#633806'},'다주택':{bg:'#fcebeb',tx:'#791f1f'},'미기입':{bg:'#ececec',tx:'#555'}};
function ll(l){return l==='Y'?'대출가능':l==='N'?'대출불가':'대출미확인';}
function ynStyle(v){return v==='Y'?'color:#27500a;font-weight:600':v==='N'?'color:#c0392b;font-weight:600':'color:#aaa';}
function tl(t){return t==='Y'?'전입가능':t==='N'?'전입불가':'전입미기재';}
function flb(f){return f==='기대출'?'⚠ 기대출':f==='전문가확인'?'★ 전문가확인':'↗ 명의활용';}

/* ── 카드 렌더링 ── */
function render(){
  const t=students.length;
  const fi=students.filter(s=>s.housing_type==='생애최초').length;
  const no=students.filter(s=>s.housing_type==='무주택').length;
  const on=students.filter(s=>s.housing_type==='1주택').length;
  const mu=students.filter(s=>s.housing_type==='다주택').length;
  const ms=(bg,tx,lb,v)=>`<div class="stat" style="background:${bg}"><div class="slb" style="color:${tx}">${lb}</div><div class="sval" style="color:${tx}">${v}명</div></div>`;
  document.getElementById('stats').innerHTML=ms('#f0ede6','#5f5e5a','전체',t)+ms('#e6f1fb','#0c447c','생애최초',fi)+ms('#eaf3de','#27500a','무주택',no)+ms('#faeeda','#633806','1주택',on)+ms('#fcebeb','#791f1f','다주택',mu);
  document.getElementById('cards').innerHTML=students.map(d=>{
    const c=consult(d),cr=d.credit_amount||0,total=d.seed_amount+cr;
    const flags=d.flags||[],hc=HC[d.housing_type]||HC['1주택'];
    return `<div class="card">
      <div class="card-head">
        <div class="av">${d.cohort}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <span style="font-size:15px;font-weight:700">${d.name}</span>
            <span class="tag" style="background:${hc.bg};color:${hc.tx}">${d.housing_type}</span>
            <span style="font-size:12px;color:#aaa"><span style="${ynStyle(d.loan_available)}">${ll(d.loan_available)}</span>
              · <span style="${ynStyle(d.transfer_available)}">${tl(d.transfer_available)}</span></span>
            ${flags.filter(f=>f!=='전문가확인').map(f=>`<span class="flg">${flb(f)}</span>`).join('')}
          </div>
        </div>
        <div class="card-right">
          <div class="rep-btns">
            <button class="rep-btn" onclick='generateReportPDF(${JSON.stringify(d)})' title="1차: 투자 방향성 리포트 PDF 받기">📄 방향성 리포트</button>
            ${window.RecReport&&!previewMode?RecReport.cardLine(d):''}
          </div>
          <div class="card-amt">
            <div style="font-size:15px;font-weight:700">${fmt(d.seed_amount)}</div>
            ${cr>0?`<div style="font-size:12px;color:#0c447c">+신용 ${fmt(cr)}</div><div style="font-size:13px;font-weight:700;color:#0c447c">합산 ${fmt(total)}</div>`:''}
          </div>
          <div style="display:flex;gap:4px;align-items:center">
            <button class="edit-btn-inline" onclick='openEdit(${JSON.stringify(d)})' title="수강생 정보 수정">수정</button>
            <button class="del-btn-inline" onclick="delS(${d.id},'${d.name}','${d.cohort}')" title="삭제">삭제</button>
          </div>
        </div>
      </div>
      <div class="rg">
        ${[['수도권 규제',c.reg],['수도권 비규제',c.nreg],['비수도권',c.local]].map(([lb,r])=>
          `<div class="rbox" style="background:${SC[r.st].bg};color:${SC[r.st].tx}">
            <div class="rl">${lb}</div>
            <div class="rv">${SM[r.st]} ${r.lb}</div>
            ${r.nt?`<div class="rn">${r.nt}</div>`:''}
          </div>`).join('')}
      </div>
      <div class="ltv-info">📊 LTV 기준 — <strong>${c.ltvLabel}</strong></div>
      <div class="bid-row" style="display:block">
        <div class="bl" style="margin-bottom:3px">입찰 가능 금액대</div>
        <div class="bv">${c.bid}</div>
      </div>
    </div>`;
  }).join('')||'<p style="color:#aaa;padding:2rem;text-align:center">조건에 맞는 수강생이 없습니다.</p>';
}
