// 추천물건 리포트 — 구글시트 요약 탭 → 추천물건 초안 일괄 생성
// recommend.js 다음에 불러옴. 공통 기능은 RecCore에서 받음.
(function(){
const R=window.RecCore;
const {recApi,loadSummary}=R;

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

Object.assign(R,{importRecSheet});
Object.assign(window.RecReport,{parseRecCell});
})();
