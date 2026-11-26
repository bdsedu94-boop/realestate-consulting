const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const rules = require('../public/js/investment-rules');
const investmentApi = require('../server/investment-api');
const input = {
  housing_type: '무주택',
  transfer_available: 'Y',
  investment_purpose: '실거주',
  seed_amount: 8000,
  credit_amount: 2000
};
const token = 'isolated-test-only-connection-token';

test('current reference profile keeps exact amounts and credit guidance', () => {
  const result = rules.diagnose(input);
  assert.equal(
    result.narrative,
    '[실거주&단타]\n1. 수도권 규제 빌라 1억 6,700만원 이하\n2. 수도권 비규제 APT 3억 3,300만원 이하\n3. 비수도권 APT 2억 5천만원 ~ 5억원\n** 단, 신용대출 활용 시 경락잔금대출까지 함께 나오는지 항상 확인 필요'
  );
  assert.equal(result.cards.reg.st, 'O');
  assert.ok(result.notes[0].includes('전입 조건'));
  assert.ok(result.notes.every(note => !/<[^>]*>/.test(note)));
});

test('residence and short-term scenarios keep their reference distinction', () => {
  for (const changes of [{ transfer_available: 'N' }, { housing_type: '1주택' }, { housing_type: '다주택' }]) {
    const result = rules.diagnose({ ...input, ...changes });
    assert.match(result.narrative, /\[실거주( \(전입 가능 시\))?\][\s\S]*\[단타\]/);
    assert.ok(result.notes.length);
  }
});

test('browser and PDF import the shared rules without redefining them', () => {
  // 화면 코드: index.html + public/js/app/*.js (기능별로 나뉜 일반 script)
  const appDir = path.join(__dirname, '../public/js/app');
  const html = [
    fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8'),
    ...fs.readdirSync(appDir).map(f => fs.readFileSync(path.join(appDir, f), 'utf8'))
  ].join('\n');
  assert.match(html, /src="\/js\/investment-rules\.js"/);
  assert.match(html, /InvestmentRules\.getReportContext\(d\)/);
  assert.doesNotMatch(html, /function (consult|formatBidNarrative|formatBidNarrativeCSV|tierLabel)\(/);
  assert.match(html, /const BASE=\[\];/, 'student records must remain on the authenticated server');
  assert.doesNotMatch(html, /api\('\/api\/seed'/, 'opening the page must not reseed private data');
});

test('API authenticates, validates input, returns shared rules, and grants no student access', async t => {
  const app = express();
  app.use('/api/investment', investmentApi(token));
  app.use((req, res) => res.status(401).json({ error: 'Student login required' }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(
    () =>
      new Promise(resolve => {
        server.closeAllConnections();
        server.close(resolve);
      })
  );
  const origin = `http://127.0.0.1:${server.address().port}`;
  const send = (body = input, auth = token) =>
    fetch(origin + '/api/investment/diagnose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` },
      body: JSON.stringify(body)
    });
  assert.equal((await send(input, '')).status, 401);
  assert.equal((await send(input, 'wrong-token')).status, 401);
  for (const patch of [
    { seed_amount: -1 },
    { credit_amount: '2000' },
    { seed_amount: 1e20 },
    { housing_type: 'invalid' },
    { flags: ['unknown'] }
  ]) {
    assert.equal((await send({ ...input, ...patch })).status, 400);
  }
  const response = await send();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const data = await response.json();
  assert.equal(data.schemaVersion, 1);
  assert.match(data.ruleVersion, /^[a-f0-9]{64}$/);
  assert.deepEqual(data.result, rules.diagnose(input));
  const privateResponse = await fetch(origin + '/api/students', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(privateResponse.status, 401);
});

test('one-home short-term investor with unknown credit always gets cash+credit guidance', () => {
  const result = rules.diagnose({
    housing_type: '1주택',
    transfer_available: 'Y',
    investment_purpose: '단타',
    seed_amount: 13000,
    credit_amount: 0
  });
  assert.match(
    result.narrative,
    /수도권 비규제지역 현금\+신용대출 활용해 올현금 입찰 가능 물건 \(신용대출 가능금액 확인 필요\)/
  );
  assert.doesNotMatch(result.narrative, /수도권 비규제 APT·빌라 1억 3천만원 이하/);
});

test('high-cash no-house residence profile applies metro mortgage caps but keeps first-home reference', () => {
  const result = rules.diagnose({
    housing_type: '무주택',
    transfer_available: 'Y',
    investment_purpose: '단타+실거주',
    seed_amount: 50000,
    credit_amount: 0
  });
  assert.equal(
    result.narrative,
    '[실거주]\n1. 수도권 규제 APT 8억 3,300만원 이하\n2. 수도권 비규제 APT 11억원 이하\n3. 비수도권 APT 12억 5천만원 ~ 25억원\n[단타]\n4. 수도권 규제 APT·빌라 5억원 이하\n5. 수도권 비규제 APT 5억원 이하\n6. 비수도권 APT 5억원 이하 (단타 시 5억 초과 물건은 수익률 측면에서 비효율적)'
  );
});

test('one-home short-term investor with stated credit amount omits confusing all-cash label and keeps mortgage coexistence note', () => {
  const result = rules.diagnose({
    housing_type: '1주택',
    transfer_available: 'N',
    investment_purpose: '단타',
    seed_amount: 5000,
    credit_amount: 5000,
    loan_available: 'Y'
  });
  assert.match(result.narrative, /수도권 비규제 빌라 1억원 이하 \(인천, 부천\)/);
  assert.doesNotMatch(result.narrative, /올현금/);
  assert.match(result.narrative, /신용대출 활용 시 경락잔금대출까지 함께 나오는지 항상 확인 필요/);
});

test('non-metro uses LTV 60% for one-home and multi-home owners but keeps 60~80% for no-house', () => {
  const base = { investment_purpose: '단타', transfer_available: 'N', seed_amount: 8000, credit_amount: 2000 };
  const one = rules.diagnose({ ...base, housing_type: '1주택' });
  assert.match(one.narrative, /비수도권 APT 2억 5천만원 이하/);
  assert.doesNotMatch(one.narrative, /비수도권 APT 2억 5천만원 ~/);
  assert.match(rules.consult({ ...base, housing_type: '1주택' }).bid, /비수도권 2억 5,000만원 이하$/);
  assert.doesNotMatch(rules.consult({ ...base, housing_type: '다주택' }).bid, /LTV/);
  const multi = rules.diagnose({ ...base, housing_type: '다주택' });
  assert.match(multi.narrative, /비수도권 APT 2억 5천만원 이하 \(공시가 2억이하\)/);
  assert.ok(multi.notes.some(n => n.includes('경락잔금대출(LTV 60%)')));
  const none = rules.diagnose({ ...base, housing_type: '무주택' });
  assert.match(none.narrative, /비수도권 APT 2억 5천만원 ~ 5억원/);
});

test('all-cash flag follows the same amount tier table as other directions', () => {
  const line = seed =>
    rules
      .formatBidNarrative({
        housing_type: '1주택',
        investment_purpose: '단타',
        transfer_available: 'N',
        seed_amount: seed,
        credit_amount: 0,
        flags: ['올현금']
      })
      .split('\n')[0];
  assert.equal(line(6000), '1. 수도권 비규제 빌라 6천만원 이하 (인천, 부천) (올현금)');
  assert.equal(line(12000), '1. 수도권 비규제 APT·빌라 1억 2천만원 이하 (올현금)');
  assert.equal(line(20000), '1. 수도권 비규제 APT 2억원 이하 (인천, 경기외곽) (올현금)');
  assert.equal(line(40000), '1. 수도권 비규제 APT 4억원 이하 (올현금)');
});

test('one-home and multi-home non-metro follow the 60% table: 8,300만원 floor from 2,000만원', () => {
  const local = (h, seed) =>
    rules
      .formatBidNarrative({
        housing_type: h,
        investment_purpose: '단타',
        transfer_available: 'N',
        seed_amount: seed,
        credit_amount: 0,
        flags: []
      })
      .split('\n')
      .find(l => /비수도권/.test(l)) || '';
  assert.match(local('1주택', 1900), /비수도권 APT 입찰가 5,000~8,000만원대/); // 2,000만원 미만은 소액 대출 안내
  assert.match(local('1주택', 2000), /비수도권 APT 입찰가 기준: 8,300만원 이하/);
  assert.match(local('1주택', 3000), /비수도권 APT 입찰가 기준: 8,300만원 이하/);
  assert.match(local('1주택', 4000), /비수도권 APT 입찰가 기준: 1억원 이하/);
  assert.match(local('다주택', 3000), /비수도권 APT 8,300만원 이하 \(공시가 2억이하\)/);
});

test('no-house short-term metro splits regulated 40% (from 5,000만원) and non-regulated 70%', () => {
  const n = seed =>
    rules.diagnose({
      housing_type: '무주택',
      investment_purpose: '단타',
      transfer_available: 'Y',
      seed_amount: seed,
      credit_amount: 0,
      flags: []
    }).narrative;
  assert.match(
    n(4000),
    /1\. 수도권 규제 현금\+신용대출 활용해 올현금 입찰 가능 물건\n2\. 수도권 비규제 APT·빌라 1억 3,300만원 이하/
  );
  assert.match(
    n(5000),
    /1\. 수도권 규제 빌라 8,300만원 이하\n2\. 수도권 비규제 APT 1억 6,700만원 이하 \(인천, 경기외곽\)/
  );
  assert.match(n(10000), /1\. 수도권 규제 빌라 1억 6,700만원 이하\n2\. 수도권 비규제 APT 3억 3,300만원 이하/);
  const first = rules.diagnose({
    housing_type: '생애최초',
    investment_purpose: '단타',
    transfer_available: 'Y',
    seed_amount: 10000,
    credit_amount: 0,
    flags: []
  }).narrative;
  assert.match(first, /^1\. 수도권 규제 APT·빌라 3억 3,300만원 이하\n2\. 수도권 비규제 APT 3억 3,300만원 이하/);
  const card = rules.consult({
    housing_type: '무주택',
    investment_purpose: '실거주',
    transfer_available: 'Y',
    seed_amount: 10000,
    credit_amount: 0,
    flags: []
  }).bid;
  assert.equal(
    card.split(' / ').slice(0, 2).join(' / '),
    '수도권 규제 1억 6,700만원 이하 / 수도권 비규제 3억 3,300만원 이하'
  );
});

test('no-house metro follows the 40%/70% table up to the common 5억 bid cap without an all-cash switch', () => {
  const n = (h, seed) =>
    rules.diagnose({
      housing_type: h,
      investment_purpose: '단타',
      transfer_available: 'Y',
      seed_amount: seed,
      credit_amount: 0,
      flags: []
    }).narrative;
  assert.match(n('무주택', 15000), /1\. 수도권 규제 빌라 2억 5천만원 이하\n2\. 수도권 비규제 APT 5억원 이하/);
  assert.match(n('무주택', 20000), /1\. 수도권 규제 APT·빌라 3억 3,300만원 이하\n2\. 수도권 비규제 APT 5억원 이하/);
  assert.match(n('생애최초', 20000), /^1\. 수도권 규제 APT·빌라 5억원 이하\n2\. 수도권 비규제 APT 5억원 이하/);
  const c = rules.consult({
    housing_type: '무주택',
    investment_purpose: '단타',
    transfer_available: 'Y',
    seed_amount: 20000,
    credit_amount: 0,
    flags: []
  });
  assert.match(c.bid, /^수도권 규제 3억 3,300만원 이하 \/ 수도권 비규제 5억원 이하/);
  assert.doesNotMatch(c.ltvLabel, /올현금/);
});

test('residence regulated 40% starts at 5,000만원 like the table, and residence cards match the narrative', () => {
  const d = (h, seed) => ({
    housing_type: h,
    investment_purpose: '실거주',
    transfer_available: 'Y',
    seed_amount: seed,
    credit_amount: 0,
    flags: []
  });
  assert.match(rules.formatBidNarrative(d('무주택', 5000)), /^1\. 수도권 규제 빌라 8,300만원 이하/);
  assert.match(
    rules.formatBidNarrative(d('1주택', 5000)),
    /^1\. 수도권 규제 빌라 8,300만원 이하 \(기존주택 처분조건부\)/
  );
  assert.match(
    rules.formatBidNarrative(d('1주택', 4900)),
    /^1\. 수도권 규제 현금\+신용대출 활용해 올현금 입찰 가능 물건/
  );
  assert.equal(
    rules.consult(d('1주택', 10000)).bid.split(' / ').slice(0, 2).join(' / '),
    '수도권 규제 1억 6,700만원 이하 (기존주택 처분조건부·전입조건부) / 수도권 비규제 3억 3,300만원 이하 (기존주택 처분조건부·전입조건부)'
  );
  assert.equal(
    rules
      .consult({ ...d('1주택', 10000), investment_purpose: '단타' })
      .bid.split(' / ')
      .slice(0, 2)
      .join(' / '),
    '수도권 규제 불가 / 수도권 비규제 1억원 (신용/현금·조건부)'
  );
});

test('short-term lines cut by the 5억 cap carry the efficiency note once, on the last cut line', () => {
  const n = (h, seed, t = 'N') =>
    rules.diagnose({
      housing_type: h,
      investment_purpose: '단타',
      transfer_available: t,
      seed_amount: seed,
      credit_amount: 0,
      flags: []
    }).narrative;
  const NOTE = '(단타 시 5억 초과 물건은 수익률 측면에서 비효율적)';
  assert.match(
    n('1주택', 50000),
    /2\. 비수도권 APT 입찰가 기준: 5억원 이하 \(단타 시 5억 초과 물건은 수익률 측면에서 비효율적\)/
  );
  assert.ok(!n('1주택', 20000).includes(NOTE), '2억이면 정확히 5억이라 잘리지 않음');
  assert.ok(!n('1주택', 10000).includes(NOTE));
  const nh = n('무주택', 20000, 'Y');
  assert.equal(nh.split(NOTE).length - 1, 1);
  assert.match(nh, /3\. 비수도권 APT 5억원 이하 \(단타 시 5억 초과 물건은 수익률 측면에서 비효율적\)/);
});

test('first-home short-term metro is split into regulated and non-regulated lines without region tags on the regulated line', () => {
  const n = rules.diagnose({
    housing_type: '생애최초',
    investment_purpose: '단타',
    transfer_available: 'Y',
    seed_amount: 2000,
    credit_amount: 4400,
    flags: []
  }).narrative;
  assert.match(
    n,
    /^1\. 수도권 규제 빌라 2억 1,300만원 이하\n2\. 수도권 비규제 APT 2억 1,300만원 이하 \(인천, 경기외곽\)/
  );
});

test('no-house (non-first) results no longer carry the "(생애최초인 경우 …)" hint', () => {
  for (const p of ['단타', '실거주', '단타+실거주'])
    for (const t of ['Y', 'N'])
      for (const seed of [3000, 5000, 10000, 30000]) {
        const r = rules.diagnose({
          housing_type: '무주택',
          investment_purpose: p,
          transfer_available: t,
          seed_amount: seed,
          credit_amount: 0,
          flags: []
        });
        assert.ok(!r.narrative.includes('생애최초인 경우'), `${p}/${t}/${seed}`);
      }
});

test('first-home sentence in notes appears only for 생애최초, not for 무주택', () => {
  const notes = h =>
    rules
      .diagnose({
        housing_type: h,
        investment_purpose: '실거주',
        transfer_available: 'Y',
        seed_amount: 10000,
        credit_amount: 0,
        flags: []
      })
      .notes.join('\n');
  assert.ok(!notes('무주택').includes('생애최초'));
  assert.ok(notes('생애최초').includes('생애최초 구입'));
  assert.ok(
    !rules
      .getReportContext({
        housing_type: '무주택',
        investment_purpose: '실거주',
        transfer_available: 'Y',
        seed_amount: 10000,
        credit_amount: 0,
        flags: []
      })
      .noHouseNoteTop.includes('생애최초')
  );
});

test('no-house and first-home residence non-metro shows the 60~80% range like short-term', () => {
  const local = (h, seed) =>
    rules
      .formatBidNarrative({
        housing_type: h,
        investment_purpose: '실거주',
        transfer_available: 'Y',
        seed_amount: seed,
        credit_amount: 0,
        flags: []
      })
      .split('\n')
      .find(l => /비수도권/.test(l));
  assert.equal(local('무주택', 3000), '3. 비수도권 APT 8,300만원 ~ 1억 5천만원');
  assert.equal(local('무주택', 6000), '3. 비수도권 APT 1억 5천만원 ~ 3억원');
  assert.equal(local('생애최초', 10000), '3. 비수도권 APT 2억 5천만원 ~ 5억원');
});

test('regulated-area lines use the regulated tier table (no tag up to 3억) in short-term and residence', () => {
  const n = (h, p, seed) =>
    rules.formatBidNarrative({
      housing_type: h,
      investment_purpose: p,
      transfer_available: 'Y',
      seed_amount: seed,
      credit_amount: 0,
      flags: []
    });
  assert.match(n('무주택', '단타', 10000), /^1\. 수도권 규제 빌라 1억 6,700만원 이하\n/);
  assert.match(n('무주택', '실거주', 20000), /1\. 수도권 규제 APT·빌라 3억 3,300만원 이하/);
  assert.match(n('1주택', '실거주', 50000), /1\. 수도권 규제 APT 8억 3,300만원 이하 \(기존주택 처분조건부\)/);
  assert.match(
    n('다주택', '실거주', 10000),
    /1\. 수도권 비규제 APT 2억 5천만원 이하 \(인천, 경기외곽\) \(기존주택 처분조건부\)/
  );
});

test('1,000만원대 with no loanable region gets the small-loan non-metro line and note', () => {
  const r = (h, seed, credit = 0) =>
    rules.diagnose({
      housing_type: h,
      investment_purpose: '단타',
      transfer_available: 'N',
      seed_amount: seed,
      credit_amount: credit,
      flags: []
    });
  const one = r('1주택', 1000);
  assert.match(one.narrative, /2\. 비수도권 APT 입찰가 5,000~8,000만원대 \(소액 대출 가능 여부 입찰 전 확인 필요\)/);
  assert.ok(one.notes[0].includes('소액 대출') && one.notes[0].includes('우선 신용대출이 얼마나 나오는지부터'));
  assert.match(r('다주택', 1500).narrative, /5,000~8,000만원대 \(공시가 2억이하\)/);
  assert.ok(!r('1주택', 900).narrative.includes('5,000~8,000'));
  assert.ok(!r('1주택', 2000).narrative.includes('5,000~8,000'));
  assert.ok(!r('무주택', 1200, 300).notes[0].includes('우선 신용대출'), '신용대출 금액을 알면 확인 문장 생략');
});

test('no-house residence merges with short-term only when both results match, and cards follow the narrative', () => {
  const d = seed => ({
    housing_type: '무주택',
    investment_purpose: '실거주',
    transfer_available: 'Y',
    seed_amount: seed,
    credit_amount: 0,
    flags: []
  });
  assert.match(rules.diagnose(d(10000)).narrative, /^\[실거주&단타\]/);
  assert.match(rules.diagnose(d(12000)).narrative, /^\[실거주\][\s\S]*\[단타\]/);
  assert.equal(rules.consult(d(20000)).bid.split(' / ')[2], '비수도권 5억원 ~ 10억원');
  assert.ok(!rules.consult(d(20000)).bid.includes('LTV'));
  assert.equal(rules.consult(d(2500)).bid.split(' / ')[1], '수도권 비규제 2,500만원 (올현금)');
  const cash = rules.formatBidNarrative({
    housing_type: '무주택',
    investment_purpose: '단타',
    transfer_available: 'Y',
    seed_amount: 60000,
    credit_amount: 0,
    flags: ['올현금']
  });
  assert.match(cash, /2\. 비수도권 APT 5억원 이하 \(올현금\)/);
});

test('one-home residence card labels follow residence rules; 60% residence starts at 2,000만원; hypothetical residence is titled', () => {
  const d = (h, p, t, seed) => ({
    housing_type: h,
    investment_purpose: p,
    transfer_available: t,
    seed_amount: seed,
    credit_amount: 0,
    flags: []
  });
  const c = rules.consult(d('1주택', '실거주', 'Y', 10000));
  assert.equal(c.ltvLabel, '수도권 규제 LTV 40%·비규제 70% (처분조건부) · 비수도권 LTV 60%');
  assert.equal(c.primary, '수도권 비규제 APT 1순위 (처분조건부)');
  assert.equal(c.nreg.nt, '기존주택 처분조건부·전입조건부');
  assert.equal(rules.consult(d('1주택', '단타', 'Y', 10000)).ltvLabel, '수도권 비규제 신용/현금 · 비수도권 LTV 60%');
  assert.equal(rules.consult(d('1주택', '단타', 'N', 1800)).primary, '');
  assert.match(rules.formatBidNarrative(d('1주택', '실거주', 'Y', 3000)), /3\. 비수도권 APT 8,300만원 이하/);
  assert.match(rules.diagnose(d('무주택', '실거주', 'N', 5000)).narrative, /^\[실거주 \(전입 가능 시\)\]/);
});
