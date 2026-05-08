const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const db = new Database('database.db');

// ─── 스키마 초기화 ───────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS cohorts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT UNIQUE NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS students (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    cohort              TEXT NOT NULL,
    name                TEXT NOT NULL,
    housing_type        TEXT NOT NULL,           -- 무주택 | 생애최초 | 1주택 | 다주택
    seed_amount         INTEGER NOT NULL DEFAULT 0,   -- 시드금액 (만원)
    credit_amount       INTEGER NOT NULL DEFAULT 0,   -- 신용대출가능금액 (만원)
    loan_available      TEXT NOT NULL DEFAULT 'unknown', -- Y | N | unknown
    transfer_available  TEXT NOT NULL DEFAULT 'unknown', -- Y | N | unknown
    note                TEXT NOT NULL DEFAULT '',
    flags               TEXT NOT NULL DEFAULT '[]',  -- JSON 배열
    status              TEXT NOT NULL DEFAULT '대기', -- 대기 | 완료 | 재상담
    consult_date        TEXT NOT NULL DEFAULT '',
    consult_note        TEXT NOT NULL DEFAULT '',
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_students_cohort   ON students(cohort);
  CREATE INDEX IF NOT EXISTS idx_students_status   ON students(status);
  CREATE INDEX IF NOT EXISTS idx_students_housing  ON students(housing_type);
  CREATE INDEX IF NOT EXISTS idx_students_name     ON students(name);
`);

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// ─── 유틸 ──────────────────────────────────────────────────────
const parseStudent = s => ({ ...s, flags: JSON.parse(s.flags || '[]') });

const upsertCohort = db.transaction((cohort) => {
  db.prepare(`INSERT OR IGNORE INTO cohorts (name) VALUES (?)`).run(cohort);
});

// ─── 수강생 조회 ────────────────────────────────────────────────
app.get('/api/students', (req, res) => {
  const { cohort, housing_type, status, search } = req.query;
  let sql = 'SELECT * FROM students WHERE 1=1';
  const params = [];

  if (cohort)       { sql += ' AND cohort = ?';        params.push(cohort); }
  if (housing_type) { sql += ' AND housing_type = ?';  params.push(housing_type); }
  if (status)       { sql += ' AND status = ?';        params.push(status); }
  if (search)       { sql += ' AND name LIKE ?';       params.push(`%${search}%`); }

  sql += ' ORDER BY cohort ASC, id ASC';

  try {
    const rows = db.prepare(sql).all(...params);
    res.json(rows.map(parseStudent));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── 단건 조회 ──────────────────────────────────────────────────
app.get('/api/students/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '수강생을 찾을 수 없습니다.' });
  res.json(parseStudent(row));
});

// ─── 수강생 추가 ────────────────────────────────────────────────
app.post('/api/students', (req, res) => {
  const {
    cohort, name, housing_type,
    seed_amount = 0, credit_amount = 0,
    loan_available = 'unknown', transfer_available = 'unknown',
    note = '', flags = [], status = '대기',
    consult_date = '', consult_note = ''
  } = req.body;

  if (!cohort || !name || !housing_type) {
    return res.status(400).json({ error: '기수, 이름, 주택유형은 필수입니다.' });
  }

  try {
    upsertCohort(cohort);
    const result = db.prepare(`
      INSERT INTO students
        (cohort, name, housing_type, seed_amount, credit_amount,
         loan_available, transfer_available, note, flags, status, consult_date, consult_note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      cohort, name, housing_type,
      seed_amount, credit_amount,
      loan_available, transfer_available,
      note, JSON.stringify(flags), status,
      consult_date, consult_note
    );
    const created = db.prepare('SELECT * FROM students WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(parseStudent(created));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── 수강생 수정 ────────────────────────────────────────────────
app.put('/api/students/:id', (req, res) => {
  const {
    cohort, name, housing_type,
    seed_amount, credit_amount,
    loan_available, transfer_available,
    note, flags, status,
    consult_date, consult_note
  } = req.body;

  const exists = db.prepare('SELECT id FROM students WHERE id = ?').get(req.params.id);
  if (!exists) return res.status(404).json({ error: '수강생을 찾을 수 없습니다.' });

  try {
    if (cohort) upsertCohort(cohort);
    db.prepare(`
      UPDATE students SET
        cohort = ?, name = ?, housing_type = ?,
        seed_amount = ?, credit_amount = ?,
        loan_available = ?, transfer_available = ?,
        note = ?, flags = ?, status = ?,
        consult_date = ?, consult_note = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      cohort, name, housing_type,
      seed_amount, credit_amount,
      loan_available, transfer_available,
      note, JSON.stringify(flags || []), status,
      consult_date, consult_note,
      req.params.id
    );
    const updated = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);
    res.json(parseStudent(updated));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── 수강생 삭제 ────────────────────────────────────────────────
app.delete('/api/students/:id', (req, res) => {
  const exists = db.prepare('SELECT id FROM students WHERE id = ?').get(req.params.id);
  if (!exists) return res.status(404).json({ error: '수강생을 찾을 수 없습니다.' });
  db.prepare('DELETE FROM students WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ─── 기수 목록 ──────────────────────────────────────────────────
app.get('/api/cohorts', (req, res) => {
  const rows = db.prepare('SELECT DISTINCT cohort FROM students ORDER BY cohort ASC').all();
  res.json(rows.map(r => r.cohort));
});

// ─── 통계 ────────────────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  const total     = db.prepare('SELECT COUNT(*) as n FROM students').get().n;
  const avgSeed   = db.prepare('SELECT AVG(seed_amount) as a FROM students').get().a || 0;
  const byStatus  = db.prepare('SELECT status, COUNT(*) as n FROM students GROUP BY status').all();
  const byHousing = db.prepare('SELECT housing_type, COUNT(*) as n FROM students GROUP BY housing_type').all();
  const byCohort  = db.prepare(`
    SELECT cohort,
      COUNT(*) as total,
      SUM(CASE WHEN status='완료'   THEN 1 ELSE 0 END) as done,
      SUM(CASE WHEN status='재상담' THEN 1 ELSE 0 END) as recon,
      AVG(seed_amount) as avg_seed
    FROM students GROUP BY cohort ORDER BY cohort
  `).all();
  res.json({ total, avgSeed: Math.round(avgSeed), byStatus, byHousing, byCohort });
});

// ─── 초기 데이터 시드 (DB가 비어있을 때만) ─────────────────────
app.post('/api/seed', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) as n FROM students').get().n;
  if (count > 0) return res.json({ skipped: true, count });

  const { students } = req.body;
  if (!Array.isArray(students)) return res.status(400).json({ error: '잘못된 형식' });

  const insert = db.prepare(`
    INSERT INTO students
      (cohort, name, housing_type, seed_amount, credit_amount,
       loan_available, transfer_available, note, flags, status, consult_date, consult_note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const seed = db.transaction((list) => {
    for (const s of list) {
      upsertCohort(s.cohort);
      insert.run(
        s.cohort, s.name, s.housing_type,
        s.seed_amount || 0, s.credit_amount || 0,
        s.loan_available || 'unknown', s.transfer_available || 'unknown',
        s.note || '', JSON.stringify(s.flags || []),
        s.status || '대기', s.consult_date || '', s.consult_note || ''
      );
    }
  });

  seed(students);
  res.json({ ok: true, inserted: students.length });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ 서버 실행 중: http://localhost:${PORT}`);
});
