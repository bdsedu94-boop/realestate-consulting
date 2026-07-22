const express = require('express');
const fs = require('fs');
const path = require('path');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = process.env.PORT || 3000;
// Railway에 Volume을 붙이면 RAILWAY_VOLUME_MOUNT_PATH가 자동 설정됨 → 그 경로에 저장(재배포해도 유지)
// Volume이 없는 로컬 개발 환경에서는 기존처럼 프로젝트 폴더에 저장
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const DB_FILE = path.join(DATA_DIR, 'db.json');

/* ── 비밀번호 설정 (Railway 환경변수 SITE_PASSWORD로 변경 가능) ── */
const SITE_PASSWORD = process.env.SITE_PASSWORD || '1500cjdeka@@';
const AUTH_TOKEN = 'consulting_auth_ok';

/* ── 로그인 페이지 HTML ── */
const loginHTML = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>로그인 · 수강생 컨설팅</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Pretendard','Apple SD Gothic Neo',sans-serif;background:#f5f3ee;display:flex;align-items:center;justify-content:center;min-height:100vh;}
  .box{background:#fff;border-radius:16px;padding:48px 40px;width:360px;box-shadow:0 4px 24px rgba(0,0,0,.08);text-align:center;}
  h1{font-size:20px;font-weight:700;color:#2d2d2d;margin-bottom:8px;}
  p{font-size:13px;color:#888;margin-bottom:32px;}
  input{width:100%;padding:12px 16px;border:1.5px solid #e0e0e0;border-radius:10px;font-size:15px;outline:none;transition:.2s;}
  input:focus{border-color:#4a7c59;}
  button{width:100%;padding:13px;background:#4a7c59;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer;margin-top:12px;transition:.2s;}
  button:hover{background:#3a6047;}
  .err{color:#e53935;font-size:13px;margin-top:10px;display:none;}
</style>
</head>
<body>
<div class="box">
  <h1>🏠 수강생 컨설팅</h1>
  <p>비밀번호를 입력해 주세요</p>
  <input type="password" id="pw" placeholder="비밀번호" onkeydown="if(event.key==='Enter')login()">
  <button onclick="login()">입장하기</button>
  <div class="err" id="err">비밀번호가 틀렸습니다.</div>
</div>
<script>
async function login(){
  const pw=document.getElementById('pw').value;
  const res=await fetch('/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pw})});
  if(res.ok){location.href='/';}
  else{document.getElementById('err').style.display='block';}
}
</script>
</body>
</html>`;

/* ── 인증 미들웨어 ── */
function requireAuth(req, res, next) {
  if (req.path === '/login' || req.path === '/logout') return next();
  if (req.cookies?.[AUTH_TOKEN] === '1') return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: '로그인 필요' });
  res.send(loginHTML);
}

app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(requireAuth);
app.use(express.static(path.join(__dirname, 'public')));

/* ── 로그인 ── */
app.post('/login', (req, res) => {
  if (req.body.password === SITE_PASSWORD) {
    res.cookie(AUTH_TOKEN, '1', { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: '비밀번호 오류' });
  }
});

/* ── 로그아웃 ── */
app.get('/logout', (req, res) => {
  res.clearCookie(AUTH_TOKEN);
  res.redirect('/');
});

function readDB() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(DB_FILE)) {
      return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    }
  } catch(e) { console.error('DB 읽기 오류:', e); }
  return { students: [], nextId: 1 };
}

function writeDB(data) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch(e) { console.error('DB 쓰기 오류:', e); }
}

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
      investment_purpose: s.investment_purpose || 'unknown',
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
