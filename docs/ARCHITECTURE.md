# 코드 구조와 업무 흐름

수강생 경매 투자 방향성 컨설팅 사이트의 **어디에 무슨 코드가 있는지**와 **업무가 어떤 순서로 흐르는지**를 그림으로 정리한 문서입니다.
GitHub에서 이 파일을 열면 아래 그림(Mermaid)이 바로 그려집니다. 기능을 고치면 이 문서의 그림도 같이 고칩니다.

---

## 1. 폴더 구조 (코드 위치)

```
server.js                    서버 시작점 (설정과 연결만)
server/
  auth.js                    로그인·로그아웃, 로그인 확인
  login-page.html            로그인 화면
  db.js                      db.json 읽기·쓰기 (Railway Volume)
  students-api.js            수강생 API: 목록·추가·수정·삭제·통계·엑셀 일괄 등록
  recommend-api.js           추천물건 리포트 API: 물건·이미지 저장, 시트 초안
  investment-api.js          평생회원 자료실용 방향성 진단 API (키 인증)

public/
  index.html                 화면 틀 (HTML만)
  css/app.css                화면 디자인
  js/investment-rules.js     ★ 투자 방향성 계산 기준 (화면·CSV·PDF·자료실 공통, 유일한 기준)
  js/app/                    메인 화면 (수강생 카드)
    core.js                    공통 상태·서버 호출·목록 불러오기
    students.js                수강생 추가·수정·삭제, 엑셀 일괄 등록
    cards.js                   카드 뷰 (요약칸·수강생 카드)
    analytics.js               분석 뷰
    direction-pdf.js           [📄 방향성 리포트] PDF, 전체 PDF(ZIP)
    export-csv.js              CSV 내보내기
    main.js                    화면 전환·자동 새로고침·시작
  js/recommend/              [🏠 추천물건 리포트]
    core.js                    입력 창·저장·목록 (다른 파일과 RecCore로 연결)
    auto.js                    검토 포인트·권장 입찰가 자동 작성, 발송 전 확인
    pdf.js                     물건 리포트 PDF
    mask.js                    캡처 이미지 자르기·모자이크
    capture.js                 크롬 캡처 도우미 연동 (탱크옥션 자동 캡처)
    sheet.js                   구글시트 요약 탭 → 추천물건 초안
  js/infosheet/              경매 정보지 PDF
    parse.js                   정보지 글자 → 사건번호·금액·권리 등 값 (테스트와 공용)
    import.js                  PDF 읽기(pdf.js)·캡처·칸 채우기

test/                        자동 테스트 (npm test)
tank-capture-extension/      크롬 확장프로그램 '추천물건 캡처 도우미'
```

## 2. 코드 연결 그림 (시각화)

위에서 아래로: **화면 버튼 → 화면 코드 → 서버 API → 저장소**. 노란 상자 `investment-rules.js`는 방향성 계산 기준으로, 화면과 서버가 같은 파일을 씁니다.

```mermaid
flowchart TB
  subgraph L1[① 화면 버튼]
    direction LR
    b1[수강생 추가·수정<br/>엑셀 업로드]
    b2[카드 뷰·분석 뷰]
    b3[📄 방향성 리포트<br/>전체 PDF·CSV]
    b4[🏠 추천물건 리포트]
    b5[경매 정보지 PDF]
    b6[추천물건 시트]
  end
  subgraph L2[② 화면 코드 public/js]
    direction LR
    a1[app/students.js]
    a2[app/cards.js<br/>app/analytics.js]
    a3[app/direction-pdf.js<br/>app/export-csv.js]
    a4[recommend/core·auto·pdf·mask·capture.js]
    a5[infosheet/import.js<br/>infosheet/parse.js]
    a6[recommend/sheet.js]
  end
  RULES[investment-rules.js<br/>★ 방향성 계산 기준]:::r
  subgraph L3[③ 서버 API server/]
    direction LR
    s1[students-api.js<br/>/api/students·stats]
    s2[recommend-api.js<br/>/api/recommendations]
    s3[investment-api.js<br/>자료실 진단]
  end
  subgraph L4[④ 저장소]
    direction LR
    d1[(db.json<br/>수강생·추천물건)]
    d2[(rec-images/<br/>캡처 이미지)]
  end
  b1-->a1; b2-->a2; b3-->a3; b4-->a4; b5-->a5; b6-->a6
  a2 & a3 & a4 -.계산.-> RULES
  s3 -.계산.-> RULES
  a1 & a2 --> s1
  a4 & a5 & a6 --> s2
  s1 --> d1
  s2 --> d1
  s2 --> d2
  classDef r fill:#fff3cd,stroke:#a3690a
```

- 모든 `/api` 요청은 `server/auth.js`의 로그인 확인을 먼저 거칩니다(자료실 진단 API만 별도 키).
- 크롬 확장프로그램 '추천물건 캡처 도우미'는 `recommend/capture.js`와 메시지로 주고받습니다.

## 3. 업무 흐름 (프로세스)

### 3-1. 수강생 1명 컨설팅 전체 흐름

```mermaid
flowchart TD
  A[설문 응답<br/>구글시트] -->|엑셀 업로드 / 수강생 추가| B[수강생 카드 생성]
  B --> C{investment-rules.js<br/>방향성 계산}
  C --> D[카드: 지역별 가능/조건부/불가<br/>입찰 가능 금액대]
  D --> E[📄 방향성 리포트 PDF]
  E -->|1차 발송| S1((수강생))
  D --> F[🏠 추천물건 리포트]
  F --> G[경매 정보지 PDF 업로드<br/>개인정보 가린 파일]
  G --> H[자동 작성: 사건 정보·캡처·<br/>검토 포인트·권장 입찰가]
  H --> I[담당자 검토·수정 → 저장]
  I --> J{발송 전 확인<br/>권리·필수 항목}
  J -->|이상 없음| K[물건 리포트 PDF]
  K -->|2차 발송| S1
```

### 3-2. 경매 정보지 PDF → 물건 리포트 자동 작성

```mermaid
sequenceDiagram
  actor 담당자
  participant 화면 as infosheet/import.js
  participant pdfjs as pdf.js (/vendor/pdfjs)
  participant 해석 as infosheet/parse.js
  participant 자동 as recommend/auto.js
  participant 서버 as recommend-api
  담당자->>화면: 📄 경매 정보지 PDF로 추가 (여러 개 가능)
  화면->>pdfjs: 글자 위치 읽기
  pdfjs-->>화면: 글자·좌표
  화면->>해석: 줄 묶기 → 값 찾기
  해석-->>화면: 사건번호·법원·매각일·감정가·최저가·<br/>유찰·낙찰가율·권리 사실, 캡처 영역
  화면->>서버: 같은 사건번호 있으면 그 물건, 없으면 새로 만들기
  화면->>화면: 경매정보 영역 그리기 → 여백 자르기
  화면->>서버: 캡처 이미지 저장 (자동 이미지 교체)
  화면->>자동: 권장 입찰가·검토 포인트 3개
  화면->>서버: 빈 칸만 채워 저장 (직접 고친 값은 유지)
```

### 3-3. 로그인과 요청 처리

```mermaid
flowchart LR
  U[브라우저 요청] --> K{쿠키 있음?}
  K -->|예| R[화면 파일 / API]
  K -->|아니오, 화면| L[로그인 페이지]
  K -->|아니오, /api| X[401 로그인 필요]
  L -->|SITE_PASSWORD 일치| C[7일 쿠키 발급] --> R
  Z[자료실 /api/investment] -->|별도 키 인증| IR[방향성 진단]
```

## 4. 개발·배포 흐름 (브랜치)

```mermaid
flowchart LR
  T[요청] --> B[작업 브랜치 만들기<br/>claude/기능이름]
  B --> D[개발 + 그림 갱신]
  D --> V[점검: npm test ·<br/>브라우저 전체 기능 확인]
  V --> P[브랜치에 푸시]
  P --> Q{사용자 확인<br/>'배포해줘'}
  Q -->|확인| M[master에 합치기]
  M --> R[Railway 자동 배포<br/>빌드 결과 확인]
  Q -->|수정 요청| D
```

- 기능 하나 = 브랜치 하나 (예: `claude/split-by-feature`, `claude/docs-diagrams`)
- master에는 사용자가 확인한 뒤에만 합칩니다. master에 합치면 Railway가 자동으로 배포합니다.
- 코드 줄 정리: `npm run format` (Prettier, 한 줄 120자 기준, 설정 `.prettierrc.json`)
