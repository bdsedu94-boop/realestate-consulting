// 수강생 컨설팅 화면 — 분석 뷰
// (일반 script: 함수·변수는 다른 app/*.js 와 전역으로 공유, index.html 에서 순서대로 불러옴)
/* ── 분석 뷰 ── */
async function renderAnalytics() {
  try {
    const stats = await api('/api/stats');
    const { total, avgSeed, avgTotal, byHousing, byCohort } = stats;
    const kpi = (v, label, color) =>
      `<div class="an-kpi"><div class="kv"${color ? ` style="color:${color}"` : ''}>${v}</div><div class="kl">${label}</div></div>`;
    document.getElementById('anKpi').innerHTML =
      kpi(total + '명', '전체 수강생') + kpi(fmt(avgSeed), '평균 시드') + kpi(fmt(avgTotal), '평균 합산 (시드+신용)');
    document.getElementById('cohortTable').innerHTML =
      '<thead><tr><th>기수</th><th>총원</th><th>무주택·생애최초</th><th>1주택</th><th>다주택</th><th>평균시드</th></tr></thead><tbody>' +
      byCohort
        .map(
          c =>
            `<tr><td><strong>${c.cohort}</strong></td><td>${c.total}명</td>` +
            `<td style="color:#27500a;font-weight:600">${c.noHouse}명</td><td style="color:#633806;font-weight:600">${c.oneHouse}명</td>` +
            `<td style="color:#791f1f;font-weight:600">${c.multi}명</td>` +
            `<td>${fmt(Math.round(c.avg_seed))}</td></tr>`
        )
        .join('') +
      '</tbody>';
    const mkBars = (data, tot) =>
      data
        .map(([lb, bg, tx, cnt]) => {
          const pct = tot ? Math.round((cnt / tot) * 100) : 0;
          return (
            `<div class="bar-row"><div class="br-label">${lb}</div>` +
            `<div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${bg}"><span style="color:${tx}">${cnt}</span></div></div>` +
            `<div class="br-count" style="color:${tx}">${cnt}명</div></div>`
          );
        })
        .join('');
    const hMap = {
      생애최초: '#e6f1fb|#0c447c',
      무주택: '#eaf3de|#27500a',
      '1주택': '#faeeda|#633806',
      다주택: '#fcebeb|#791f1f'
    };
    document.getElementById('anHousing').innerHTML = mkBars(
      byHousing.map(h => {
        const [bg, tx] = (hMap[h.housing_type] || '#f0ede6|#5f5e5a').split('|');
        return [h.housing_type, bg, tx, h.n];
      }),
      total
    );
    const all = await api('/api/students');
    const s1 = all.filter(s => s.seed_amount < 3000).length,
      s2 = all.filter(s => s.seed_amount >= 3000 && s.seed_amount < 5000).length,
      s3 = all.filter(s => s.seed_amount >= 5000 && s.seed_amount < 10000).length,
      s4 = all.filter(s => s.seed_amount >= 10000).length;
    document.getElementById('anSeed').innerHTML = mkBars(
      [
        ['3천 미만 (소액)', '#fcebeb', '#791f1f', s1],
        ['3천~5천', '#faeeda', '#633806', s2],
        ['5천~1억', '#eaf3de', '#27500a', s3],
        ['1억 이상', '#e6f1fb', '#0c447c', s4]
      ],
      total
    );
    const dirs = all.map(s => consult(s).dirLabel);
    const uDirs = [...new Set(dirs)];
    const dC = {
      '서울·수도권 규제': '#e6f1fb|#0c447c',
      '수도권 비규제': '#eaf3de|#27500a',
      '수도권 비규제/지방': '#faeeda|#633806',
      지방: '#f0ede6|#5f5e5a'
    };
    document.getElementById('anDir').innerHTML = mkBars(
      uDirs.map(d => {
        const [bg, tx] = (dC[d] || '#f0ede6|#5f5e5a').split('|');
        return [d, bg, tx, dirs.filter(x => x === d).length];
      }),
      total
    );
  } catch (e) {
    console.error('분석 오류:', e);
  }
}
