// 경매 정보지(탱크옥션 상세정보 PDF) 해석 — 가상의 글자 배치로 검사 (실제 정보지·개인정보는 넣지 않음)
const test=require('node:test'), assert=require('node:assert');
const IS=require('../public/js/infosheet/parse.js');

// 한 단어 = 한 글자 조각. w는 글자 수 × 6pt
const W=(x,y,s,p=1)=>({p,x,y,w:String(s).length*6,h:9,s});
const ROW=(y,...cells)=>cells.map(([x,s])=>W(x,y,s));
const items=[
  ...ROW(40,[28,'경매'],[60,'2099타경123'],[400,'가상지방법원']),
  ...ROW(70,[28,'아파트'],[420,'매각일자'],[470,'2099.01.02']),
  ...ROW(90,[28,'서울특별시'],[90,'가상구'],[140,'가상동'],[190,'1']),
  ...ROW(120,[60,'건물면적'],[120,'59.90㎡(18.12평)'],[250,'소유자'],[300,'홍길동'],[420,'감정가'],[500,'300,000,000']),
  ...ROW(140,[250,'채무자'],[300,'홍길동'],[420,'최저가'],[500,'(70%)'],[540,'210,000,000']),
  ...ROW(160,[250,'채권자'],[300,'가상은행'],[420,'보증금'],[460,'(10%)'],[500,'21,000,000']),
  ...ROW(180,[300,'1차'],[340,'2098-12-01'],[420,'300,000,000'],[500,'유찰']),
  ...ROW(195,[300,'2차'],[340,'2099-01-02'],[420,'210,000,000']),
  ...ROW(210,[28,'15층'],[50,'중'],[65,'7층']),
  ...ROW(240,[28,'토지/건물'],[90,'현황']),
  ...ROW(300,[28,'임차인'],[70,'현황']),
  ...ROW(320,[30,'점유'],[110,'임차인'],[350,'대항력']),
  ...ROW(340,[30,'1'],[105,'이몽룡'],[350,'있음']),
  ...ROW(380,[30,'기타사항'],[110,'폐문부재']),
  ...ROW(420,[28,'건물등기']),
  ...ROW(440,[28,'을(1)'],[80,'2090-05-05'],[160,'근저당권설정'],[260,'말소기준'],[330,'소멸']),
  ...ROW(462,[28,'갑(2)'],[80,'2091-06-06'],[160,'가처분']),
  ...ROW(500,[28,'권리분석'],[80,'요약']),
  ...ROW(515,[28,'인수할'],[70,'권리가'],[112,'있습니다.']),
  ...ROW(560,[28,'매각사례'],[90,'(가상구'],[140,'아파트)']),
  ...ROW(580,[28,'최근'],[55,'3개월(2건)'],[300,'80.10']),
  ...ROW(600,[28,'최근'],[55,'12개월(9건)'],[300,'90.25']),
];
const lines=IS.toLines(items);

test('정보지 값 읽기', ()=>{
  const f=IS.parse(lines);
  assert.equal(f.case_no,'2099타경123');
  assert.equal(f.court,'가상지방법원');
  assert.equal(f.sale_date,'2099-01-02');
  assert.equal(f.prop_type,'아파트');
  assert.equal(f.headline,'서울 가상구 아파트');
  assert.equal(f.area,'59.90㎡(18.1평)');
  assert.equal(f.floor_main,'7층 / 총 15층');
  assert.equal(f.appraisal,30000);
  assert.equal(f.min_price,21000);
  assert.equal(f.deposit_rate,10);
  assert.equal(f.fail_count,1);
  assert.equal(f.win_rate,'80.1% ~ 90.3% (최근 12개월 9건 · 가상구 아파트)');
  const a=JSON.parse(f.auto_facts);
  assert.equal(a.tenants,1);
  assert.equal(a.tenantsWithPriority,1);
  assert.equal(a.closedDoor,true);
  assert.deepEqual(a.baseRight,{kind:'근저당권설정',date:'2090-05-05'});
  assert.deepEqual(a.assumedRights,['가처분']);
  assert.equal(a.rightsSummary,'인수할 권리가 있습니다.');
});

test('정보지 형식이 아니면 안내', ()=>{
  assert.throws(()=>IS.parse(IS.toLines(ROW(40,[28,'아무'],[60,'문서']))),/탱크옥션 경매 정보지 형식이 아닙니다/);
});

test('캡처 영역: 경매정보 (토지/건물 현황 전까지)', ()=>{
  const a=IS.captureArea(lines,842);
  assert.equal(a.p,1);
  assert.ok(a.y0<40&&a.y1>210&&a.y1<240);
});
