// 추천물건 리포트 — 리포트 PDF 만들기
// recommend/core.js 다음에 불러옴. 공통 기능은 RecCore에서 받음.
(function () {
  const R = window.RecCore;
  const {
    PURPLE,
    PURPLE_BG,
    DISCLAIMER,
    st,
    esc,
    escBr,
    num,
    man,
    pct,
    fmtDate,
    todayStr,
    deposit,
    recApi,
    reload,
    select,
    save,
    checkRec
  } = R;

  /* ── PDF 생성 ── */
  async function toDataUrl(url) {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('이미지를 불러오지 못했습니다: ' + url);
    const blob = await res.blob();
    return await new Promise((ok, no) => {
      const fr = new FileReader();
      fr.onload = () => ok(fr.result);
      fr.onerror = no;
      fr.readAsDataURL(blob);
    });
  }
  function imgSize(src) {
    return new Promise(ok => {
      const im = new Image();
      im.onload = () => ok({ w: im.naturalWidth || 1, h: im.naturalHeight || 1 });
      im.onerror = () => ok({ w: 1, h: 1 });
      im.src = src;
    });
  }
  let LOGO = null;
  async function logo() {
    if (!LOGO) {
      try {
        LOGO = await toDataUrl('/report-logo.png');
      } catch (e) {
        LOGO = '';
      }
    }
    return LOGO;
  }

  // 섹션 제목 (보라 막대 + 제목, extra: 오른쪽 배지). 모든 칸을 세로 가운데로 맞춤
  // right: 같은 줄 오른쪽 끝에 붙는 내용 (있으면 표를 전체 폭으로)
  function secTitle(t, mt = 22, extra = '', right = '') {
    return `<table style="border-collapse:collapse;margin:${mt}px 0 12px;${right ? 'width:100%' : ''}"><tr>
    <td style="width:4px;padding:0;vertical-align:middle"><div style="width:4px;height:16px;background:${PURPLE}"></div></td>
    <td style="padding:0 0 0 8px;vertical-align:middle;white-space:nowrap"><div style="font-size:14.5px;font-weight:700;color:${PURPLE};line-height:22px">${t}</div></td>
    ${extra ? `<td style="padding:0 0 0 10px;vertical-align:middle;white-space:nowrap">${extra}</td>` : ''}
    ${right ? `<td style="width:100%"></td><td style="padding:0;vertical-align:middle;white-space:nowrap;font-size:12.5px">${right}</td>` : ''}
  </tr></table>`;
  }
  // 물건 요약: 지역 + 종류(아파트/빌라 등)만. 금액·층·권리는 캡처와 검토 포인트에 있음
  const VILLA = /^(연립|다세대|빌라|도시형생활주택)/;
  function kindOf(r) {
    // 물건종류 칸이 비면(크롬 도우미 캡처 등) 자동으로 읽은 종류 → 한 줄 요약 끝 단어 순으로
    let k = (r.prop_type || '').trim();
    if (!k) {
      try {
        k = (JSON.parse(r.auto_facts || '{}').propType || '').trim();
      } catch (e) {}
    }
    if (!k)
      k =
        ((r.headline || '')
          .trim()
          .match(/(아파트|연립주택|다세대주택|다세대|빌라|오피스텔|단독주택|다가구주택|도시형생활주택|주상복합)$/) ||
          [])[1] || '';
    return VILLA.test(k) ? '빌라' : k;
  }
  function regionOf(r) {
    const h = (r.headline || '').trim(),
      k = (r.prop_type || '').trim();
    let reg = k && h.endsWith(k) ? h.slice(0, -k.length).trim() : '';
    if (!reg) {
      try {
        const a = (JSON.parse(r.auto_facts || '{}').address || '').split(/\s+/);
        reg = a.slice(0, 2).join(' ');
      } catch (e) {}
    }
    // 예전에 법원 이름('부산지방법원 2계')이 주소로 잘못 들어간 자료: 앞의 시·도 이름만 사용
    if (/(법원|지원)/.test(reg))
      reg = (reg.match(/^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)/) || [
        ''
      ])[0];
    return reg
      .replace(/(특별시|광역시|특별자치시|특별자치도)(?=\s|$)/, '')
      .replace(/^(경상남도|경상북도|전라남도|전라북도|충청남도|충청북도)/, m => m[0] + m[2])
      .replace(/^(경기|강원|제주)도/, '$1');
  }
  // '물건 #01' 줄 오른쪽 끝: 지역 · 물건 종류 (항목 이름 회색 + 값 진하게)
  function kindRight(r) {
    const reg = regionOf(r),
      kind = kindOf(r);
    const item = (l, v, last) =>
      v
        ? `<span style="color:#999">${l}</span> <b style="color:#222;${last ? '' : 'margin-right:12px'}">${esc(v)}</b>`
        : '';
    return item('지역', reg, !kind) + item('물건 종류', kind, true);
  }

  function stratRow(label, value, hl, first) {
    return `<tr><td style="padding:9px 16px 9px 0;font-size:12px;color:#777;white-space:nowrap;vertical-align:top;${first ? '' : 'border-top:1px solid #e9e9ec;'}">${esc(label)}</td>
    <td style="padding:9px 0;font-size:12.5px;font-weight:700;text-align:right;color:${hl ? PURPLE : '#222'};${first ? '' : 'border-top:1px solid #e9e9ec;'}">${esc(value || '-')}</td></tr>`;
  }

  async function renderRecPage(s, r, idx) {
    const ctx = InvestmentRules.getReportContext(s);
    const noHouse = s.housing_type === '무주택' || s.housing_type === '생애최초',
      oneHouse = s.housing_type === '1주택';
    const transferLabel =
      s.transfer_available === 'Y' ? '전입가능' : s.transfer_available === 'N' ? '전입불가' : '미확인';
    // 캡처에 이미 나오는 정보는 중복 입력하지 않아도 되므로, 6칸이 모두 비어 있으면 숨김
    const pill = `<span style="display:block;background:${PURPLE};color:#fff;font-size:11.5px;font-weight:700;border-radius:11px;padding:3px 11px;line-height:16px">물건 #${String(idx + 1).padStart(2, '0')}</span>`;
    const bidTxt = num(r.bid_low)
      ? `${man(r.bid_low)}${num(r.bid_high) && num(r.bid_high) !== num(r.bid_low) ? ' ~ ' + man(r.bid_high, '원') : '원'}${num(r.appraisal) ? ` (감정가 ${pct(r.bid_low, r.appraisal)}${num(r.bid_high) && num(r.bid_high) !== num(r.bid_low) ? '~' + pct(r.bid_high, r.appraisal) : ''}%)` : ''}`
      : '';
    const B = v => `<b style="color:#222">${v}</b>`;
    const caseLine = [
      r.case_no && `사건번호 ${B(esc(r.case_no))}`,
      r.court && esc(r.court),
      r.sale_date && `매각기일 ${B(fmtDate(r.sale_date))}`,
      deposit(r) && `입찰보증금 ${B(man(deposit(r), '원'))}`
    ]
      .filter(Boolean)
      .join('<span style="color:#ccc"> &nbsp;|&nbsp; </span>');

    // 캡처 이미지: 가로로 긴 캡처(표·상세정보)는 전체 폭, 세로형은 2장씩 나란히
    const imgs = [];
    for (const im of r.images || []) {
      try {
        const src = await toDataUrl('/api/rec-images/' + im.file);
        const sz = await imgSize(src);
        imgs.push({ src, caption: im.caption, wide: sz.w / sz.h >= 1.25 });
      } catch (e) {
        console.error(e);
      }
    }
    let imgHtml = '';
    if (imgs.length) {
      const rows = [];
      for (let i = 0; i < imgs.length;) {
        if (imgs[i].wide || !imgs[i + 1] || imgs[i + 1].wide) {
          rows.push([imgs[i]]);
          i++;
        } else {
          rows.push([imgs[i], imgs[i + 1]]);
          i += 2;
        }
      }
      imgHtml =
        rows
          .map(
            row =>
              `<table style="width:100%;border-collapse:collapse;margin-bottom:8px"><tr>${row
                .map(
                  im => `
      <td style="width:${row.length === 1 ? 100 : 50}%;vertical-align:top;padding:0 ${row.length === 1 ? 0 : 4}px">
        <div style="border:1px solid #e3e3e6;border-radius:6px;overflow:hidden;background:#fff">
          <img src="${im.src}" style="width:100%;display:block">
        </div></td>`
                )
                .join('')}</tr></table>`
          )
          .join('') +
        (r.image_note ? `<div style="font-size:10px;color:#999;margin-top:2px">${esc(r.image_note)}</div>` : '');
    }

    const reasons = (r.reasons || []).filter(x => (x.title || '').trim() || (x.body || '').trim());
    const reasonsHtml = reasons
      .map(
        (x, i) => `<table style="width:100%;border-collapse:collapse;margin-bottom:12px"><tr>
      <td style="width:30px;vertical-align:top;padding:0">
        <table style="width:22px;height:22px;border-collapse:collapse"><tr><td style="width:22px;height:22px;border-radius:50%;background:${PURPLE};color:#fff;font-size:12px;font-weight:700;text-align:center;vertical-align:middle;line-height:1;padding:0">${i + 1}</td></tr></table>
      </td>
      <td style="vertical-align:top;padding:0">
        <div style="font-size:13px;font-weight:700;line-height:22px;color:#222">${esc(x.title)}</div>
        ${x.body ? `<div style="font-size:12px;line-height:1.65;color:#555;margin-top:2px">${escBr(x.body)}</div>` : ''}
      </td></tr></table>`
      )
      .join('');

    const hasStrat = bidTxt || r.win_rate || r.rent || r.strategy_note;
    const stratHtml = hasStrat
      ? `<div style="background:#f6f6f8;border-left:4px solid #333;border-radius:4px;padding:14px 18px;margin-top:8px">
      <div style="font-size:13px;font-weight:700;color:#222;margin-bottom:6px">※ 입찰 전략</div>
      <table style="width:100%;border-collapse:collapse">
        ${[
          bidTxt && ['권장 입찰가', bidTxt, true],
          r.win_rate && ['인근 낙찰가율', r.win_rate],
          r.rent && ['임대 세팅 예상', r.rent]
        ]
          .filter(Boolean)
          .map((x, i) => stratRow(x[0], x[1], x[2], i === 0))
          .join('')}
      </table>
      ${r.strategy_note ? `<div style="font-size:11.5px;line-height:1.75;color:#444;margin-top:10px;padding-top:10px;border-top:1px solid #e3e3e6">${escBr(r.strategy_note)}</div>` : ''}
    </div>`
      : '';

    const lg = await logo();
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-9999px;top:0;width:600px;background:#fff;font-family:var(--font);';
    container.innerHTML = `
  <div style="width:600px;box-sizing:border-box;background:#fff;border:1px solid #e3e3e3;border-radius:6px;overflow:hidden">
    <div style="background:${PURPLE};padding:20px 28px">
      <table style="width:100%;border-collapse:collapse"><tr>
        <td style="vertical-align:middle;padding:0"><div style="font-size:19px;font-weight:700;color:#fff">경매 물건 리포트</div></td>
        <td style="vertical-align:middle;padding:0;text-align:right">${lg ? `<img src="${lg}" style="height:28px;width:104px;display:inline-block">` : ''}</td>
      </tr></table>
    </div>
    <div style="padding:16px 28px 0">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <tr><td style="width:70px;padding:7px 0;color:#888">기수</td><td style="padding:7px 0;font-weight:600;color:#222">${esc(s.cohort)}</td>
            <td style="width:70px;padding:7px 0;color:#888">이름</td><td style="padding:7px 0;font-weight:600;color:#222">${esc(s.name)}님</td></tr>
        <tr><td style="padding:7px 0;color:#888;border-top:1px solid #f0f0f0">투자금</td><td style="padding:7px 0;font-weight:600;color:#222;border-top:1px solid #f0f0f0">${esc(ctx.seedLine.replace('시드 : ', ''))}</td>
            <td style="padding:7px 0;color:#888;border-top:1px solid #f0f0f0">주택유형</td><td style="padding:7px 0;font-weight:600;color:#222;border-top:1px solid #f0f0f0">${esc(s.housing_type)}${noHouse || oneHouse ? ` (${transferLabel})` : ''}</td></tr>
      </table>
    </div>
    <div style="padding:0 28px 22px">
      ${
        imgs.length
          ? ''
          : `${secTitle('물건 개요', 18)}
      <table style="border-collapse:collapse;margin-bottom:8px"><tr>
        <td style="padding:0;white-space:nowrap">${pill}</td>
        <td style="padding:0 0 0 10px;font-size:13px;color:#333">${esc(r.headline)}</td>
      </tr></table>`
      }
      ${caseLine && !imgs.length ? `<div style="font-size:11.5px;color:#777;margin:0 0 10px 2px">${caseLine}</div>` : ''}
      ${imgHtml ? secTitle('탱크옥션 물건 정보', 18, pill, kindRight(r)) + imgHtml : ''}
      ${reasonsHtml ? secTitle('검토 포인트') + reasonsHtml : ''}
      ${stratHtml}
    </div>
    <table style="width:100%;border-collapse:collapse;background:#fafafa;border-top:1px solid #eee"><tr>
      <td style="padding:14px 28px;font-size:10.5px;color:#999;line-height:1.6">${DISCLAIMER}</td>
    </tr></table>
  </div>`;
    document.body.appendChild(container);
    try {
      await Promise.all(
        [...container.querySelectorAll('img')].map(im =>
          im.complete
            ? null
            : new Promise(ok => {
                im.onload = im.onerror = ok;
              })
        )
      );
      if (document.fonts && document.fonts.ready) await document.fonts.ready; // 웹폰트 적용 후 그림
      return await html2canvas(container, { scale: 2, backgroundColor: '#ffffff' });
    } finally {
      document.body.removeChild(container);
    }
  }

  async function dateImage() {
    const el = document.createElement('div');
    el.style.cssText =
      'position:fixed;left:-9999px;top:0;font-family:var(--font);font-size:11px;color:#999;white-space:nowrap;background:#fff;padding:2px';
    el.textContent = `작성일 ${todayStr()}`;
    document.body.appendChild(el);
    try {
      return await html2canvas(el, { scale: 2, backgroundColor: '#ffffff' });
    } finally {
      document.body.removeChild(el);
    }
  }

  /** 수강생 1명의 추천물건(들)을 PDF 1개로 생성 — 물건 1건당 1페이지 */
  async function buildRecPDF(s, recs) {
    const { jsPDF } = window.jspdf;
    const A4_W = 595.28,
      A4_H = 841.89;
    const dc = await dateImage();
    const dW = dc.width / 2,
      dH = dc.height / 2;
    const dImg = dc.toDataURL('image/png');
    let pdf = null;
    for (let i = 0; i < recs.length; i++) {
      const idx = st.recs.findIndex(x => x.id === recs[i].id);
      const canvas = await renderRecPage(s, recs[i], idx >= 0 ? idx : i);
      const imgW = A4_W - 60,
        imgH = (canvas.height * imgW) / canvas.width;
      const pageH = Math.max(A4_H, imgH + 60 + 30); // 내용이 길면 페이지를 늘림 (압축하지 않음)
      if (!pdf) pdf = new jsPDF({ unit: 'pt', format: [A4_W, pageH] });
      else pdf.addPage([A4_W, pageH]);
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 30, 30, imgW, imgH);
      pdf.addImage(dImg, 'PNG', A4_W - 30 - dW, pageH - 25 - dH, dW, dH);
    }
    const fname =
      recs.length === 1
        ? `${s.cohort}_${s.name}_경매물건_${(recs[0].case_no || '미정').replace(/[\\/:*?"<>|]/g, '')}.pdf`
        : `${s.cohort}_${s.name}_경매물건리포트.pdf`;
    return { pdf, filename: fname };
  }

  async function pdf(ids) {
    try {
      if (st.dirty) await save(true);
      const recs = ids ? st.recs.filter(r => ids.includes(r.id)) : st.recs;
      if (!recs.length) {
        alert('추천물건이 없습니다.');
        return;
      }
      const issues = recs.flatMap(r => checkRec(r).map(x => `[${r.case_no || '사건번호 없음'}] ${x}`));
      const notReviewed = recs.filter(r => r.status === '작성중');
      if (issues.length || notReviewed.length) {
        const msg = [...issues, ...(notReviewed.length ? [`검수완료 전 상태인 물건 ${notReviewed.length}건`] : [])]
          .slice(0, 12)
          .join('\n');
        if (!confirm(`아래 항목을 확인하세요. 그래도 PDF를 만들까요?\n\n${msg}`)) return;
      }
      document.body.style.cursor = 'progress';
      const { pdf: doc, filename } = await buildRecPDF(st.student, recs);
      doc.save(filename);
      const sendable = recs.filter(r => r.status === '검수완료');
      if (sendable.length && confirm(`카톡으로 발송하셨다면 ${sendable.length}건을 [발송완료]로 표시할까요?`)) {
        for (const r of sendable) await recApi(`/api/recommendations/${r.id}`, 'PUT', { status: '발송완료' });
        await reload(st.cur && st.cur.id);
        if (st.cur) select(st.cur.id);
      }
    } catch (e) {
      alert('PDF 생성 오류: ' + e.message);
      console.error(e);
    } finally {
      document.body.style.cursor = '';
    }
  }

  Object.assign(window.RecReport, { pdf, buildRecPDF });
})();
