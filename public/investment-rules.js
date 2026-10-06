// 투자방향성의 단일 기준: 상담 화면·CSV·PDF와 자료실 API가 함께 사용합니다.
// 계산식, 판정 기준, 참고 문구는 이 파일에서 수정하세요. 자세한 연결 구조는 README.md 참고.
(function(root,factory){
  if(typeof module==='object'&&module.exports) module.exports=factory();
  else root.InvestmentRules=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';

function fmt(v){if(v>=10000){const a=Math.floor(v/10000),r=v%10000;return r?`${a}억 ${r.toLocaleString()}만원`:`${a}억원`;}return `${v.toLocaleString()}만원`;}

function tierLabel(amt){
  if(amt<=10000) return{propType:'빌라',regionTag:' (인천, 부천)'};
  if(amt<=15000) return{propType:'APT·빌라',regionTag:''};
  if(amt<=30000) return{propType:'APT',regionTag:' (인천, 경기외곽)'};
  return{propType:'APT',regionTag:''};
}

// 수도권·규제지역 주택구입목적 주담대 총액한도 반영.
// 주택가격 15억원 이하 6억원 / 15억원 초과~25억원 이하 4억원 / 25억원 초과 2억원.
// LTV로 계산한 입찰가와 자기자금+해당 구간 대출한도 중 실제 가능한 최대 금액을 사용합니다.
function metroBidWithLoanCap(total,ltv){
  const raw=Math.round(total/(1-ltv)/100)*100;
  const tiers=[
    {min:0,max:150000,cap:60000},
    {min:150000,max:250000,cap:40000},
    {min:250000,max:Infinity,cap:20000}
  ];
  let best=0;
  for(const t of tiers){
    let candidate=Math.min(raw,total+t.cap,t.max);
    candidate=Math.floor(candidate/100)*100;
    if(candidate<=t.min) continue;
    const requiredLoan=Math.max(0,candidate-total);
    if(requiredLoan<=t.cap&&candidate<=raw) best=Math.max(best,candidate);
  }
  return best||Math.min(raw,total);
}
function formatBidNarrative(d,forceDanta,forceResidence){
  if(d.housing_type==='미기입'){
    return'⚠ 주택수 미기입 - 확인 필요 (상담 시 주택 보유 현황을 먼저 파악해주세요)';
  }
  const cr=d.credit_amount||0,total=d.seed_amount+cr;
  const tY=d.transfer_available==='Y';
  const isFirst=d.housing_type==='생애최초',noHouse=d.housing_type==='무주택'||isFirst;
  const oneHouse=d.housing_type==='1주택',multi=!noHouse&&!oneHouse;
  const CAP=50000;
  const isOlhyun=(d.flags||[]).includes('올현금');
  function fs(v){
    v=Math.min(v,CAP);
    if(v>=10000){const a=Math.floor(v/10000),r=v%10000;
      if(!r)return a+'억원';
      if(r%1000===0)return a+'억 '+(r/1000)+'천만원';
      return a+'억 '+r.toLocaleString()+'만원';}
    if(v%1000===0)return (v/1000)+'천만원';
    return v.toLocaleString()+'만원';
  }
  function fsNoCap(v){
    if(v>=10000){const a=Math.floor(v/10000),r=v%10000;
      if(!r)return a+'억원';
      if(r%1000===0)return a+'억 '+(r/1000)+'천만원';
      return a+'억 '+r.toLocaleString()+'만원';}
    if(v%1000===0)return (v/1000)+'천만원';
    return v.toLocaleString()+'만원';
  }

  // 올현금 플래그: 경락잔금대출 미활용 → 올현금 투자만
  if(isOlhyun){
    const area=tY?'수도권 규제·비규제':'수도권 비규제';
    const regionOh=total<=15000?' (인천, 부천)':' (인천, 경기외곽)';
    const lines=[];
    lines.push(area+' 빌라 '+fs(total)+' 이하'+regionOh+' (올현금)');
    lines.push('비수도권 APT '+fs(total)+' (올현금)');
    return lines.map((l,i)=>(i+1)+'. '+l).join('\n');
  }

  // ===== 실거주(또는 단타+실거주) + 전입가능 + 자기자금 3,000만원 이상: 주택수별 LTV% 정밀 계산 =====
  const wantsResidenceAny=!forceDanta&&(forceResidence||tY)&&(d.investment_purpose==='실거주'||d.investment_purpose==='단타+실거주');
  if(wantsResidenceAny&&total>=3000){
    // 낙찰가 = 자기자금 ÷ (1-LTV%), 최소 8,300만원. 8,300만원으로 끌어올려진 경우에만
    // 그 시점의 자기부담분(8,300×(1-LTV%))이 실제 보유 자기자금을 넘는지 검사
    function ltvLine(ltv,isMetro){
      const raw=Math.round(total/(1-ltv)/100)*100;
      let bid=isMetro?metroBidWithLoanCap(total,ltv):raw;
      if(bid<8300){
        const selfBurden=Math.round(8300*(1-ltv));
        if(selfBurden>total) return{ok:false,bid:null};
        bid=8300;
      }
      const loanAmt=Math.max(0,bid-total);
      if(loanAmt<5000) return{ok:false,bid:null}; // 대출실행액 5,000만원 미만이면 실제 대출 자체가 안 나옴
      return{ok:true,bid:bid};
    }
    function fmtLine(r){
      return r.ok?fsNoCap(r.bid)+' 이하':'현금+신용대출 활용해 올현금 입찰 가능 물건';
    }
    const rLines=[];
    if(multi){
      rLines.push('수도권 비규제 '+fmtLine(ltvLine(0.6,true))+' (기존주택 처분조건부)');
      rLines.push('비수도권 '+fmtLine(ltvLine(0.6)));
    }else if(oneHouse){
      rLines.push('수도권 규제 '+fmtLine(ltvLine(0.4,true))+' (기존주택 처분조건부)');
      rLines.push('수도권 비규제 '+fmtLine(ltvLine(0.7,true))+' (기존주택 처분조건부)');
      rLines.push('비수도권 '+fmtLine(ltvLine(0.6)));
    }else{ // noHouse (무주택/생애최초)
      if(isFirst){
        rLines.push('수도권 규제 '+fmtLine(ltvLine(0.7,true)));
        rLines.push('수도권 비규제 '+fmtLine(ltvLine(0.7,true)));
        rLines.push('비수도권 '+fmtLine(ltvLine(0.8)));
      }else{
        rLines.push('수도권 규제 '+fmtLine(ltvLine(0.4,true))+' (생애최초인 경우 '+fmtLine(ltvLine(0.7,true))+')');
        rLines.push('수도권 비규제 '+fmtLine(ltvLine(0.7,true)));
        rLines.push('비수도권 '+fmtLine(ltvLine(0.7))+' (생애최초인 경우 '+fmtLine(ltvLine(0.8))+')');
      }
    }
    return rLines.map((l,i)=>(i+1)+'. '+l).join('\n');
  }
  const l60bid=Math.min(Math.round(total/0.4/100)*100,CAP);
  const l80bid=Math.min(Math.round(total/0.2/100)*100,CAP);
  const localMin=Math.max(8300,l60bid);
  const hasLocal=l80bid>=8300;
  const snr70=tY?Math.min(Math.round(total/0.3/100)*100,CAP):null;
  // 자기자금 3,000만원 미만은 레버리지 계산 자체를 적용하지 않음
  const snrOk=snr70&&total>=3000&&snr70*0.7>=5000;
  // 인천·부천 추천: 실제 입찰가 기준 (LTV 가능시 입찰가, 불가시 시드)
  const bidForRegion=snrOk&&snr70?snr70:total;
  const region=bidForRegion<=15000?' (인천, 부천)':'';
  const lines=[];
  const needsCrCheck=cr===0; // 신용대출 금액 미확인 → 새 형식
  // 전체 LTV 불가 케이스 (수도권 LTV 미달 + 비수도권 최소입찰가 미달)
  const allFail=!snrOk&&!hasLocal;
  // allFail 지역: 무주택=규제·비규제(현금+신용), 1주택/다주택=비규제만
  const areaF=noHouse?'수도권 규제·비규제':'수도권 비규제';
  if(allFail){
    lines.push(needsCrCheck
      ?areaF+'지역 현금+신용대출 활용해 올현금 입찰 가능 물건 (신용대출 가능금액 확인 필요)'
      :areaF+' 빌라 시드+신용대출 합산 금액으로 입찰 검토'+region);
    return lines.map((l,i)=>(i+1)+'. '+l).join('\n');
  }
  if(multi){
    if(needsCrCheck){
      lines.push('수도권 비규제 APT·빌라 현금+신용대출 활용해 올현금 입찰 가능 물건 (공시가 1억이하)');
    }else{
      const t=tierLabel(Math.min(total,50000));
      lines.push('수도권 비규제 '+t.propType+' '+fs(Math.min(total,50000))+' 이하 (공시가 1억이하)'+t.regionTag);
    }
  }else if(noHouse){
    const wantsResidenceNH=!forceDanta&&tY&&(d.investment_purpose==='실거주'||d.investment_purpose==='단타+실거주');
    const aptBid=tY&&snrOk?snr70:total;
    // 현금+신용대출은 전입 없이도 규제지역 가능 → 항상 규제·비규제
    const area='수도권 규제·비규제';
    if(wantsResidenceNH&&snrOk){
      // 실거주(또는 단타+실거주) 목적 + 전입가능이면 5억 상한 없이 LTV 60~70% 범위로 표시
      const bid60=Math.round(total/0.4/100)*100;
      const bid70=Math.round(total/0.3/100)*100;
      lines.push('입찰가능한 금액 : '+fsNoCap(bid60)+' ~ '+fsNoCap(bid70));
    }else if(aptBid>15000){
      const t=tierLabel(Math.min(aptBid,50000));
      lines.push(area+' '+t.propType+' '+fs(Math.min(aptBid,50000))+' 이하'+t.regionTag);
    }else{
      if(needsCrCheck&&(!snrOk||!tY)){
        lines.push(area+'지역 현금+신용대출 활용해 올현금 입찰 가능 물건 (신용대출 가능금액 확인 필요)');
      }else{
        if(!tY){
          const t=tierLabel(total);
          lines.push(area+' '+t.propType+' '+fs(total)+' 이하'+t.regionTag);
        }else if(!snrOk){
          // 전입은 가능하나 자기자금 3,000만원 미만 등으로 레버리지 계산 불가 → 통일된 안내문구
          lines.push(area+' 빌라 현금+신용대출 활용해 올현금 입찰 가능 물건'+tierLabel(total).regionTag);
        }else{
          const t=tierLabel(aptBid);
          lines.push(area+' '+t.propType+' '+fs(aptBid)+' 이하'+t.regionTag);
        }
      }
    }
  }else if(oneHouse){
    // 기존주택 처분조건 + 전입조건 충족 시 1주택자도 수도권 규제지역 조건부 가능
    const wantsResidence=!forceDanta&&tY&&(d.investment_purpose==='실거주'||d.investment_purpose==='단타+실거주');
    if(wantsResidence){
      const condNote=' (기존주택 처분조건부·전입조건부)';
      if(snrOk){
        const bid60=Math.round(total/0.4/100)*100;
        const bid70=Math.round(total/0.3/100)*100;
        lines.push('입찰가능한 금액 : '+fsNoCap(bid60)+' ~ '+fsNoCap(bid70));
      }else{
        lines.push('수도권 규제지역 현금+신용대출 활용해 올현금 입찰 가능 물건'+condNote+(needsCrCheck?' (신용대출 가능금액 확인 필요)':''));
      }
    }
    // 1주택 + 단타 방향은 기존주택 처분을 전제로 한 LTV를 기본안으로 보지 않음.
    // 신용대출 금액이 미확인(0)이면 투자금 규모와 관계없이 확인 필요 문구를 우선 표시.
    if(needsCrCheck){
      lines.push('수도권 비규제지역 현금+신용대출 활용해 올현금 입찰 가능 물건 (신용대출 가능금액 확인 필요)');
    }else{
      const t=tierLabel(Math.min(total,50000));
      lines.push('수도권 비규제 '+t.propType+' '+fs(total)+' 이하'+t.regionTag+' (올현금)');
    }
  }
  if(hasLocal){
    const note=multi?' (공시가 2억이하)':'';
    if(total>10000){
      // 합산자금 1억 초과면 구체적 범위 대신 상한선만 안내
      lines.push('비수도권 APT '+fs(CAP)+' 이하'+note);
    }else{
      const localPrefix=needsCrCheck&&!multi?'비수도권 APT 입찰가 기준: ':'비수도권 APT ';
      lines.push(localMin===l80bid
        ?localPrefix+fs(l80bid)+' 이하'+note
        :localPrefix+fs(localMin)+' ~ '+fs(l80bid)+note);
    }
  }
  return lines.map((l,i)=>(i+1)+'. '+l).join('\n');
}

// 신용대출 금액이 있으면 확인 문구 추가 (CSV/PDF 공통)
function appendCreditCheckNote(text,d){
  if((d.credit_amount||0)>0){
    return text+'\n** 단, 신용대출 활용 시 경락잔금대출까지 함께 나오는지 항상 확인 필요';
  }
  return text;
}

// CSV 전용: (1주택자 또는 무주택자) + 실거주(또는 단타+실거주) + 전입가능자는 [실거주]/[단타] 라벨을 붙여서 구분 (PDF 리포트는 라벨 없이, 신용대출 문구만 공통 적용)
// - 무주택자가 자기자금 3,000만원 미만이면 실거주/단타 구분이 의미 없으므로 [실거주,단타]로 통합
// - 무주택자가 구분되는 경우([실거주]는 5억 상한 없이, [단타]는 원래 5억 상한 걸린 수도권 규제·비규제 줄도 추가)
function formatBidNarrativeCSV(d){
  const base=formatBidNarrative(d);
  const oneHouse=d.housing_type==='1주택';
  const noHouse=d.housing_type==='무주택'||d.housing_type==='생애최초';
  const multi=d.housing_type==='다주택';
  const tY=d.transfer_available==='Y';
  const cr=d.credit_amount||0,total=d.seed_amount+cr;
  const CAP=50000;
  const snr70=tY?Math.min(Math.round(total/0.3/100)*100,CAP):null;
  const snrOk=snr70&&total>=3000&&snr70*0.7>=5000;
  const wantsResidenceAny=tY&&(d.investment_purpose==='실거주'||d.investment_purpose==='단타+실거주');
  const purposeMatchesResidence=d.investment_purpose==='실거주'||d.investment_purpose==='단타+실거주';
  // 무주택자이면서 실거주 의사는 있지만 전입불가인 경우: "만약 전입 가능해지면"을 가정한 [실거주] 계산과
  // 실제(전입불가) 상태를 반영한 [단타] 계산을 함께 보여줌
  if(noHouse&&!tY&&purposeMatchesResidence&&total>=3000){
    const residenceBase=formatBidNarrative(d,false,true); // 전입가능이라 가정한 정밀 계산
    const residenceLines=residenceBase.split('\n').map(l=>{
      const m=l.match(/^\d+\.\s*(.+)$/);
      return m?m[1]:l;
    });
    const dantaLines=base.split('\n').map(l=>{ // base = 실제(전입불가) 상태의 결과
      const m=l.match(/^\d+\.\s*(.+)$/);
      return m?m[1]:l;
    });
    const items=[{h:true,text:'[실거주]'},...residenceLines,{h:true,text:'[단타]'},...dantaLines];
    let n=1;
    const out=items.map(it=>(typeof it==='object'&&it.h)?it.text:(n++)+'. '+it);
    return appendCreditCheckNote(out.join('\n'),d);
  }
  // 자기자금 3,000만원 이상인 경우:
  // - 무주택자는 처분조건 같은 제약이 없어 실거주/단타 결과가 실질적으로 같으므로 [실거주&단타] 하나로 병합
  // - 1주택/다주택은 처분조건 때문에 실제로 달라지므로 [실거주]/[단타] 두 시나리오를 그대로 보여줌
  if(wantsResidenceAny&&total>=3000){
    const residenceLines=base.split('\n').map(l=>{
      const m=l.match(/^\d+\.\s*(.+)$/);
      return m?m[1]:l;
    });
    if(noHouse){
      const items=[{h:true,text:'[실거주&단타]'},...residenceLines];
      let n=1;
      const out=items.map(it=>(typeof it==='object'&&it.h)?it.text:(n++)+'. '+it);
      return appendCreditCheckNote(out.join('\n'),d);
    }
    const dantaBase=formatBidNarrative(d,true); // 단타 목적이었다면 나왔을 결과
    const dantaLines=dantaBase.split('\n').map(l=>{
      const m=l.match(/^\d+\.\s*(.+)$/);
      return m?m[1]:l;
    });
    const items=[{h:true,text:'[실거주]'},...residenceLines,{h:true,text:'[단타]'},...dantaLines];
    let n=1;
    const out=items.map(it=>(typeof it==='object'&&it.h)?it.text:(n++)+'. '+it);
    return appendCreditCheckNote(out.join('\n'),d);
  }
  const wantsResidence=(oneHouse||noHouse)&&tY&&(d.investment_purpose==='실거주'||d.investment_purpose==='단타+실거주');
  const wantsResidenceMulti=multi&&tY&&(d.investment_purpose==='실거주'||d.investment_purpose==='단타+실거주');
  const rawLines=base.split('\n').map(l=>{
    const m=l.match(/^\d+\.\s*(.+)$/);
    return m?m[1]:l;
  });
  if(wantsResidenceMulti){
    // 다주택자 실거주 목적(3천만원 미만): 계산된 금액 대신 "별도 상담 필요"로 안내, 단타 항목은 기존 계산 그대로
    const items=[{h:true,text:'[실거주]'},'별도 상담 필요',{h:true,text:'[단타]'},...rawLines];
    let n=1;
    const out=items.map(it=>(typeof it==='object'&&it.h)?it.text:(n++)+'. '+it);
    return appendCreditCheckNote(out.join('\n'),d);
  }
  if(!wantsResidence){
    return appendCreditCheckNote(base,d);
  }
  if(rawLines.length===1){
    // 자금이 너무 작아 완전 계산불가(1줄짜리 안내문) 상황 → 실거주/단타 구분 의미 없음, 라벨 통합
    const items=[{h:true,text:'[실거주,단타]'},...rawLines];
    let n=1;
    const out=items.map(it=>(typeof it==='object'&&it.h)?it.text:(n++)+'. '+it);
    return appendCreditCheckNote(out.join('\n'),d);
  }
  if(rawLines.length<2){
    return appendCreditCheckNote(base,d);
  }
  function fsCap(v){
    v=Math.min(v,CAP);
    if(v>=10000){const a=Math.floor(v/10000),r=v%10000;
      if(!r)return a+'억원';
      if(r%1000===0)return a+'억 '+(r/1000)+'천만원';
      return a+'억 '+r.toLocaleString()+'만원';}
    if(v%1000===0)return (v/1000)+'천만원';
    return v.toLocaleString()+'만원';
  }
  let items;
  if(noHouse&&!snrOk){
    // 자기자금 3,000만원 미만 → 실거주든 단타든 결과 동일, 라벨 통합
    items=[{h:true,text:'[실거주,단타]'},...rawLines];
  }else if(noHouse&&snrOk){
    // 단타 목적이었다면 나왔을 5억 상한 버전 수도권 줄을 [단타] 아래에 추가
    const aptBid=snr70;
    const t=tierLabel(aptBid);
    const dantaLine='수도권 규제·비규제 '+t.propType+' '+fsCap(aptBid)+' 이하'+t.regionTag;
    items=[{h:true,text:'[실거주]'},rawLines[0],{h:true,text:'[단타]'},dantaLine,...rawLines.slice(1)];
  }else{
    items=[{h:true,text:'[실거주]'},rawLines[0],{h:true,text:'[단타]'},...rawLines.slice(1)];
  }
  let n=1;
  const out=items.map(it=>(typeof it==='object'&&it.h)?it.text:(n++)+'. '+it);
  return appendCreditCheckNote(out.join('\n'),d);
}

function consult(d){
  if(d.housing_type==='미기입'){
    const errBox={st:'E',lb:'미기입',nt:'주택수 확인 필요'};
    return{
      reg:errBox, nreg:errBox, local:errBox,
      bid:'⚠ 주택수 미기입 - 확인 필요',
      primary:'', dirLabel:'',
      ltvLabel:'주택수 확인 필요'
    };
  }
  const cr=d.credit_amount||0,total=d.seed_amount+cr;
  const lY=d.loan_available==='Y',tY=d.transfer_available==='Y',lN=d.loan_available==='N';
  const isFirst=d.housing_type==='생애최초',noHouse=d.housing_type==='무주택'||isFirst;
  const oneHouse=d.housing_type==='1주택'||d.housing_type==='일시적2주택';
  const hasBig=(d.flags||[]).includes('기대출');
  // ── 지역별 가능 여부 (이미지 기준) ──────────────────────────────
  let reg,nreg,local,primary,dirLabel;

  // 수도권 규제지역 (서울 전역·경기 12곳)
  const wantsResidence=oneHouse&&tY&&(d.investment_purpose==='실거주'||d.investment_purpose==='단타+실거주');
  const wantsResidenceNH=noHouse&&tY&&(d.investment_purpose==='실거주'||d.investment_purpose==='단타+실거주');
  if(noHouse){
    reg = tY ? {st:'O',lb:'가능',nt:''} : {st:'T',lb:'조건부',nt:'신용대출 또는 현금 활용'};
  } else if(wantsResidence){
    reg = {st:'T',lb:'조건부',nt:'기존주택 처분조건부·전입조건부'};
  } else {
    reg = {st:'X',lb:'불가',nt:''};
  }

  // 수도권 비규제지역 (인천+경기 일부)
  if(noHouse){
    nreg = tY ? {st:'O',lb:'가능',nt:''} : {st:'T',lb:'조건부',nt:'신용대출 또는 현금 활용'};
  } else if(oneHouse){
    nreg = {st:'T',lb:'조건부',nt:'신용대출 또는 현금 활용'};
  } else {
    nreg = {st:'T',lb:'조건부',nt:'신용/현금 + 공시가 1억이하'};
  }

  // 비수도권 (지방 전역)
  if(noHouse||oneHouse){
    local = {st:'O',lb:'가능',nt:''};
  } else {
    local = {st:'T',lb:'조건부',nt:'공시가 2억이하'};
  }

  // 최종 투자 방향 요약
  if(noHouse){
    if(tY){
      if(total>=15000){ primary='수도권 규제지역 빌라 올현금 or 비수도권 LTV 활용';dirLabel='서울·수도권 규제'; }
      else { primary='전국 가능 — 수도권 규제 포함';dirLabel='서울·수도권 규제'; }
    } else {
      primary=total<=10000?'수도권 비규제 인천·부천 추천':'수도권 비규제 + 비수도권 우선';
      dirLabel='수도권 비규제';
    }
  } else if(oneHouse){
    const l80bid=Math.min(Math.round(total/0.2/100)*100,50000);
    if(total>10000){ primary='수도권 비규제 APT 1순위';dirLabel='수도권 비규제'; }
    else if(l80bid>=8300){ primary='수도권 비규제 인천·부천 추천';dirLabel='수도권 비규제'; }
    else { primary='';dirLabel='지방'; }
  } else {
    primary='';dirLabel='지방'; // 다주택 지방 → 빈칸
  }
  let bid;
  const CAP=50000;

  // LTV 가능 여부 판단 (minLoan: 수도권 5천만원, 비수도권 3천만원)
  function cLtv(downPct,ltvPct,minLoan){
    if(minLoan===undefined)minLoan=5000;
    const rawBid=Math.round(total/downPct/100)*100;
    const loanAmt=rawBid*ltvPct;
    const crSfx=cr>0?' · 시드+신용합산':'';
    // 자기자금 3,000만원 미만은 레버리지 계산 자체를 적용하지 않고 시드+신용대출금액 그대로 표기
    if(total<3000||loanAmt<minLoan)
      return{ok:false,bid:Math.min(total,CAP),label:'올현금'+(cr>0?' (시드+신용합산)':'')};
    return{ok:true,bid:Math.min(rawBid,CAP),label:'LTV '+Math.round(ltvPct*100)+'%'+crSfx};
  }

  function fR(v){
    const c=Math.min(v,CAP);
    if(c>=CAP)return'5억대';if(c>=40000)return'4억~5억대';if(c>=30000)return'3억~4억대';
    if(c>=20000)return'2억~3억대';if(c>=15000)return'1.5억~2억대';if(c>=10000)return'1억~1.5억대';
    if(c>=7000)return'7천~1억대';if(c>=5000)return'5천~7천만원대';if(c>=3000)return'3천~5천만원대';
    return fmt(c)+'대';
  }

  function olR(v){
    const c=Math.min(v,CAP);
    if(c>=30000)return'3억~5억대';if(c>=20000)return'2억~3억대';if(c>=15000)return'1.5억~2억대';
    if(c>=10000)return'1억~1.5억대';if(c>=7000)return'7천~1억대';if(c>=5000)return'5천~7천만원대';
    if(c>=3000)return'3천~5천만원대';return fmt(c)+'대';
  }

  // ── 입찰 가능 금액대: 수도권 규제 / 수도권 비규제 / 비수도권 각각 계산 ──
  const bAmt=Math.min(total,CAP);
  const bigInv=noHouse&&total>=15000;

  // 수도권 규제 (서울 전역·경기 12곳)
  function bidReg(){
    if(!noHouse&&!wantsResidence) return '불가';
    if(noHouse&&wantsResidenceNH){
      const bid60=Math.round(total/0.4/100)*100;
      const bid70=Math.round(total/0.3/100)*100;
      return fmt(bid60)+' ~ '+fmt(bid70);
    }
    if(noHouse&&bigInv) return fmt(bAmt)+' (올현금 추천)';
    if(!tY) return fmt(bAmt)+' (신용/현금·조건부)';
    if(wantsResidence){
      const bid60=Math.round(total/0.4/100)*100;
      const bid70=Math.round(total/0.3/100)*100;
      return fmt(bid60)+' ~ '+fmt(bid70)+' (기존주택 처분조건부·전입조건부)';
    }
    const s=cLtv(0.3,0.7);
    return s.ok?fmt(s.bid)+' ('+s.label+')':fmt(bAmt)+' (올현금)';
  }

  // 수도권 비규제 (인천+경기 일부)
  function bidNreg(){
    if(!noHouse&&!oneHouse){ // 다주택
      return cr===0?'현금+신용대출 합산금액 (공시가 1억이하)':fmt(bAmt)+' (공시가 1억이하)';
    }
    if(oneHouse){ // 1주택
      return fmt(bAmt)+' (신용/현금·조건부)';
    }
    // 무주택/생애최초
    if(wantsResidenceNH){
      const bid60=Math.round(total/0.4/100)*100;
      const bid70=Math.round(total/0.3/100)*100;
      return fmt(bid60)+' ~ '+fmt(bid70);
    }
    if(bigInv) return fmt(bAmt)+' (올현금 추천)';
    if(!tY) return fmt(bAmt)+' (신용/현금·조건부)';
    const s=cLtv(0.3,0.7);
    return s.ok?fmt(s.bid)+' ('+s.label+')':fmt(bAmt)+' (올현금)';
  }

  // 비수도권 지방APT (경락잔금대출: 최소 입찰가 8,300만원)
  function bidLocal(){
    if(total<1000) return '신용합산 필요';
    const MIN_BID=8300; // 경락잔금대출 최소 입찰가
    const MAX_STD=13000; // 표 기준: 소액투자자 최대 입찰가 기준(1억3천)
    const l60bid=Math.min(Math.round(total/0.4/100)*100,CAP);
    const l80bidRaw=Math.min(Math.round(total/0.2/100)*100,CAP);
    // 80% LTV 최소입찰가(8300) 감당 가능하면 최대는 최소 1억3천 보장
    const canAffordMin=total>=1660;
    const l80bid=canAffordMin?Math.max(l80bidRaw,MAX_STD):l80bidRaw;
    if(l80bid<MIN_BID) return fmt(bAmt)+' (올현금)';
    const minBid=Math.max(MIN_BID,l60bid);
    let txt=minBid===l80bid?fmt(l80bid)+' (LTV 80%)':fmt(minBid)+' ~ '+fmt(l80bid);
    if(!noHouse&&!oneHouse) txt+=' · 공시가2억이하';
    return txt;
  }

  bid='수도권 규제 '+bidReg()+' / 수도권 비규제 '+bidNreg()+' / 비수도권 '+bidLocal();
  // LTV 기준 레이블
  let ltvLabel;
  if(lN)
    ltvLabel=oneHouse?'수도권 비규제 신용/현금 · 비수도권 LTV 60~80% (신용대출 미활용)':noHouse?'수도권 LTV 70% · 비수도권 LTV 60~80% (신용대출 미활용)':'비수도권 LTV 60~80% (신용대출 미활용)';
  else if(total<1000)
    ltvLabel='신용대출 합산 필요';
  else if(isFirst&&hasBig)
    ltvLabel=tY?'수도권 LTV 70% · 비수도권 LTV 60~80% (기대출 확인 필요)':'수도권 올현금 (전입필요) · 비수도권 LTV 60~80% (기대출 확인 필요)';
  else if(noHouse)
    ltvLabel=tY
      ?(total>=15000?'수도권 올현금 추천 (규제지역 빌라) · 비수도권 LTV 60~80%':'수도권 LTV 70% · 비수도권 LTV 60~80%')
      :'수도권 올현금 (전입필요) · 비수도권 LTV 60~80%';
  else if(oneHouse)
    ltvLabel='수도권 비규제 신용/현금 · 비수도권 LTV 60~80%';
  else
    ltvLabel='비수도권 LTV 60~80% (수도권 불가)';

  return{reg,nreg,local,bid,primary,dirLabel,ltvLabel};
}

function getReportContext(d){
  const cr=d.credit_amount||0,total=d.seed_amount+cr;
  const isFirst=d.housing_type==='생애최초',noHouse=d.housing_type==='무주택'||isFirst;
  const narrative=appendCreditCheckNote(formatBidNarrative(d),d);
  const numberedCountEarly=narrative.split('\n').filter(l=>/^\d+\.\s/.test(l)).length;
  const fmtAmt=v=>{
    v=Math.min(v,50000);
    if(v>=10000){const a=Math.floor(v/10000),r=v%10000;
      if(!r)return a+'억원';
      if(r%1000===0)return a+'억 '+(r/1000)+'천만원';
      return a+'억 '+r.toLocaleString()+'만원';}
    return v.toLocaleString()+'만원';
  };
  const seedLine=cr>0?`시드 : ${fmtAmt(d.seed_amount)} + 신용 ${fmtAmt(cr)} (합산 ${fmtAmt(total)})`:`시드 : ${fmtAmt(d.seed_amount)}`;

  const oneHouse=d.housing_type==='1주택';
  const missingHousing=d.housing_type==='미기입';
  const multi=!noHouse&&!oneHouse&&!missingHousing;
  const wantsResidence=oneHouse&&d.transfer_available==='Y'&&(d.investment_purpose==='실거주'||d.investment_purpose==='단타+실거주');
  const wantsResidenceNH=noHouse&&d.transfer_available==='Y'&&(d.investment_purpose==='실거주'||d.investment_purpose==='단타+실거주');
  // 자기자금 3,000만원 이상 + 실거주(또는 단타+실거주) + 전입가능이면 formatBidNarrative가 이미
  // 주택수별 정밀 LTV 계산(단일 결과, 실거주/단타 구분 없음)을 반환하므로 섹션 분리를 하지 않음
  const usesNewScheme=d.transfer_available==='Y'&&(d.investment_purpose==='실거주'||d.investment_purpose==='단타+실거주')&&total>=3000;
  // 무주택자이면서 실거주 의사는 있지만 전입불가인 경우: "전입가능이라면"을 가정한 [실거주] + 실제(전입불가) [단타]를 같이 보여줌
  const usesHypothetical=noHouse&&d.transfer_available!=='Y'&&(d.investment_purpose==='실거주'||d.investment_purpose==='단타+실거주')&&total>=3000;
  const CAP=50000;
  const snr70NH=d.transfer_available==='Y'?Math.min(Math.round(total/0.3/100)*100,CAP):null;
  const snrOkNH=snr70NH&&total>=3000&&snr70NH*0.7>=5000;
  function fsCapPdf(v){
    v=Math.min(v,CAP);
    if(v>=10000){const a=Math.floor(v/10000),r=v%10000;
      if(!r)return a+'억원';
      if(r%1000===0)return a+'억 '+(r/1000)+'천만원';
      return a+'억 '+r.toLocaleString()+'만원';}
    if(v%1000===0)return (v/1000)+'천만원';
    return v.toLocaleString()+'만원';
  }

  const noHouseNote=noHouse?`
    <div style="margin-top:24px;padding:18px 20px;background:#f7f8fa;border-left:3px solid #4a4a4a;border-radius:4px;font-size:12px;line-height:1.85;color:#555">
      <div style="font-weight:700;color:#222;margin-bottom:8px;font-size:12.5px">※ 참고사항</div>
      ${(wantsResidenceNH||usesHypothetical)?`
      수도권에서 경락잔금대출(낙찰 받은 집을 담보로 대출)을 받을 수 있지만, 전입 조건이 있습니다.<br>
      생애최초 구입이시면 대출 한도가 더 높게 적용되어 같은 자금으로도 더 큰 금액까지 도전하실 수 있습니다.<br><br>
      실거주 목적의 주택 구입 시 매매사업자 등록은 필요하지 않습니다.<br><br>
      단타인 경우, 매매사업자를 활용해 단타매매를 하기 전 해당 집에 전입을 했다는 이유만으로 매매사업자로 인정을 받을 수 없다(단기 매도 시 양도세 77%)는 의견이 있습니다. 이는 세무사님 마다도 의견이 다르기 때문에 판단과 책임은 본인에게 있습니다.<br><br>
      이 부분이 걸리신다면, 수도권에서는 현금 + 신용대출 금액으로 입찰할 수 있는 금액으로 물건 봐주시거나, 비수도권의 물건을 보시면 됩니다!
      `:`
      무주택자는 수도권에서 경락잔금대출(낙찰 받은 집을 담보로 대출)을 받을 수 있지만, 전입을 해야하는 조건이 있습니다.<br><br>
      ※ 매매사업자를 활용해 단타매매를 하기 전, 해당 집에 전입을 했다는 이유만으로 매매사업자로 인정을 받을 수 없다(단기 매도 시 양도세 77%)는 의견이 있습니다. 이는 세무사님 마다도 의견이 다르기 때문에 판단과 책임은 본인에게 있습니다.<br><br>
      이 부분이 걸리신다면, 수도권에서는 현금 + 신용대출 금액으로 입찰할 수 있는 금액으로 물건 봐주시거나, 비수도권의 물건을 보시면 됩니다!
      `}
    </div>`:'';

  const noHouseNoteTop=noHouse?`
    <div style="margin:2px 0 14px 0;padding:16px 20px;background:#f7f8fa;border-left:3px solid #4a4a4a;border-radius:4px;font-size:12px;line-height:1.85;color:#555">
      <div style="font-weight:700;color:#222;margin-bottom:8px;font-size:12.5px">※ 참고사항</div>
      무주택자는 수도권에서 경락잔금대출(낙찰 받은 집을 담보로 대출)을 받을 수 있지만, 전입 조건이 있습니다.<br>
      생애최초 구입이신 경우 대출 한도가 더 높게 적용되어, 같은 자금으로도 더 큰 금액까지 도전하실 수 있습니다.
    </div>`:'';

  const noHouseNoteBottom=noHouse?`
    <div style="margin-top:24px;padding:18px 20px;background:#f7f8fa;border-left:3px solid #4a4a4a;border-radius:4px;font-size:12px;line-height:1.85;color:#555">
      <div style="font-weight:700;color:#222;margin-bottom:8px;font-size:12.5px">※ 참고사항</div>
      단타매매 역시 무주택자는 수도권에서 경락잔금대출(낙찰 받은 집을 담보로 대출)을 받을 수 있지만, 전입을 해야하는 조건이 있습니다.<br><br>
      ※ 매매사업자를 활용해 단타매매를 하기 전, 해당 집에 전입을 했다는 이유만으로 매매사업자로 인정을 받을 수 없다(단기 매도 시 양도세 77%)는 의견이 있습니다. 이는 세무사님 마다도 의견이 다르기 때문에 판단과 책임은 본인에게 있습니다.<br><br>
      이 부분이 걸리신다면, 수도권에서는 현금 + 신용대출 금액으로 입찰할 수 있는 금액으로 물건 봐주시거나, 비수도권의 물건을 보시면 됩니다!
    </div>`:'';

  const oneHouseNoteTop=oneHouse?`
    <div style="margin:2px 0 14px 0;padding:16px 20px;background:#f7f8fa;border-left:3px solid #4a4a4a;border-radius:4px;font-size:12px;line-height:1.85;color:#555">
      <div style="font-weight:700;color:#222;margin-bottom:8px;font-size:12.5px">※ 참고사항</div>
      1주택자는 수도권에서 경락잔금대출(낙찰 받은 집을 담보로 대출)을 받을 수 있지만, 기존 주택 처분 조건 + 전입 조건을 충족해야합니다.<br>
      ※ 실거주 주택 구입 시 매매사업자 불필요
    </div>`:'';

  const oneHouseNoteBottom=oneHouse?`
    <div style="margin-top:24px;padding:18px 20px;background:#f7f8fa;border-left:3px solid #4a4a4a;border-radius:4px;font-size:12px;line-height:1.85;color:#555">
      <div style="font-weight:700;color:#222;margin-bottom:8px;font-size:12.5px">※ 참고사항</div>
      단타매매 역시 수도권에서 주택 구입 시 경락잔금대출(낙찰 받은 집을 담보로 대출) 받는다면 기존 주택 처분 조건 + 전입을 충족해야합니다.<br>
      반면 수도권 내 주택을 현금과 신용대출로 매수하는 방식이라면 기존 주택 처분과 전입 조건은 사라지게 됩니다.<br><br>
      ※ 기존 주택을 보유하고 있는 분은 규제지역에서 매매사업자 인정을 받을 수 없기때문에, 단타매매 시 규제지역을 꼭 제외시켜주세요.<br><br>
      비수도권은 경락잔금대출 낙찰가의 60~80%가 대부분 적용되므로, 수도권 보단 더 높은 금액대에 도전할 수 있습니다.
    </div>`:'';

  // 실거주+전입가능이 아닌 1주택자(단타매매 목적만 또는 전입불가)는 하나의 박스로 합쳐서 하단에 배치
  const oneHouseNoteCombined=oneHouse?`
    <div style="margin-top:24px;padding:18px 20px;background:#f7f8fa;border-left:3px solid #4a4a4a;border-radius:4px;font-size:12px;line-height:1.85;color:#555">
      <div style="font-weight:700;color:#222;margin-bottom:8px;font-size:12.5px">※ 참고사항</div>
      수도권에서 주택 구입 시 경락잔금대출(낙찰 받은 집을 담보로 대출) 받는다면 기존 주택 처분 조건 + 전입을 충족해야합니다.<br>
      반면 수도권 내 주택을 현금과 신용대출로 매수하는 방식이라면 기존 주택 처분과 전입 조건은 사라지게 됩니다.<br><br>
      ※ 기존 주택을 보유하고 있는 분은 규제지역에서 매매사업자 인정을 받을 수 없기때문에, 단타매매 시 규제지역을 꼭 제외시켜주세요.<br><br>
      비수도권은 경락잔금대출 낙찰가의 60~80%가 대부분 적용되므로, 수도권 보단 더 높은 금액대에 도전할 수 있습니다.
    </div>`:'';

  const multiNoteTop=multi?`
    <div style="margin:2px 0 14px 0;padding:16px 20px;background:#f7f8fa;border-left:3px solid #4a4a4a;border-radius:4px;font-size:12px;line-height:1.85;color:#555">
      <div style="font-weight:700;color:#222;margin-bottom:8px;font-size:12.5px">※ 참고사항</div>
      다주택자는 수도권에서 기존 주택을 모두 처분해야만 경락잔금대출을 받을 수 있습니다.<br>
      기존주택을 처분하지 않을 경우 취득세 중과(8~12%)가 될 수 있으니 세금적인 부분도 함께 고려하셔야 합니다.<br>
      ※ 실거주 주택 구입 시 매매사업자 불필요
    </div>`:'';

  const multiNoteBottom=multi?`
    <div style="margin-top:24px;padding:18px 20px;background:#f7f8fa;border-left:3px solid #4a4a4a;border-radius:4px;font-size:12px;line-height:1.85;color:#555">
      <div style="font-weight:700;color:#222;margin-bottom:8px;font-size:12.5px">※ 참고사항</div>
      다주택자는 수도권에서는 경락잔금대출을 받을 수 없으며, 규제지역에서는 매매사업자 세제 혜택도 적용받을 수 없습니다.<br><br>
      다만 수도권 비규제지역의 공시가격 1억 원 이하 주택은 현금과 신용대출을 활용해 투자할 수 있습니다. 공시가격 1억 원 이하 주택은 다주택자도 취득세 1%가 적용되어 추가 매수 시 세금 부담을 줄일 수 있습니다.<br><br>
      또한 비수도권의 공시가격 2억 원 이하 주택도 취득세 1%가 적용됩니다. 여기에 경락잔금대출(LTV 60~80%)을 활용할 수 있어, 같은 자금으로 더 높은 금액대의 물건에 투자할 수 있습니다.<br><br>
      세금은 개인의 상황에 따라 달라질 수 있으므로, 자세한 내용은 세무사와 상담하시기를 권장드립니다.
    </div>`:'';

  const multiNote=multi?`
    <div style="margin-top:24px;padding:18px 20px;background:#f7f8fa;border-left:3px solid #4a4a4a;border-radius:4px;font-size:12px;line-height:1.85;color:#555">
      <div style="font-weight:700;color:#222;margin-bottom:8px;font-size:12.5px">※ 참고사항</div>
      다주택자는 수도권에서는 경락잔금대출을 받을 수 없으며, 규제지역에서는 매매사업자 세제 혜택도 적용받을 수 없습니다.<br><br>
      다만 수도권 비규제지역의 공시가격 1억 원 이하 주택은 현금과 신용대출을 활용해 투자할 수 있습니다. 공시가격 1억 원 이하 주택은 다주택자도 취득세 1%가 적용되어 추가 매수 시 세금 부담을 줄일 수 있습니다.<br><br>
      또한 비수도권의 공시가격 2억 원 이하 주택도 취득세 1%가 적용됩니다. 여기에 경락잔금대출(LTV 60~80%)을 활용할 수 있어, 같은 자금으로 더 높은 금액대의 물건에 투자할 수 있습니다.<br><br>
      세금은 개인의 상황에 따라 달라질 수 있으므로, 자세한 내용은 세무사와 상담하시기를 권장드립니다.
    </div>`:'';

  const oneHouseNoteFinal=oneHouse?(usesNewScheme?oneHouseNoteTop:((wantsResidence&&numberedCountEarly>=2)?oneHouseNoteBottom:oneHouseNoteCombined)):'';
  const noHouseNoteFinal=noHouse?(usesNewScheme?noHouseNoteTop:(wantsResidenceNH&&snrOkNH?'':noHouseNote)):'';
  const wantsResidenceMulti=multi&&d.transfer_available==='Y'&&(d.investment_purpose==='실거주'||d.investment_purpose==='단타+실거주');
  const multiNoteFinal=multi?(usesNewScheme?multiNoteTop:(wantsResidenceMulti?'':multiNote)):'';
  const noteBox=noHouseNoteFinal||oneHouseNoteFinal||multiNoteFinal;

  return {cr,total,isFirst,noHouse,narrative,numberedCountEarly,fmtAmt,seedLine,oneHouse,missingHousing,multi,wantsResidence,wantsResidenceNH,usesNewScheme,usesHypothetical,CAP,snr70NH,snrOkNH,fsCapPdf,noHouseNote,noHouseNoteTop,noHouseNoteBottom,oneHouseNoteTop,oneHouseNoteBottom,oneHouseNoteCombined,multiNoteTop,multiNoteBottom,multiNote,oneHouseNoteFinal,noHouseNoteFinal,wantsResidenceMulti,multiNoteFinal,noteBox};
}

// PDF와 동일한 조건으로 참고사항을 선택하고, 자료실에는 안전한 일반 텍스트만 전달합니다.
function getInvestmentNotes(d){
  const c=getReportContext(d);
  let notes;
  if(c.usesHypothetical||(c.usesNewScheme&&c.noHouse)) notes=[c.noHouseNote];
  else if(c.usesNewScheme) notes=c.oneHouse?[c.oneHouseNoteTop,c.oneHouseNoteBottom]:[c.multiNoteTop,c.multiNoteBottom];
  else if(c.oneHouse&&c.wantsResidence&&c.numberedCountEarly>=2) notes=[c.oneHouseNoteTop,c.oneHouseNoteBottom];
  else if(c.noHouse&&c.wantsResidenceNH&&c.snrOkNH) notes=[c.noHouseNoteTop,c.noHouseNoteBottom];
  else if(c.multi&&c.wantsResidenceMulti) notes=[c.multiNoteTop,c.multiNoteBottom];
  else notes=[c.noteBox];
  return notes.filter(Boolean).map(html=>html
    .replace(/<br\s*\/?\s*>/gi,'\n')
    .replace(/<\/div>/gi,'\n')
    .replace(/<[^>]*>/g,'')
    .split('\n').map(line=>line.trim()).join('\n')
    .replace(/^\s*※ 참고사항\s*/,'')
    .replace(/\n{3,}/g,'\n\n').trim()).filter(Boolean);
}

function diagnose(d){
  const c=consult(d);
  return {
    cards:{reg:c.reg,nonReg:c.nreg,local:c.local},
    narrative:formatBidNarrativeCSV(d),
    notes:getInvestmentNotes(d)
  };
}
return {fmt,tierLabel,formatBidNarrative,appendCreditCheckNote,formatBidNarrativeCSV,consult,getReportContext,getInvestmentNotes,diagnose};
});
