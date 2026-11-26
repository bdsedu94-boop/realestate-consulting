// 수강생 컨설팅 화면 — 투자 방향성 리포트 PDF (1장 / 전체 ZIP)
// (일반 script: 함수·변수는 다른 app/*.js 와 전역으로 공유, index.html 에서 순서대로 불러옴)
/* ── 리포트 PDF 생성 (카톡 양식 그대로) ── */
async function buildReportPDF(d){
  const {
    cr,total,isFirst,noHouse,narrative,numberedCountEarly,fmtAmt,seedLine,oneHouse,missingHousing,multi,
    wantsResidence,wantsResidenceNH,usesNewScheme,usesHypothetical,CAP,snr70NH,snrOkNH,fsCapPdf,noHouseNote,
    noHouseNoteTop,noHouseNoteBottom,oneHouseNoteTop,oneHouseNoteBottom,oneHouseNoteCombined,multiNoteTop,
    multiNoteBottom,multiNote,oneHouseNoteFinal,noHouseNoteFinal,wantsResidenceMulti,multiNoteFinal,noteBox,
    smallLoanNote,noHouseSplit
  }=InvestmentRules.getReportContext(d);
  const transferLabel=d.transfer_available==='Y'?'전입가능':d.transfer_available==='N'?'전입불가':'미확인';
  const today=new Date();
  const dateStr=`${today.getFullYear()}.${String(today.getMonth()+1).padStart(2,'0')}.${String(today.getDate()).padStart(2,'0')}`;

  const narrativeRowsArr=narrative.split('\n').map(line=>{
    const m=line.match(/^(\d+)\.\s*(.+)$/);
    return m?{plain:false,text:m[2]}:{plain:true,text:line};
  });
  function rowHtml(num,text){
    return `<table style="width:100%;margin-bottom:10px;border-collapse:collapse"><tr>
      <td style="width:30px;vertical-align:top;padding:0">
        <table style="width:22px;height:22px;border-collapse:collapse"><tr>
          <td style="width:22px;height:22px;border-radius:50%;background:#9314cc;color:#fff;font-size:12px;font-weight:700;text-align:center;vertical-align:middle;line-height:1;padding:0">${num}</td>
        </tr></table>
      </td>
      <td style="vertical-align:top;padding:0">
        <div style="font-size:13px;line-height:22px;color:#222">${text}</div>
      </td>
    </tr></table>`;
  }
  function sectionTitleHtml(t,marginTop=18){
    return `<table style="border-collapse:collapse;margin:${marginTop}px 0 16px"><tr>
      <td style="width:4px;padding:0"><div style="width:4px;height:16px;background:#9314cc"></div></td>
      <td style="padding:0 0 0 8px"><div style="font-size:14.5px;font-weight:700;color:#9314cc;line-height:16px">${t}</div></td>
    </tr></table>`;
  }

  let mainTitle, bodyContent, bottomNoteBox;
  const numberedCount=numberedCountEarly;
  if(usesHypothetical){
    // 무주택자 + 실거주 의사 있으나 전입불가: "전입가능이라면"을 가정한 [실거주] + 실제(전입불가) [단타]를 함께 표시
    function toRowsHyp(text){
      return text.split('\n').map(line=>{
        const m=line.match(/^(\d+)\.\s*(.+)$/);
        return m?{plain:false,text:m[2]}:{plain:true,text:line};
      });
    }
    const residenceRows=toRowsHyp(formatBidNarrative(d,false,true));
    const dantaRows=toRowsHyp(formatBidNarrative(d));
    if((d.credit_amount||0)>0){
      dantaRows.push({plain:true,text:'** 단, 신용대출 활용 시 경락잔금대출까지 함께 나오는지 항상 확인 필요'});
    }
    let rn1=1,rn2=1;
    mainTitle='';
    bodyContent=sectionTitleHtml('투자방향성 분석 - 실거주 (전입 가능 시)')
      +residenceRows.map(r=>r.plain
        ?`<div style="font-size:12.5px;line-height:1.6;color:#555;margin-top:6px">${r.text}</div>`
        :rowHtml(rn1++,r.text)
      ).join('')
      +sectionTitleHtml('투자방향성 분석 - 단타매매',40)
      +dantaRows.map(r=>r.plain
        ?`<div style="font-size:12.5px;line-height:1.6;color:#555;margin-top:6px">${r.text}</div>`
        :rowHtml(rn2++,r.text)
      ).join('');
    bottomNoteBox=noHouseNote;
  }else if(usesNewScheme&&noHouse&&noHouseSplit){
    // 무주택자지만 실거주 금액이 단타 기준(5억 상한 등)과 달라지는 구간: 실거주/단타 두 섹션
    function toRowsSplit(text){
      return text.split('\n').map(line=>{
        const m=line.match(/^(\d+)\.\s*(.+)$/);
        return m?{plain:false,text:m[2]}:{plain:true,text:line};
      });
    }
    const residenceRows=toRowsSplit(formatBidNarrative(d));
    const dantaRows=toRowsSplit(formatBidNarrative(d,true));
    if((d.credit_amount||0)>0){
      dantaRows.push({plain:true,text:'** 단, 신용대출 활용 시 경락잔금대출까지 함께 나오는지 항상 확인 필요'});
    }
    let rn1=1,rn2=1;
    mainTitle='';
    bodyContent=sectionTitleHtml('투자방향성 분석 - 실거주')
      +residenceRows.map(r=>r.plain
        ?`<div style="font-size:12.5px;line-height:1.6;color:#555;margin-top:6px">${r.text}</div>`
        :rowHtml(rn1++,r.text)
      ).join('')
      +sectionTitleHtml('투자방향성 분석 - 단타매매',40)
      +dantaRows.map(r=>r.plain
        ?`<div style="font-size:12.5px;line-height:1.6;color:#555;margin-top:6px">${r.text}</div>`
        :rowHtml(rn2++,r.text)
      ).join('');
    bottomNoteBox=noHouseNote;
  }else if(usesNewScheme&&noHouse){
    // 무주택자는 처분조건 제약이 없어 실거주/단타 결과가 같으면 단일 섹션으로 병합
    function toRowsNH(text){
      return text.split('\n').map(line=>{
        const m=line.match(/^(\d+)\.\s*(.+)$/);
        return m?{plain:false,text:m[2]}:{plain:true,text:line};
      });
    }
    const mergedRows=toRowsNH(narrative);
    let rn=1;
    mainTitle='투자 방향성 분석 - 실거주&단타';
    bodyContent=mergedRows.map(r=>r.plain
      ?`<div style="font-size:13px;line-height:1.6;color:#333">${r.text}</div>`
      :rowHtml(rn++,r.text)
    ).join('');
    bottomNoteBox=noHouseNote;
  }else if(usesNewScheme){
    // 1주택/다주택: 실거주 계산(주택수별 정밀 LTV)과 단타 계산(기존 로직)을 각각 구해서 두 섹션으로 표시
    function toRows(text){
      return text.split('\n').map(line=>{
        const m=line.match(/^(\d+)\.\s*(.+)$/);
        return m?{plain:false,text:m[2]}:{plain:true,text:line};
      });
    }
    const residenceRows=toRows(formatBidNarrative(d));
    const dantaRows=toRows(formatBidNarrative(d,true));
    if((d.credit_amount||0)>0){
      dantaRows.push({plain:true,text:'** 단, 신용대출 활용 시 경락잔금대출까지 함께 나오는지 항상 확인 필요'});
    }
    const noteTop=oneHouse?oneHouseNoteTop:multiNoteTop;
    const noteBottom=oneHouse?oneHouseNoteBottom:multiNoteBottom;
    let rn1=1,rn2=1;
    mainTitle='';
    bodyContent=sectionTitleHtml('투자방향성 분석 - 실거주')
      +residenceRows.map(r=>r.plain
        ?`<div style="font-size:12.5px;line-height:1.6;color:#555;margin-top:6px">${r.text}</div>`
        :rowHtml(rn1++,r.text)
      ).join('')
      +noteTop
      +sectionTitleHtml('투자방향성 분석 - 단타매매')
      +dantaRows.map(r=>r.plain
        ?`<div style="font-size:12.5px;line-height:1.6;color:#555;margin-top:6px">${r.text}</div>`
        :rowHtml(rn2++,r.text)
      ).join('')
      +noteBottom;
    bottomNoteBox='';
  }else if(oneHouse&&wantsResidence&&numberedCount>=2&&!usesNewScheme){
    // 실거주 목적 시 / 단타매매 목적 시 섹션을 나누고, 각 섹션 안에서 번호를 1부터 새로 매김
    const restItems=narrativeRowsArr.slice(1);
    let rn=1;
    mainTitle='';
    bodyContent=sectionTitleHtml('투자방향성 분석 - 실거주')
      +rowHtml(1,narrativeRowsArr[0].text)
      +oneHouseNoteTop
      +sectionTitleHtml('투자방향성 분석 - 단타매매')
      +restItems.map(r=>r.plain
        ?`<div style="font-size:12.5px;line-height:1.6;color:#555;margin-top:6px">${r.text}</div>`
        :rowHtml(rn++,r.text)
      ).join('')
      +oneHouseNoteBottom;
    bottomNoteBox='';
  }else if(noHouse&&wantsResidenceNH&&snrOkNH&&narrativeRowsArr.length&&!usesNewScheme){
    // 무주택자도 1주택자와 동일하게 실거주/단타매매 섹션 분리 + [단타]엔 5억 상한 버전 수도권 줄 추가
    const restItems=narrativeRowsArr.slice(1);
    const aptBid=snr70NH;
    const t=tierLabel(aptBid);
    const dantaLine='수도권 규제·비규제 '+t.propType+' '+fsCapPdf(aptBid)+' 이하'+t.regionTag;
    let rn=1;
    mainTitle='';
    bodyContent=sectionTitleHtml('투자방향성 분석 - 실거주')
      +rowHtml(1,narrativeRowsArr[0].text)
      +noHouseNoteTop
      +sectionTitleHtml('투자방향성 분석 - 단타매매')
      +rowHtml(rn++,dantaLine)
      +restItems.map(r=>r.plain
        ?`<div style="font-size:12.5px;line-height:1.6;color:#555;margin-top:6px">${r.text}</div>`
        :rowHtml(rn++,r.text)
      ).join('')
      +noHouseNoteBottom;
    bottomNoteBox='';
  }else if(multi&&wantsResidenceMulti&&narrativeRowsArr.length&&!usesNewScheme){
    // 다주택자 실거주 목적: 계산된 금액 대신 "별도 상담 필요" 안내, 단타 항목은 기존 계산 그대로
    let rn=1;
    mainTitle='';
    bodyContent=sectionTitleHtml('투자방향성 분석 - 실거주')
      +rowHtml(1,'별도 상담 필요')
      +multiNoteTop
      +sectionTitleHtml('투자방향성 분석 - 단타매매')
      +narrativeRowsArr.map(r=>r.plain
        ?`<div style="font-size:12.5px;line-height:1.6;color:#555;margin-top:6px">${r.text}</div>`
        :rowHtml(rn++,r.text)
      ).join('')
      +multiNoteBottom;
    bottomNoteBox='';
  }else{
    mainTitle='투자 방향성 분석';
    let n=1;
    bodyContent=narrativeRowsArr.map(r=>r.plain
      ?`<div style="font-size:13px;line-height:1.6;color:#333">${r.text}</div>`
      :rowHtml(n++,r.text)
    ).join('');
    bottomNoteBox=noteBox;
  }

  const container=document.createElement('div');
  container.style.cssText='position:fixed;left:-9999px;top:0;width:600px;background:#fff;font-family:var(--font);';
  container.innerHTML=`
    <div style="width:600px;box-sizing:border-box;background:#fff;border:1px solid #e3e3e3;border-radius:6px;overflow:hidden">
      <div style="background:#9314cc;padding:22px 28px">
        <table style="width:100%;border-collapse:collapse"><tr>
          <td style="vertical-align:top;padding:0">
            <div style="font-size:19px;font-weight:700;color:#fff">투자 방향성 리포트</div>
          </td>
          <td style="vertical-align:middle;padding:0;text-align:right;white-space:nowrap">
            <img src="/report-logo.png" width="104" height="28" style="height:28px;width:104px;display:inline-block" alt="logo"/>
          </td>
        </tr></table>
      </div>
      <div style="padding:24px 28px 8px">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <tr>
            <td style="width:70px;padding:7px 0;color:#888">기수</td>
            <td style="padding:7px 0;color:#222;font-weight:600">${d.cohort}</td>
            <td style="width:70px;padding:7px 0;color:#888">이름</td>
            <td style="padding:7px 0;color:#222;font-weight:600">${d.name}님</td>
          </tr>
          <tr>
            <td style="padding:7px 0;color:#888;border-top:1px solid #f0f0f0">투자금</td>
            <td style="padding:7px 0;color:#222;font-weight:600;border-top:1px solid #f0f0f0">${seedLine.replace('시드 : ','')}</td>
            <td style="padding:7px 0;color:#888;border-top:1px solid #f0f0f0">주택유형</td>
            <td style="padding:7px 0;color:#222;font-weight:600;border-top:1px solid #f0f0f0">${d.housing_type}${(noHouse||oneHouse)?` (${transferLabel})`:''}</td>
          </tr>
        </table>
      </div>
      <div style="padding:8px 28px 26px">
        ${mainTitle?`<table style="border-collapse:collapse;margin:18px 0 16px"><tr>
          <td style="width:4px;padding:0"><div style="width:4px;height:16px;background:#9314cc"></div></td>
          <td style="padding:0 0 0 8px"><div style="font-size:14.5px;font-weight:700;color:#9314cc;line-height:16px">${mainTitle}</div></td>
        </tr></table>`:''}
        ${bodyContent}
        ${smallLoanNote||''}${bottomNoteBox}
      </div>
      <table style="width:100%;border-collapse:collapse;padding:14px 28px;background:#fafafa;border-top:1px solid #eee"><tr>
        <td style="padding:14px 28px;font-size:10.5px;color:#999;line-height:1.6">본 리포트는 설문지를 기준으로 산정된 투자 방향성 참고자료이며, 정확한 대출 조건 및 세부 사항은 별도 상담을 통해 확인하시기 바랍니다.</td>
      </tr></table>
    </div>`;
  document.body.appendChild(container);

  try{
    // 로고(/report-logo.png)가 다 불러와진 뒤 그림
    await Promise.all([...container.querySelectorAll('img')].map(im=>im.complete?0:new Promise(r=>{im.onload=im.onerror=r;})));
    if(document.fonts&&document.fonts.ready) await document.fonts.ready; // 웹폰트 적용 후 그림
    const canvas=await html2canvas(container,{scale:2,backgroundColor:'#ffffff'});
    const imgData=canvas.toDataURL('image/png');

    // 작성일 텍스트도 한글 폰트 문제 회피를 위해 이미지로 렌더링
    const dateEl=document.createElement('div');
    dateEl.style.cssText='position:fixed;left:-9999px;top:0;font-family:var(--font);font-size:11px;color:#999;white-space:nowrap;background:#fff;padding:2px';
    dateEl.textContent=`작성일 ${dateStr}`;
    document.body.appendChild(dateEl);
    const dateCanvas=await html2canvas(dateEl,{scale:2,backgroundColor:'#ffffff'});
    const dateImgData=dateCanvas.toDataURL('image/png');
    document.body.removeChild(dateEl);

    const {jsPDF}=window.jspdf;
    const A4_W=595.28, A4_H=841.89; // A4 in pt
    const imgW=A4_W-60;
    const imgH=canvas.height*imgW/canvas.width; // 비율 유지 (절대 찌그러뜨리지 않음)
    const pageH=Math.max(A4_H, imgH+60+30); // 내용이 길면 페이지 자체를 늘려서 세로 스크롤 형태로, 절대 압축하지 않음
    const pdf=new jsPDF({unit:'pt',format:[A4_W,pageH]});
    const pageW=A4_W;
    pdf.addImage(imgData,'PNG',30,30,imgW,imgH);

    const dateImgW=dateCanvas.width/2;
    const dateImgH=dateCanvas.height/2;
    pdf.addImage(dateImgData,'PNG',pageW-30-dateImgW,pageH-25-dateImgH,dateImgW,dateImgH);

    return {pdf,filename:`${d.cohort}_${d.name}_컨설팅리포트.pdf`};
  }finally{
    document.body.removeChild(container);
  }
}

// 개별 다운로드 버튼용: buildReportPDF로 만든 PDF를 바로 저장
async function generateReportPDF(d){
  try{
    const {pdf,filename}=await buildReportPDF(d);
    pdf.save(filename);
  }catch(e){
    alert('PDF 생성 오류: '+e.message);
  }
}

// 전체(현재 필터된 목록) PDF를 ZIP으로 묶어서 한 번에 다운로드
async function downloadAllPDFs(){
  if(!students.length){alert('다운로드할 학생이 없습니다.');return;}
  const btn=document.getElementById('bulkPdfBtn');
  const origText=btn.textContent;
  btn.disabled=true;
  try{
    const zip=new JSZip();
    for(let i=0;i<students.length;i++){
      const d=students[i];
      btn.textContent=`PDF 생성 중... (${i+1}/${students.length})`;
      try{
        const {pdf,filename}=await buildReportPDF(d);
        const blob=pdf.output('blob');
        zip.file(filename,blob);
      }catch(e){
        console.error(d.name+' PDF 생성 실패:',e);
      }
    }
    btn.textContent='압축하는 중...';
    const zipBlob=await zip.generateAsync({type:'blob'});
    const cohortLabel=document.getElementById('fC').value||'전체';
    const url=URL.createObjectURL(zipBlob);
    const a=document.createElement('a');
    a.href=url;
    a.download=`${cohortLabel}_컨설팅리포트_모음.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }catch(e){
    alert('일괄 다운로드 오류: '+e.message);
  }finally{
    btn.disabled=false;
    btn.textContent=origText;
  }
}
