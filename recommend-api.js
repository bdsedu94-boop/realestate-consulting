const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/*
 * 추천물건 리포트 API
 * - 추천물건은 db.json 의 recommendations 배열에 저장 (수강생 1명 : 추천물건 N개)
 * - 캡처 이미지는 영구 볼륨의 rec-images 폴더에 저장, 로그인한 사용자만 조회 가능
 * - 금액 단위는 기존 수강생 데이터와 동일하게 "만원"
 */

const STATUSES = ['작성중', '검수완료', '발송완료'];
const TEXT_FIELDS = [
  'case_no', 'court', 'sale_date', 'headline', 'prop_type', 'area', 'floor_main', 'floor_sub',
  'occupancy', 'occupancy_sub', 'rights', 'rights_sub', 'win_rate', 'rent', 'strategy_note',
  'image_note', 'manager', 'win_rate_auto'
];
const NUM_FIELDS = ['appraisal', 'min_price', 'fail_count', 'bid_low', 'bid_high', 'deposit_rate'];
const MAX_IMAGES = 6;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

function cleanText(v, max = 2000) {
  return String(v ?? '').slice(0, max);
}
function cleanNum(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) && n >= 0 && n <= 10000000 ? n : null;
}

/** 클라이언트가 보낸 값 중 허용된 필드만 골라서 정리 */
function sanitize(body = {}) {
  const out = {};
  for (const f of TEXT_FIELDS) if (f in body) out[f] = cleanText(body[f]);
  for (const f of NUM_FIELDS) if (f in body) out[f] = cleanNum(body[f]);
  if ('reasons' in body) {
    const arr = Array.isArray(body.reasons) ? body.reasons : [];
    out.reasons = [0, 1, 2].map(i => ({
      title: cleanText(arr[i]?.title, 200),
      body: cleanText(arr[i]?.body, 1000)
    }));
  }
  if ('status' in body && STATUSES.includes(body.status)) out.status = body.status;
  return out;
}

function emptyRec() {
  const r = {};
  for (const f of TEXT_FIELDS) r[f] = '';
  for (const f of NUM_FIELDS) r[f] = null;
  r.deposit_rate = 10;
  r.reasons = [{ title: '', body: '' }, { title: '', body: '' }, { title: '', body: '' }];
  r.images = [];
  r.status = '작성중';
  return r;
}

/** "2025타경52471" → "2025타경52471" (공백 제거, 표기 통일) */
function normalizeCaseNo(s) {
  const m = String(s || '').replace(/\s/g, '').match(/(\d{4})타경(\d+)/);
  return m ? `${m[1]}타경${m[2]}` : '';
}

module.exports = function recommendApi({ readDB, writeDB, dataDir }) {
  const router = express.Router();
  const IMG_DIR = path.join(dataDir, 'rec-images');

  function ensureImgDir() {
    if (!fs.existsSync(IMG_DIR)) fs.mkdirSync(IMG_DIR, { recursive: true });
  }
  function loadDB() {
    const db = readDB();
    if (!Array.isArray(db.recommendations)) db.recommendations = [];
    if (!db.nextRecId) db.nextRecId = 1;
    return db;
  }
  function removeImageFiles(rec) {
    for (const img of rec.images || []) {
      try { fs.unlinkSync(path.join(IMG_DIR, img.file)); } catch (e) { /* 이미 없으면 무시 */ }
    }
  }
  function nextOrder(db, studentId) {
    const mine = db.recommendations.filter(r => r.student_id === studentId);
    return mine.length ? Math.max(...mine.map(r => r.order || 0)) + 1 : 1;
  }

  /* ── 수강생별 추천물건 개수/상태 요약 (카드 배지용) ── */
  router.get('/recommendations/summary', (req, res) => {
    const db = loadDB();
    const map = {};
    for (const r of db.recommendations) {
      const m = map[r.student_id] || (map[r.student_id] = { total: 0, 작성중: 0, 검수완료: 0, 발송완료: 0 });
      m.total++;
      m[r.status] = (m[r.status] || 0) + 1;
    }
    res.json(map);
  });

  /* ── 특정 수강생의 추천물건 목록 ── */
  router.get('/students/:id/recommendations', (req, res) => {
    const db = loadDB();
    const sid = parseInt(req.params.id);
    const list = db.recommendations.filter(r => r.student_id === sid).sort((a, b) => (a.order || 0) - (b.order || 0));
    res.json(list);
  });

  /* ── 추천물건 추가 ── */
  router.post('/students/:id/recommendations', (req, res) => {
    const db = loadDB();
    const sid = parseInt(req.params.id);
    if (!db.students.some(s => s.id === sid)) return res.status(404).json({ error: '수강생을 찾을 수 없습니다.' });
    const now = new Date().toISOString();
    const rec = {
      ...emptyRec(),
      ...sanitize(req.body),
      id: db.nextRecId++,
      student_id: sid,
      order: nextOrder(db, sid),
      images: [],
      created_at: now,
      updated_at: now
    };
    if (rec.case_no) rec.case_no = normalizeCaseNo(rec.case_no) || rec.case_no;
    db.recommendations.push(rec);
    writeDB(db);
    res.status(201).json(rec);
  });

  /* ── 시트(요약 탭) 추천물건 일괄 가져오기: 기수+이름으로 매칭, 같은 사건번호는 건너뜀 ── */
  router.post('/recommendations/import', (req, res) => {
    const db = loadDB();
    const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 3000) : [];
    let created = 0, skipped = 0;
    const unmatched = [];
    const now = new Date().toISOString();
    for (const it of items) {
      const cohort = cleanText(it.cohort, 20).trim();
      const name = cleanText(it.name, 50).trim();
      const caseNo = normalizeCaseNo(it.case_no);
      if (!caseNo) { skipped++; continue; }
      const st = db.students.find(s => s.cohort === cohort && s.name === name);
      if (!st) { unmatched.push(`${cohort} ${name}`); continue; }
      if (db.recommendations.some(r => r.student_id === st.id && r.case_no === caseNo)) { skipped++; continue; }
      db.recommendations.push({
        ...emptyRec(),
        id: db.nextRecId++,
        student_id: st.id,
        order: nextOrder(db, st.id),
        case_no: caseNo,
        headline: cleanText(it.headline, 200),
        manager: cleanText(it.manager, 50),
        created_at: now,
        updated_at: now
      });
      created++;
    }
    writeDB(db);
    res.json({ ok: true, created, skipped, unmatched: [...new Set(unmatched)] });
  });

  /* ── 추천물건 수정 ── */
  router.put('/recommendations/:rid', (req, res) => {
    const db = loadDB();
    const rid = parseInt(req.params.rid);
    const idx = db.recommendations.findIndex(r => r.id === rid);
    if (idx === -1) return res.status(404).json({ error: '추천물건을 찾을 수 없습니다.' });
    const patch = sanitize(req.body);
    const rec = { ...db.recommendations[idx], ...patch, updated_at: new Date().toISOString() };
    if (patch.case_no) rec.case_no = normalizeCaseNo(patch.case_no) || patch.case_no;
    if (Number.isInteger(req.body.order) && req.body.order > 0) rec.order = req.body.order;
    // 이미지 캡션/순서 변경 (파일 자체는 별도 API)
    if (Array.isArray(req.body.images)) {
      const byFile = Object.fromEntries((rec.images || []).map(i => [i.file, i]));
      const ordered = req.body.images.map(i => byFile[i.file] && { ...byFile[i.file], caption: cleanText(i.caption, 100) }).filter(Boolean);
      if (ordered.length === (rec.images || []).length) rec.images = ordered;
    }
    if (patch.status === '발송완료' && !rec.sent_at) rec.sent_at = rec.updated_at;
    db.recommendations[idx] = rec;
    writeDB(db);
    res.json(rec);
  });

  /* ── 추천물건 삭제 (이미지 파일도 함께 삭제) ── */
  router.delete('/recommendations/:rid', (req, res) => {
    const db = loadDB();
    const rid = parseInt(req.params.rid);
    const idx = db.recommendations.findIndex(r => r.id === rid);
    if (idx === -1) return res.status(404).json({ error: '추천물건을 찾을 수 없습니다.' });
    removeImageFiles(db.recommendations[idx]);
    db.recommendations.splice(idx, 1);
    writeDB(db);
    res.json({ ok: true });
  });

  /* ── 캡처 이미지 업로드 (브라우저에서 리사이즈·가림 처리 후 dataURL로 전송) ── */
  router.post('/recommendations/:rid/images', (req, res) => {
    const db = loadDB();
    const rid = parseInt(req.params.rid);
    const rec = db.recommendations.find(r => r.id === rid);
    if (!rec) return res.status(404).json({ error: '추천물건을 찾을 수 없습니다.' });
    if ((rec.images || []).length >= MAX_IMAGES) return res.status(400).json({ error: `이미지는 최대 ${MAX_IMAGES}장까지 첨부할 수 있습니다.` });
    const m = String(req.body?.dataUrl || '').match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return res.status(400).json({ error: '이미지 형식이 올바르지 않습니다.' });
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > MAX_IMAGE_BYTES) return res.status(400).json({ error: '이미지가 너무 큽니다 (최대 4MB).' });
    ensureImgDir();
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    const file = `r${rid}_${crypto.randomBytes(8).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(IMG_DIR, file), buf);
    rec.images = [...(rec.images || []), { file, caption: cleanText(req.body.caption, 100), source: req.body.source === 'auto' ? 'auto' : 'manual' }];
    rec.updated_at = new Date().toISOString();
    writeDB(db);
    res.status(201).json(rec);
  });

  /* ── 캡처 이미지 삭제 ── */
  router.delete('/recommendations/:rid/images/:file', (req, res) => {
    const db = loadDB();
    const rid = parseInt(req.params.rid);
    const rec = db.recommendations.find(r => r.id === rid);
    if (!rec) return res.status(404).json({ error: '추천물건을 찾을 수 없습니다.' });
    const img = (rec.images || []).find(i => i.file === req.params.file);
    if (!img) return res.status(404).json({ error: '이미지를 찾을 수 없습니다.' });
    removeImageFiles({ images: [img] });
    rec.images = rec.images.filter(i => i !== img);
    rec.updated_at = new Date().toISOString();
    writeDB(db);
    res.json(rec);
  });

  /* ── 캡처 이미지 조회 (로그인 필요) ── */
  router.get('/rec-images/:file', (req, res) => {
    const file = req.params.file;
    if (!/^r\d+_[a-f0-9]{16}\.(jpg|png|webp)$/.test(file)) return res.status(400).end();
    const p = path.join(IMG_DIR, file);
    if (!fs.existsSync(p)) return res.status(404).end();
    res.set('Cache-Control', 'private, max-age=86400');
    res.sendFile(p);
  });

  /** 수강생 삭제 시 연결된 추천물건·이미지 정리 (server.js에서 호출) */
  router.cleanupStudent = function (db, studentId) {
    if (!Array.isArray(db.recommendations)) return;
    db.recommendations.filter(r => r.student_id === studentId).forEach(removeImageFiles);
    db.recommendations = db.recommendations.filter(r => r.student_id !== studentId);
  };

  return router;
};

module.exports.normalizeCaseNo = normalizeCaseNo;
module.exports.sanitize = sanitize;
