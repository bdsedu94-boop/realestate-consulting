const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');

/*
 * 서버 시작점: 설정과 연결만 담당. 기능별 코드는 server/ 폴더
 *   server/auth.js            로그인·로그아웃, 로그인 확인
 *   server/db.js              db.json 읽기·쓰기
 *   server/students-api.js    수강생 API
 *   server/recommend-api.js   추천물건 리포트 API
 *   server/investment-api.js  평생회원 자료실용 투자 방향성 진단 API (키 인증)
 */
const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const SITE_PASSWORD = process.env.SITE_PASSWORD;
if (!SITE_PASSWORD) throw new Error('SITE_PASSWORD must be configured in the server environment');

const { readDB, writeDB } = require('./server/db')(DATA_DIR);
const { requireAuth, authRouter } = require('./server/auth');

app.use(cookieParser());
app.use('/api/investment', require('./server/investment-api')());
app.use(express.json({ limit: '10mb' }));
app.use(requireAuth);
app.use(express.static(path.join(__dirname, 'public')));
// 경매 정보지 PDF 읽기용 pdf.js (외부 CDN 대신 서버가 직접 제공)
app.use('/vendor/pdfjs', express.static(path.join(__dirname, 'node_modules', 'pdfjs-dist')));
app.use(authRouter(SITE_PASSWORD));

const recommendRouter = require('./server/recommend-api')({ readDB, writeDB, dataDir: DATA_DIR });
app.use('/api', recommendRouter);
app.use('/api', require('./server/students-api')({ readDB, writeDB, onDeleteStudent: recommendRouter.cleanupStudent }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ 서버 실행 중: http://localhost:${PORT}`);
});
