const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const recommendApi = require('../recommend-api');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'));
  let db = { students: [{ id: 1, cohort: '54기', name: '김테스트' }], nextId: 2 };
  const router = recommendApi({ readDB: () => JSON.parse(JSON.stringify(db)), writeDB: d => { db = d; }, dataDir: dir });
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api', router);
  return new Promise(ok => { const srv = app.listen(0, () => ok({ srv, dir, base: `http://127.0.0.1:${srv.address().port}/api`, db: () => db, router })); });
}
const j = (url, method = 'GET', body) => fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) }).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));

test('case numbers are normalized', () => {
  assert.equal(recommendApi.normalizeCaseNo(' 2025 타경 52471 '), '2025타경52471');
  assert.equal(recommendApi.normalizeCaseNo('사건 없음'), '');
});

test('sanitize keeps only allowed fields and numbers', () => {
  const out = recommendApi.sanitize({ case_no: 'x', appraisal: '13,000', min_price: 'abc', hacker: 1, status: '삭제', reasons: [{ title: 'a' }] });
  assert.equal(out.appraisal, 13000);
  assert.equal(out.min_price, null);
  assert.ok(!('hacker' in out));
  assert.ok(!('status' in out));
  assert.equal(out.reasons.length, 3);
});

test('recommendation CRUD, images, import and cleanup', async () => {
  const { srv, dir, base, db, router } = await setup();
  try {
    const c = await j(`${base}/students/1/recommendations`, 'POST', { case_no: '2025타경 1', appraisal: 13000 });
    assert.equal(c.status, 201);
    assert.equal(c.body.case_no, '2025타경1');
    assert.equal(c.body.status, '작성중');
    const u = await j(`${base}/recommendations/${c.body.id}`, 'PUT', { min_price: 9100, status: '발송완료' });
    assert.equal(u.body.min_price, 9100);
    assert.ok(u.body.sent_at);
    const png = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, '../public/report-logo.png')).toString('base64');
    const im = await j(`${base}/recommendations/${c.body.id}/images`, 'POST', { dataUrl: png, caption: '상세' });
    assert.equal(im.status, 201);
    const file = im.body.images[0].file;
    assert.ok(fs.existsSync(path.join(dir, 'rec-images', file)));
    const bad = await j(`${base}/recommendations/${c.body.id}/images`, 'POST', { dataUrl: 'data:text/html;base64,PGh0bWw+' });
    assert.equal(bad.status, 400);
    assert.equal((await fetch(`${base}/rec-images/..%2Fdb.json`)).status, 400);
    const imp = await j(`${base}/recommendations/import`, 'POST', { items: [
      { cohort: '54기', name: '김테스트', case_no: '2025타경1' },
      { cohort: '54기', name: '김테스트', case_no: '2024타경583902', headline: '인천 빌라' },
      { cohort: '45기', name: '없는사람', case_no: '2025타경5' }] });
    assert.deepEqual([imp.body.created, imp.body.skipped, imp.body.unmatched], [1, 1, ['45기 없는사람']]);
    const sum = await j(`${base}/recommendations/summary`);
    assert.equal(sum.body['1'].total, 2);
    const d = db(); router.cleanupStudent(d, 1);
    assert.equal(d.recommendations.length, 0);
    assert.ok(!fs.existsSync(path.join(dir, 'rec-images', file)));
  } finally { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
