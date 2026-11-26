// 추천물건 리포트 — 추천 사유·권장 입찰가 자동 작성, 발송 전 확인
// recommend/core.js 다음에 불러옴. 공통 기능은 RecCore에서 받음.
(function(){
const R=window.RecCore;
const {st,num,man,pct,deposit,readEditor,save}=R;

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
  // 수도권은 비규제지역이라도 대출을 받으면 전입(1주택은 처분까지) 조건이 붙으므로 조건 없이 단정하지 않음
  if(rg&&rg.key==='nreg') b1.push(many?'비규제지역이라 현금·신용대출로 매수하면 기존 주택 처분·전입 조건이 없습니다.':'비규제지역이라 규제지역보다 대출 한도가 높습니다.');
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
  if(f.rightsSummary) b2.push(f.rightsSummary); // 정보지의 권리분석요약 첫 문장
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

Object.assign(R,{calcBid,genReasons,checkRec});
Object.assign(window.RecReport,{autoBid,calcBid,autoReasons,genReasons,checkRec});
})();
