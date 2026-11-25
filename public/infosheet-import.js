// 경매 정보지 PDF → 물건 자동 작성 (사건 정보·경매정보 캡처·검토 포인트·권장 입찰가)
// 화면 버튼: 추천물건 관리의 [📄 경매 정보지 PDF로 추가]. 해석은 infosheet.js, 저장·계산은 recommend.js(RecCore).
// 개인정보는 정보지를 올리기 전에 가린 상태여야 합니다 (이 파일은 이름을 가리지 않음).
(function(){
'use strict';
const PDF_BASE='/vendor/pdfjs/';
let PDFJS=null;

async function loadPdfJs(){
  if(PDFJS) return PDFJS;
  await new Promise((ok,no)=>{
    const sc=document.createElement('script');sc.src=PDF_BASE+'build/pdf.min.js';sc.onload=ok;
    sc.onerror=()=>no(new Error('PDF 읽기 도구를 불러오지 못했습니다. 새로고침 후 다시 시도해주세요.'));
    document.head.appendChild(sc);
  });
  PDFJS=window.pdfjsLib;PDFJS.GlobalWorkerOptions.workerSrc=PDF_BASE+'build/pdf.worker.min.js';
  return PDFJS;
}

function pick(){
  if(!RecCore.st.student) return;
  const inp=document.createElement('input');inp.type='file';inp.accept='.pdf,application/pdf';inp.multiple=true;
  inp.onchange=()=>{if(inp.files.length) addFiles([...inp.files]);};
  inp.click();
}

async function addFiles(files){
  const C=RecCore;
  if(C.st.dirty) await C.save(true);
  const say=m=>{const e=document.getElementById('recBulkStatus');if(e){e.textContent=m;e.classList.remove('err');}};
  const done=[],fails=[];let lastId=null;
  for(let i=0;i<files.length;i++){
    const pre=files.length>1?`(${i+1}/${files.length}) `:'';
    try{const r=await addOne(files[i],m=>say(pre+files[i].name+' · '+m));done.push(r.case_no);lastId=r.id;}
    catch(e){console.error(e);fails.push(`${files[i].name}: ${e.message}`);}
  }
  await C.reload(lastId||(C.st.cur&&C.st.cur.id));if(lastId) C.select(lastId);
  say(done.length?`✓ ${done.length}건 작성 완료 (${done.join(', ')}) · 검토 후 PDF를 받으세요`:'');
  if(fails.length) alert(`정보지 ${fails.length}건을 읽지 못했습니다.\n\n${fails.join('\n')}`);
}

// PDF → 글자 위치(items) + 쪽별 그리기 정보
async function readPdf(file){
  const lib=await loadPdfJs();
  const doc=await lib.getDocument({
    data:new Uint8Array(await file.arrayBuffer()),
    cMapUrl:PDF_BASE+'cmaps/',cMapPacked:true,standardFontDataUrl:PDF_BASE+'standard_fonts/'
  }).promise;
  const items=[],views={};
  for(let p=1;p<=doc.numPages;p++){
    const pg=await doc.getPage(p),vp=pg.getViewport({scale:1});views[p]={pg,h:vp.height,w:vp.width};
    for(const it of (await pg.getTextContent()).items){
      if(!it.str||!it.str.trim()) continue;
      const h=it.height||Math.abs(it.transform[0]);
      items.push({p,x:it.transform[4],y:vp.height-it.transform[5],w:it.width,h,s:it.str});
    }
  }
  if(!items.length) throw new Error('글자를 읽을 수 없는 PDF입니다. (스캔 이미지가 아닌, 탱크옥션 화면을 PDF로 저장한 파일이어야 합니다)');
  return {items,views};
}

async function addOne(file,status){
  const C=RecCore;
  status('PDF 읽는 중...');
  const {items,views}=await readPdf(file);
  const lines=InfoSheet.toLines(items);
  const f=InfoSheet.parse(lines);
  // 같은 수강생에게 같은 사건번호가 있으면 그 물건을 채우고, 없으면 새로 만듦
  let rec=C.st.recs.find(r=>(r.case_no||'').replace(/\s/g,'')===f.case_no);
  if(!rec){
    status('물건 만드는 중...');
    rec=await C.recApi(`/api/students/${C.st.student.id}/recommendations`,'POST',{case_no:f.case_no});
  }
  await putCapture(rec,lines,views,status);
  status('칸 채우는 중...');
  await C.recApi(`/api/recommendations/${rec.id}`,'PUT',fillPatch(rec,f));
  return {id:rec.id,case_no:f.case_no};
}

// 경매정보 영역 캡처 1장으로 자동 이미지 교체 (직접 올린 이미지는 유지)
async function putCapture(rec,lines,views,status){
  const C=RecCore;
  const area=InfoSheet.captureArea(lines,views[1].h);
  if(!area) return;
  status('캡처 만드는 중...');
  const dataUrl=await renderArea(views[area.p],area);
  const manual=(rec.images||[]).filter(i=>i.source!=='auto').length;
  if(manual+1>6) throw new Error(`이미지는 최대 6장입니다. 직접 올린 이미지(${manual}장)를 줄여주세요.`);
  for(const im of (rec.images||[]).filter(i=>i.source==='auto'))
    await C.recApi(`/api/recommendations/${rec.id}/images/${encodeURIComponent(im.file)}`,'DELETE');
  await C.recApi(`/api/recommendations/${rec.id}/images`,'POST',
    {dataUrl:await C.shrink(dataUrl),caption:'탱크옥션 · 경매정보',source:'auto'});
}

// 바꿀 칸: 정보지 값은 비어 있는 칸만 채움 (직접 고친 값은 유지).
// 보증금 비율(기본값 10%가 있음)·권리 사실·자동 낙찰가율은 최신 정보지로 갱신.
function fillPatch(rec,f){
  const C=RecCore, patch={};
  const empty=v=>v===null||v===undefined||v==='';
  for(const [k,v] of Object.entries(f)){
    if(empty(v)) continue;
    if(k==='auto_facts'||k==='deposit_rate'||empty(rec[k])) patch[k]=v;
  }
  if(f.win_rate&&(!rec.win_rate||rec.win_rate===rec.win_rate_auto)){patch.win_rate=f.win_rate;patch.win_rate_auto=f.win_rate;}
  if(!rec.image_note) patch.image_note=`※ 출처: 탱크옥션 경매 정보지 (${C.todayStr()}) · 개인정보는 가림 처리`;
  const merged={...rec,...patch};
  const b=C.calcBid(merged);
  const lo=C.num(rec.bid_low), hi=C.num(rec.bid_high);
  const untouched=(!lo&&!hi)||(rec.bid_auto&&rec.bid_auto===`${lo}-${hi}`);
  if(b&&untouched) Object.assign(patch,{bid_low:b.bid_low,bid_high:b.bid_high,bid_auto:`${b.bid_low}-${b.bid_high}`});
  const noReasons=!(rec.reasons||[]).some(x=>(x.title||'').trim()||(x.body||'').trim());
  if(noReasons) patch.reasons=C.genReasons(C.st.student,{...merged,...patch});
  return patch;
}

// PDF 한 쪽을 그려서 영역만 잘라 JPEG로
async function renderArea(view,area){
  const SC=2, X0=28, X1=view.w-28;
  const full=document.createElement('canvas');full.width=Math.ceil(view.w*SC);full.height=Math.ceil(view.h*SC);
  await view.pg.render({canvasContext:full.getContext('2d'),viewport:view.pg.getViewport({scale:SC})}).promise;
  const c=document.createElement('canvas');c.width=Math.round((X1-X0)*SC);c.height=Math.round((area.y1-area.y0)*SC);
  c.getContext('2d').drawImage(full,X0*SC,area.y0*SC,c.width,c.height,0,0,c.width,c.height);
  return c.toDataURL('image/jpeg',0.9);
}

window.InfoSheetImport={pick,addFiles};
})();
