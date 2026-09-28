# 투자방향성 공통 기준

`public/investment-rules.js`가 **유일한 계산 기준**입니다. 상담 화면의 지역 판정,
CSV 방향성, PDF 계산/참고 문구, 평생회원 자료실 진단 API가 이 파일을 함께 사용합니다.
계산식·조건·금액·참고사항을 변경할 때 이 파일을 수정하고 이 서비스를 배포하세요.
자료실 코드에 계산식을 복사하거나 `public/index.html`에 함수를 다시 정의하지 마세요.
PDF 레이아웃과 화면 디자인은 `public/index.html`에서 관리합니다.

수강생 정보는 Railway 영구 볼륨의 데이터 파일에만 보관하고 로그인한 화면에서 API로 불러옵니다.
공개 HTML에는 개인별 초기 자료를 포함하지 않으며, 화면을 열 때 초기 자료를 다시 등록하지 않습니다.

## 자료실 자동 연결

- `SITE_PASSWORD`: 기존 상담 사이트 로그인 비밀번호. 코드의 기본값 대신 Railway 비밀 설정에 보관하며,
  미설정 시 서버가 시작되지 않습니다.

- `POST /api/investment/diagnose`: JSON 진단 조건을 받아 `schemaVersion: 1`,
  `ruleVersion`(기준 파일 SHA-256), `result`(cards/narrative/notes)를 반환합니다.
- 양쪽 Railway 서비스에 동일한 `INVESTMENT_SYNC_TOKEN`(32자 이상)을 설정합니다.
  자료실 서버가 `Authorization: Bearer <token>`으로 호출하며 브라우저에 키를 보내지 않습니다.
- 자료실에 `INVESTMENT_SOURCE_URL=https://realestate-consulting-production-5a24.up.railway.app`를 설정합니다.
- 진단할 때마다 최신 배포 기준으로 계산합니다. 결과 캐시와 예전 기준 대체 계산은 없습니다.
  상담 기준이 갱신되어도 기존 저장 결과는 그 당시 기록으로 유지됩니다.
- API는 수강생 DB를 읽거나 변경하지 않고 진단 조건만 처리합니다.
  API 키로 상담 사이트 로그인이나 수강생 관리 API에 접근할 수 없습니다.

연결 설정이나 API 응답 형식을 변경하면 자료실 연동도 함께 확인하세요.
계산 기준만 수정할 때는 자료실의 재배포가 필요하지 않습니다.

검증: `npm test`로 대표 조건의 결과, 공통 함수 연결, API 인증과 입력 검사를 확인합니다.
의도적으로 기준을 변경하면 해당 결과 테스트도 새 기준에 맞게 수정하세요.
