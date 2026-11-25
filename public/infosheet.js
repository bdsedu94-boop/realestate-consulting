// 탱크옥션 '상세정보' 화면을 PDF로 저장한 경매 정보지를 읽어 물건 리포트 칸을 채웁니다.
// 브라우저(recommend.js)와 테스트(node)가 함께 사용합니다. PDF 글자 추출은 pdf.js가 하고,
// 이 파일은 글자 위치(items)를 받아 줄로 묶고, 물건 칸 값과 캡처할 영역을 찾습니다.
(function(root,factory){
  if(typeof module==='object'&&module.exports) module.exports=factory();
  else root.InfoSheet=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';

const norm=s=>String(s||'').replace(/\s/g,'');
const toMan=s=>{const d=String(s||'').replace(/[^\d]/g,'');return d.length>=5?Math.round(parseInt(d,10)/10000):null;};

/** 글자 조각 → 단어(붙어 있는 조각 합침) → 줄. items: {p,x,y,w,h,s} (y는 위에서부터, 글자 기준선) */
function toLines(items){
  const byPage={};
  for(const it of items){if(!String(it.s).trim())continue;(byPage[it.p]=byPage[it.p]||[]).push(it);}
  const lines=[];
  for(const p of Object.keys(byPage).map(Number).sort((a,b)=>a-b)){
    const rows=[];
    for(const it of byPage[p].sort((a,b)=>a.y-b.y||a.x-b.x)){
      const r=rows.find(r=>Math.abs(r.y-it.y)<2.2);
      if(r) r.items.push(it); else rows.push({p,y:it.y,items:[it]});
    }
    for(const r of rows){
      r.items.sort((a,b)=>a.x-b.x);
      const words=[];
      for(const it of r.items){
        const w=words[words.length-1];
        // 글자 간격이 1pt 미만이면 같은 단어 (띄어쓰기는 보통 2pt 이상)
        if(w&&it.x-(w.x+w.w)<1){w.s+=it.s;w.w=it.x+it.w-w.x;w.h=Math.max(w.h,it.h);}
        else words.push({p,x:it.x,y:it.y,w:it.w,h:it.h,s:String(it.s)});
      }
      lines.push({p,y:r.y,words,text:words.map(w=>w.s).join(' ')});
    }
  }
  return lines;
}

const HEADS={
  case:/^경매\d{4}타경\d+/, land:/^토지\/건물현황/, tenant:/^임차인현황/, building:/^건물등기/, landReg:/^토지등기/,
  caution:/^참고\/주의/, summary:/^권리분석요약/, related:/^관련사건/, loan:/^예상대출한도/, sales:/^매각사례/, trade:/^국토부/
};
function findHead(lines,key,from){
  const i=lines.findIndex((l,k)=>k>=(from||0)&&HEADS[key].test(norm(l.text)));
  return i<0?null:i;
}
// 같은 높이에서 label 단어 오른쪽에 있는 첫 값 (label과 값이 반 줄 어긋나는 경우 포함)
function rightOf(lines,label,re,maxDx){
  for(const l of lines){
    const w=l.words.find(w=>norm(w.s)===label);
    if(!w) continue;
    const cands=lines.filter(o=>o.p===l.p&&Math.abs(o.y-l.y)<7).flatMap(o=>o.words)
      .filter(o=>o.x>w.x+w.w-1&&o.x-w.x<(maxDx||200)).sort((a,b)=>a.x-b.x);
    for(const c of cands){const m=c.s.match(re);if(m) return m;}
  }
  return null;
}
const KINDS=[
  '아파트','연립주택','다세대주택','다세대','오피스텔','단독주택','다가구주택','다가구','도시형생활주택','주상복합','근린주택','근린상가','근린시설','상가',
  '점포','사무실','공장','창고','토지','대지','임야','숙박시설','기타'
];
const SIDO=/^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충청|충북|충남|전라|전북|전남|경상|경북|경남|제주)/;

/** 정보지 → 물건 칸 값과 리포트용 사실(auto_facts) */
function parse(lines){
  const f={}, facts={};
  const all=lines.map(l=>l.text).join('\n'), allN=norm(all);
  const head=lines.find(l=>HEADS.case.test(norm(l.text)));
  if(!head) throw new Error('탱크옥션 경매 정보지 형식이 아닙니다. (첫 줄에 "경매 ○○○○타경○○○"이 있어야 합니다)');
  const hn=norm(head.text);
  const cm=hn.match(/(\d{4})타경(\d+)/); f.case_no=`${cm[1]}타경${cm[2]}`;
  const court=hn.match(/타경\d+(\S*?(?:지방법원|지원))/); if(court) f.court=court[1];
  const top=lines.filter(l=>l.p===head.p&&l.y>=head.y&&l.y<head.y+120);
  const sd=allN.match(/매각일자(\d{4})\.(\d{2})\.(\d{2})/); if(sd) f.sale_date=`${sd[1]}-${sd[2]}-${sd[3]}`;
  const kindLine=top.find(l=>KINDS.includes(norm(l.text))||KINDS.includes(norm(l.words[0]&&l.words[0].s)));
  if(kindLine){const k=KINDS.includes(norm(kindLine.text))?norm(kindLine.text):norm(kindLine.words[0].s);f.prop_type=k;facts.propType=k;}
  const addr=lines.find(l=>l.p===head.p&&l.y>head.y&&l.y<head.y+80&&SIDO.test(norm(l.text))&&!/도로명/.test(l.text));
  if(addr){facts.address=addr.text.replace(/\s+/g,' ').trim();}
  const pub=allN.match(/공시가([0-9~억이하미만초과]+)/); if(pub) facts.pubPrice=pub[1];
  const am=allN.match(/건물면적([\d.]+)㎡\(([\d.]+)평\)/); if(am) f.area=`${(+am[1]).toFixed(2)}㎡(${(+am[2]).toFixed(1)}평)`;
  const flLine=lines.find(l=>/(?:^|\s)\d{1,2}층\s*중\s*\d{1,2}층/.test(l.text));
  const fl=flLine&&flLine.text.match(/(?:^|\s)(\d{1,2})층\s*중\s*(\d{1,2})층/); if(fl) f.floor_main=`${fl[2]}층 / 총 ${fl[1]}층`;
  const ap=rightOf(lines,'감정가',/^([\d,]{9,})$/); if(ap) f.appraisal=toMan(ap[1]);
  const mp=rightOf(lines,'최저가',/^(?:\(([\d.]+)%\))?([\d,]{7,})$/)||rightOf(lines,'최저가',/^([\d,]{7,})$/);
  if(mp) f.min_price=toMan(mp[mp.length-1]);
  const dp=allN.match(/보증금\((\d+)%\)/); if(dp) f.deposit_rate=+dp[1];
  // 유찰 횟수: 회차표의 '유찰'
  const roundLines=lines.filter(l=>l.p===head.p&&/^\d+차/.test(norm(l.text).replace(/^.*?(\d+차)/,'$1'))&&/\d{4}-\d{2}-\d{2}/.test(l.text));
  f.fail_count=roundLines.filter(l=>/유찰/.test(l.text)).length;
  // 지역·물건 한 줄 요약
  if(facts.address){
    const t=facts.address.split(' ');
    const sido=t[0].replace(/(통합특별시|특별자치시|특별자치도|특별시|광역시|도)$/,'');
    f.headline=[sido,t[1],f.prop_type].filter(Boolean).join(' ');
  }

  // 임차인 현황
  const ti=findHead(lines,'tenant');
  if(ti!=null){
    const end=['building','landReg','caution','summary','related'].map(k=>findHead(lines,k,ti+1)).filter(x=>x!=null).sort((a,b)=>a-b)[0];
    const sec=lines.slice(ti,end==null?undefined:end);
    if(sec.some(l=>/조사된임차내역없음/.test(norm(l.text)))){facts.tenants=0;facts.tenantsWithPriority=0;}
    else{
      const hdr=sec.find(l=>l.words.some(w=>norm(w.s)==='대항력'));
      const dx=hdr?hdr.words.find(w=>norm(w.s)==='대항력').x:null;
      const rows=sec.filter(l=>l!==hdr&&l.words[0]&&/^\d+$/.test(norm(l.words[0].s))&&l.words[0].x<70);
      facts.tenants=rows.length;
      facts.tenantsWithPriority=rows.filter(r=>{
        const near=sec.filter(l=>l.p===r.p&&l.y>=r.y-1&&l.y<r.y+30).flatMap(l=>l.words).filter(w=>dx!=null&&Math.abs(w.x-dx)<25);
        return near.some(w=>/있음|인수/.test(w.s));
      }).length;
    }
  }
  if(/폐문/.test(allN)) facts.closedDoor=true;

  // 건물등기: 말소기준권리, 소멸되지 않는 권리
  const bi=findHead(lines,'building');
  if(bi!=null){
    const end=['landReg','caution','summary','related','loan','sales'].map(k=>findHead(lines,k,bi+1)).filter(x=>x!=null).sort((a,b)=>a-b)[0];
    const sec=lines.slice(bi+1,end==null?undefined:end);
    const assumed=[];
    for(const l of sec){
      if(!/^(갑|을)\(\d+\)/.test(norm(l.text))) continue;
      // 소멸 표시가 반 줄 위·아래에 찍히는 행이 있어 같은 행의 위아래 줄까지 함께 봄
      const n=norm(sec.filter(o=>o.p===l.p&&o.y>=l.y-7&&o.y<l.y+6).map(o=>o.text).join(' '));
      const date=(l.text.match(/\d{4}-\d{2}-\d{2}/)||[])[0];
      const kind=(n.match(/(소유권이전|소유권보존|근저당권설정|근저당권|저당권|가압류|압류|가처분|전세권|지상권|담보가등기|가등기|강제경매|임의경매|주택임차권|임차권)/)||[])[1];
      if(/말소기준/.test(n)&&kind) facts.baseRight={kind,date:date||''};
      if(kind&&!/소멸/.test(n)&&!/^(소유권이전|소유권보존|강제경매|임의경매)$/.test(kind)) assumed.push(kind);
    }
    facts.assumedRights=[...new Set(assumed)];
  }
  // 권리분석요약 첫 문장
  const si=findHead(lines,'summary');
  if(si!=null&&lines[si+1]) facts.rightsSummary=lines[si+1].text.replace(/\s+/g,' ').trim();

  // 매각사례 → 인근 낙찰가율 '최저% ~ 최고% (최근 12개월 N건 · 지역)'
  const mi=findHead(lines,'sales');
  if(mi!=null){
    const region=(lines[mi].text.match(/\(([^)]+)\)/)||[])[1];
    const rows=[];
    for(const l of lines.slice(mi+1,mi+12)){
      const n=norm(l.text), m=n.match(/^최근(\d+)개월\((\d+)건\)/);
      if(!m) continue;
      const rate=l.words.map(w=>norm(w.s)).find(s=>/^\d{1,3}\.\d{1,2}$/.test(s)&&+s>=10&&+s<=200);
      if(rate) rows.push({mon:+m[1],cnt:+m[2],rate:+rate});
    }
    if(rows.length){
      const rates=rows.map(r=>r.rate), last=rows[rows.length-1];
      const lo=Math.min(...rates), hi=Math.max(...rates);
      f.win_rate=`${lo.toFixed(1)}% ~ ${hi.toFixed(1)}% (최근 ${last.mon}개월 ${last.cnt}건${region?' · '+region.replace(/\s+/g,' ').trim():''})`;
    }
  }
  f.auto_facts=JSON.stringify(facts);
  return f;
}

/** 캡처 영역: 경매정보(첫머리 ~ 토지/건물 현황 전). 첫 쪽만 */
function captureArea(lines,pageH){
  const ci=findHead(lines,'case'), li=findHead(lines,'land');
  if(ci==null) return null;
  const s=lines[ci], e=li!=null&&lines[li].p===s.p?lines[li]:null;
  const onP=lines.filter(l=>l.p===s.p&&(!e||l.y<e.y));
  // 위는 오른쪽 위 TANK 로고까지 넉넉히 (빈 여백은 그린 뒤 잘라냄)
  const y0=Math.max(0,s.y-26), y1=Math.min(pageH||842,e?e.y-16:Math.max(...onP.map(l=>l.y))+8);
  return y1-y0>20?{p:s.p,y0,y1}:null;
}

return {toLines,parse,captureArea};
});
