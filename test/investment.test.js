const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const rules = require('../public/investment-rules');
const investmentApi = require('../investment-api');
const input = { housing_type: '무주택', transfer_available: 'Y', investment_purpose: '실거주', seed_amount: 8000, credit_amount: 2000 };
const token = 'isolated-test-only-connection-token';

test('current reference profile keeps exact amounts and credit guidance', () => {
  const result = rules.diagnose(input);
  assert.equal(result.narrative, '[실거주&단타]\n1. 수도권 규제 1억 6,700만원 이하 (생애최초인 경우 3억 3,300만원 이하)\n2. 수도권 비규제 3억 3,300만원 이하\n3. 비수도권 3억 3,300만원 이하 (생애최초인 경우 5억원 이하)\n** 단, 신용대출 활용 시 경락잔금대출까지 함께 나오는지 항상 확인 필요');
  assert.equal(result.cards.reg.st, 'O');
  assert.ok(result.notes[0].includes('전입 조건'));
  assert.ok(result.notes.every(note => !/<[^>]*>/.test(note)));
});

test('residence and short-term scenarios keep their reference distinction', () => {
  for (const changes of [{ transfer_available: 'N' }, { housing_type: '1주택' }, { housing_type: '다주택' }]) {
    const result = rules.diagnose({ ...input, ...changes });
    assert.match(result.narrative, /\[실거주\][\s\S]*\[단타\]/);
    assert.ok(result.notes.length);
  }
});

test('browser and PDF import the shared rules without redefining them', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.match(html, /src="\/investment-rules\.js"/);
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
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const send = (body = input, auth = token) => fetch(origin + '/api/investment/diagnose', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` }, body: JSON.stringify(body)
  });
  assert.equal((await send(input, '')).status, 401);
  assert.equal((await send(input, 'wrong-token')).status, 401);
  for (const patch of [{ seed_amount: -1 }, { credit_amount: '2000' }, { seed_amount: 1e20 }, { housing_type: 'invalid' }, { flags: ['unknown'] }]) {
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
  const result = rules.diagnose({ housing_type:'1주택', transfer_available:'Y', investment_purpose:'단타', seed_amount:13000, credit_amount:0 });
  assert.match(result.narrative, /수도권 비규제지역 현금\+신용대출 활용해 올현금 입찰 가능 물건 \(신용대출 가능금액 확인 필요\)/);
  assert.doesNotMatch(result.narrative, /수도권 비규제 APT·빌라 1억 3천만원 이하/);
});

test('high-cash no-house residence profile applies metro mortgage caps but keeps first-home reference', () => {
  const result = rules.diagnose({ housing_type:'무주택', transfer_available:'Y', investment_purpose:'단타+실거주', seed_amount:50000, credit_amount:0 });
  assert.equal(result.narrative, '[실거주&단타]\n1. 수도권 규제 8억 3,300만원 이하 (생애최초인 경우 11억원 이하)\n2. 수도권 비규제 11억원 이하\n3. 비수도권 16억 6,700만원 이하 (생애최초인 경우 25억원 이하)');
});
