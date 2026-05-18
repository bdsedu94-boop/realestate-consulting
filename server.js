const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'db.json');

/* ── DB 읽기/쓰기 ── */
function readDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    }
  } catch(e) { console.error('DB 읽기 오류:', e); }
  return { students: [], nextId: 1 };
}

function writeDB(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch(e) { console.error('DB 쓰기 오류:', e); }
}

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ── 수강생 목록 조회 ── */
app.get('/api/students', (req, res) => {
  try {
    const db = readDB();
    let list = db.students;
    const { cohort, housing_type, status, search } = req.query;
    if (cohort)       list = list.filter(s => s.cohort === cohort);
    if (housing_type) list = list.filter(s => s.housing_type === housing_type);
    if (status)       list = list.filter(s => s.status === status);
    if (search)       list = list.filter(s => s.name && s.name.includes(search));
    res.json(list);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ── 수강생 추가 ── */
app.post('/api/students', (req, res) => {
  try {
    const db = readDB();
    const student = { ...req.body, id: db.nextId++ };
    db.students.push(student);
    writeDB(db);
    res.status(201).json(student);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ── 수강생 수정 ── */
app.put('/api/students/:id', (req, res) => {
  try {
    const db = readDB();
    const id = parseInt(req.params.id);
    const idx = db.students.findIndex(s => s.id === id);
    if (idx === -1) return res.status(404).json({ error: '수강생을 찾을 수 없습니다.' });
    db.students[idx] = { ...db.students[idx], ...req.body, id };
    writeDB(db);
    res.json(db.students[idx]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ── 수강생 삭제 ── */
app.delete('/api/students/:id', (req, res) => {
  try {
    const db = readDB();
    const id = parseInt(req.params.id);
    const idx = db.students.findIndex(s => s.id === id);
    if (idx === -1) return res.status(404).json({ error: '수강생을 찾을 수 없습니다.' });
    db.students.splice(idx, 1);
    writeDB(db);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ── 기수 목록 ── */
app.get('/api/cohorts', (req, res) => {
  try {
    const db = readDB();
    const cohorts = [...new Set(db.students.map(s => s.cohort))].sort();
    res.json(cohorts);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ── 통계 ── */
app.get('/api/stats', (req, res) => {
  try {
    const db = readDB();
    const s = db.students;
    const total = s.length;
    const avgSeed = total ? Math.round(s.reduce((a, x) => a + (x.seed_amount || 0), 0) / total) : 0;
    const byStatus = ['대기','완료','재상담'].map(st => ({ status: st, n: s.filter(x => x.status === st).length }));
    const byHousing = [...new Set(s.map(x => x.housing_type))].map(h => ({ housing_type: h, n: s.filter(x => x.housing_type === h).length }));
    const cohorts = [...new Set(s.map(x => x.cohort))].sort();
    const byCohort = cohorts.map(c => {
      const g = s.filter(x => x.cohort === c);
      return { cohort: c, total: g.length, done: g.filter(x => x.status === '완료').length, recon: g.filter(x => x.status === '재상담').length, avg_seed: g.length ? Math.round(g.reduce((a, x) => a + (x.seed_amount || 0), 0) / g.length) : 0 };
    });
    res.json({ total, avgSeed, byStatus, byHousing, byCohort });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ── 수강생 일괄 등록 ── */
app.post('/api/students/bulk', (req, res) => {
  try {
    const db = readDB();
    const { students } = req.body;
    if (!Array.isArray(students) || students.length === 0)
      return res.status(400).json({ error: '등록할 수강생이 없습니다.' });
    const newStudents = students.map(s => ({
      id: db.nextId++,
      cohort: s.cohort || '',
      name: s.name || '',
      housing_type: s.housing_type || '무주택',
      seed_amount: parseInt(s.seed_amount) || 0,
      credit_amount: parseInt(s.credit_amount) || 0,
      loan_available: s.loan_available || 'unknown',
      transfer_available: s.transfer_available || 'unknown',
      note: s.note || '',
      consult_note: '',
      consult_date: '',
      status: '대기',
      flags: []
    }));
    db.students.push(...newStudents);
    writeDB(db);
    res.json({ ok: true, inserted: newStudents.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


app.post('/api/seed', (req, res) => {
  try {
    const db = readDB();
    if (db.students.length > 0) return res.json({ skipped: true, count: db.students.length });
    const { students } = req.body;
    if (!Array.isArray(students)) return res.status(400).json({ error: '잘못된 형식' });
    let nextId = 1;
    db.students = students.map(s => ({ ...s, id: nextId++ }));
    db.nextId = nextId;
    writeDB(db);
    res.json({ ok: true, inserted: students.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ 서버 실행 중: http://localhost:${PORT}`);
});
