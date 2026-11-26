// 수강생 컨설팅 화면 — CSV 내보내기
// (일반 script: 함수·변수는 다른 app/*.js 와 전역으로 공유, index.html 에서 순서대로 불러옴)
/* ── CSV 내보내기 ── */
function exportCSV() {
  try {
    const headers = [
      '기수',
      '이름',
      '주택수',
      '투자금(만원)',
      '신용대출(만원)',
      '합산(만원)',
      '대출가능',
      '투자목적',
      '전입가능',
      '특이사항',
      '플래그',
      '이주임 확인완료',
      '방향성'
    ];
    const rows = students.map(d => {
      const c = consult(d);
      const cr = d.credit_amount || 0;
      return [
        d.cohort,
        d.name,
        d.housing_type,
        d.seed_amount,
        cr,
        d.seed_amount + cr,
        d.loan_available === 'Y' ? '가능' : d.loan_available === 'N' ? '불가' : '미확인',
        d.investment_purpose === '단타'
          ? '단타'
          : d.investment_purpose === '실거주'
            ? '실거주'
            : d.investment_purpose === '단타+실거주'
              ? '단타+실거주'
              : '미기재',
        d.transfer_available === 'Y' ? '가능' : d.transfer_available === 'N' ? '불가' : '미기재',
        d.note || '',
        (d.flags || []).join('/'),
        '', // 이주임 확인완료 (수동 입력)
        formatBidNarrativeCSV(d) // 방향성 = 입찰 가능 금액대
      ];
    });
    const csv = [headers, ...rows]
      .map(r =>
        r
          .map(v => {
            const s = String(v).replace(/"/g, '""');
            return '"' + s + '"';
          })
          .join(',')
      )
      .join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '수강생_컨설팅_' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('CSV 내보내기 실패: ' + e.message);
  }
}
