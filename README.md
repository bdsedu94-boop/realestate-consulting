# 수강생 경매 투자 방향성 컨설팅 도구

수강생 투자 방향성을 자동 분석하고 팀원과 실시간 공유하는 컨설팅 도구입니다.

## 기능
- 수강생 추가/수정/삭제
- 주택 보유 유형별 투자 방향 자동 분석
- 상담 상태 관리 (대기/완료/재상담)
- 기수별 통계 및 분석 뷰
- 팀원 실시간 공유 (SQLite 서버)

## 기술 스택
- **Backend**: Node.js + Express + better-sqlite3
- **Frontend**: Vanilla HTML/CSS/JS (single-page)
- **DB**: SQLite

## 배포 (Replit)
1. Replit에서 Node.js 프로젝트 생성
2. 파일 업로드: `server.js`, `package.json` (루트), `public/index.html` (public 폴더)
3. Run 버튼 클릭
