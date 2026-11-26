// 경매 정보지 PDF → 물건 자동 작성 (사건 정보·경매정보 캡처·검토 포인트·권장 입찰가)
// 화면 버튼: 추천물건 관리의 [📄 경매 정보지 PDF로 추가]. 해석은 infosheet/parse.js, 저장·계산은 recommend/core.js(RecCore).
// 개인정보는 정보지를 올리기 전에 가린 상태여야 합니다 (이 파일은 이름을 가리지 않음).
(function () {
  'use strict';
  const PDF_BASE = '/vendor/pdfjs/';
  let PDFJS = null;

  async function loadPdfJs() {
    if (PDFJS) return PDFJS;
    await new Promise((ok, no) => {
      const sc = document.createElement('script');
      sc.src = PDF_BASE + 'build/pdf.min.js';
      sc.onload = ok;
      sc.onerror = () => no(new Error('PDF 읽기 도구를 불러오지 못했습니다. 새로고침 후 다시 시도해주세요.'));
      document.head.appendChild(sc);
    });
    PDFJS = window.pdfjsLib;
    PDFJS.GlobalWorkerOptions.workerSrc = PDF_BASE + 'build/pdf.worker.min.js';
    return PDFJS;
  }

  function pick() {
    if (!RecCore.st.student) return;
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.pdf,application/pdf';
    inp.multiple = true;
    inp.onchange = () => {
      if (inp.files.length) addFiles([...inp.files]);
    };
    inp.click();
  }

  async function addFiles(files) {
    const C = RecCore;
    if (C.st.dirty) await C.save(true);
    const say = m => {
      const e = document.getElementById('recBulkStatus');
      if (e) {
        e.textContent = m;
        e.classList.remove('err');
      }
    };
    const done = [],
      fails = [];
    let lastId = null;
    for (let i = 0; i < files.length; i++) {
      const pre = files.length > 1 ? `(${i + 1}/${files.length}) ` : '';
      try {
        const r = await addOne(files[i], m => say(pre + files[i].name + ' · ' + m));
        done.push(r.case_no);
        lastId = r.id;
      } catch (e) {
        console.error(e);
        fails.push(`${files[i].name}: ${e.message}`);
      }
    }
    await C.reload(lastId || (C.st.cur && C.st.cur.id));
    if (lastId) C.select(lastId);
    say(done.length ? `✓ ${done.length}건 작성 완료 (${done.join(', ')}) · 검토 후 PDF를 받으세요` : '');
    if (fails.length) alert(`정보지 ${fails.length}건을 읽지 못했습니다.\n\n${fails.join('\n')}`);
  }

  // PDF → 글자 위치(items) + 쪽별 그리기 정보
  async function readPdf(file) {
    const lib = await loadPdfJs();
    const doc = await lib.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      cMapUrl: PDF_BASE + 'cmaps/',
      cMapPacked: true,
      standardFontDataUrl: PDF_BASE + 'standard_fonts/'
    }).promise;
    const items = [],
      views = {};
    for (let p = 1; p <= doc.numPages; p++) {
      const pg = await doc.getPage(p),
        vp = pg.getViewport({ scale: 1 });
      views[p] = { pg, h: vp.height, w: vp.width };
      for (const it of (await pg.getTextContent()).items) {
        if (!it.str || !it.str.trim()) continue;
        const h = it.height || Math.abs(it.transform[0]);
        items.push({ p, x: it.transform[4], y: vp.height - it.transform[5], w: it.width, h, s: it.str });
      }
    }
    if (!items.length)
      throw new Error(
        '글자를 읽을 수 없는 PDF입니다. (스캔 이미지가 아닌, 탱크옥션 화면을 PDF로 저장한 파일이어야 합니다)'
      );
    return { items, views };
  }

  async function addOne(file, status) {
    const C = RecCore;
    status('PDF 읽는 중...');
    const { items, views } = await readPdf(file);
    const lines = InfoSheet.toLines(items);
    const f = InfoSheet.parse(lines);
    // 같은 수강생에게 같은 사건번호가 있으면 그 물건을 채우고, 없으면 새로 만듦.
    // 사건번호는 법원마다 따로라서(예: 부산·천안 2026타경10267) 법원까지 같은 물건을 먼저 찾음
    const same = C.st.recs.filter(r => (r.case_no || '').replace(/\s/g, '') === f.case_no);
    let rec = same.find(r => sameCourt(r.court, f.court)) || same.find(r => !r.court) || same[0];
    let replaceAll = false;
    if (rec && rec.court && f.court && !sameCourt(rec.court, f.court)) {
      replaceAll = confirm(
        `이미 ${rec.court} ${f.case_no} 물건이 있습니다.\n올린 정보지는 ${f.court} 물건입니다 (사건번호가 같은 다른 물건).\n\n` +
          `[확인] 기존 물건을 이 정보지 내용으로 모두 바꾸기 (법원·금액·캡처·검토 포인트·입찰가)\n[취소] 바꾸지 않고 별도 물건으로 추가`
      );
      if (!replaceAll) rec = null;
    }
    if (!rec) {
      status('물건 만드는 중...');
      rec = await C.recApi(`/api/students/${C.st.student.id}/recommendations`, 'POST', { case_no: f.case_no });
    }
    await putCapture(rec, lines, views, status);
    status('칸 채우는 중...');
    const base = replaceAll ? clearedProperty(rec) : rec;
    await C.recApi(`/api/recommendations/${rec.id}`, 'PUT', {
      ...(replaceAll ? diffCleared(rec) : {}),
      ...fillPatch(base, f)
    });
    return { id: rec.id, case_no: f.case_no };
  }

  // 경매정보 영역 캡처 1장으로 자동 이미지 교체 (직접 올린 이미지는 유지)
  async function putCapture(rec, lines, views, status) {
    const C = RecCore;
    const area = InfoSheet.captureArea(lines, views[1].h);
    if (!area) return;
    status('캡처 만드는 중...');
    const dataUrl = await renderArea(views[area.p], area);
    const manual = (rec.images || []).filter(i => i.source !== 'auto').length;
    if (manual + 1 > 6) throw new Error(`이미지는 최대 6장입니다. 직접 올린 이미지(${manual}장)를 줄여주세요.`);
    for (const im of (rec.images || []).filter(i => i.source === 'auto'))
      await C.recApi(`/api/recommendations/${rec.id}/images/${encodeURIComponent(im.file)}`, 'DELETE');
    await C.recApi(`/api/recommendations/${rec.id}/images`, 'POST', {
      dataUrl: await C.shrink(dataUrl),
      caption: '탱크옥션 · 경매정보',
      source: 'auto'
    });
  }

  // 바꿀 칸: 정보지 값은 비어 있는 칸만 채움 (직접 고친 값은 유지).
  // 보증금 비율(기본값 10%가 있음)·권리 사실·자동 낙찰가율은 최신 정보지로 갱신.
  const sameCourt = (a, b) => (a || '').replace(/\s/g, '') === (b || '').replace(/\s/g, '');
  // 다른 물건으로 바꿀 때 비울 칸 (물건 정보·자동 작성 내용). 담당자·임대 예상·전략 메모·상태는 유지
  const PROP_TEXT = [
    'court',
    'sale_date',
    'headline',
    'prop_type',
    'area',
    'floor_main',
    'floor_sub',
    'occupancy',
    'occupancy_sub',
    'rights',
    'rights_sub',
    'win_rate',
    'win_rate_auto',
    'auto_facts',
    'bid_auto',
    'image_note'
  ];
  const PROP_NUM = ['appraisal', 'min_price', 'fail_count', 'bid_low', 'bid_high', 'deposit_rate'];
  function diffCleared() {
    const out = { reasons: [] };
    for (const k of PROP_TEXT) out[k] = '';
    for (const k of PROP_NUM) out[k] = null;
    return out;
  }
  function clearedProperty(rec) {
    return { ...rec, ...diffCleared() };
  }
  function fillPatch(rec, f) {
    const C = RecCore,
      patch = {};
    const empty = v => v === null || v === undefined || v === '';
    for (const [k, v] of Object.entries(f)) {
      if (empty(v)) continue;
      // 한 줄 요약에 법원 이름이 잘못 들어간 예전 자료는 새 값으로 고침
      const badHeadline = k === 'headline' && /(법원|지원)/.test(rec.headline || '');
      if (k === 'auto_facts' || k === 'deposit_rate' || badHeadline || empty(rec[k])) patch[k] = v;
    }
    if (f.win_rate && (!rec.win_rate || rec.win_rate === rec.win_rate_auto)) {
      patch.win_rate = f.win_rate;
      patch.win_rate_auto = f.win_rate;
    }
    if (!rec.image_note) patch.image_note = `※ 출처: 탱크옥션 경매 정보지 (${C.todayStr()}) · 개인정보는 가림 처리`;
    const merged = { ...rec, ...patch };
    const b = C.calcBid(merged);
    const lo = C.num(rec.bid_low),
      hi = C.num(rec.bid_high);
    const untouched = (!lo && !hi) || (rec.bid_auto && rec.bid_auto === `${lo}-${hi}`);
    if (b && untouched)
      Object.assign(patch, { bid_low: b.bid_low, bid_high: b.bid_high, bid_auto: `${b.bid_low}-${b.bid_high}` });
    const noReasons = !(rec.reasons || []).some(x => (x.title || '').trim() || (x.body || '').trim());
    if (noReasons) patch.reasons = C.genReasons(C.st.student, { ...merged, ...patch });
    return patch;
  }

  // PDF 한 쪽을 그려서 영역만 자르고, 둘레의 빈 여백을 걷어내 JPEG로 (리포트 칸에 꽉 차게)
  async function renderArea(view, area) {
    const SC = 2;
    const full = document.createElement('canvas');
    full.width = Math.ceil(view.w * SC);
    full.height = Math.ceil(view.h * SC);
    await view.pg.render({ canvasContext: full.getContext('2d'), viewport: view.pg.getViewport({ scale: SC }) })
      .promise;
    const x = 0,
      y = Math.round(area.y0 * SC),
      w = full.width,
      h = Math.round((area.y1 - area.y0) * SC);
    const b = inkBox(full.getContext('2d').getImageData(x, y, w, h));
    const PAD = 8 * SC;
    const cx = Math.max(0, b.x0 - PAD),
      cy = Math.max(0, b.y0 - PAD);
    const cw = Math.min(w, b.x1 + PAD) - cx,
      ch = Math.min(h, b.y1 + PAD) - cy;
    const c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, cw, ch);
    g.drawImage(full, x + cx, y + cy, cw, ch, 0, 0, cw, ch);
    return c.toDataURL('image/jpeg', 0.9);
  }
  // 흰색이 아닌 픽셀이 있는 범위
  function inkBox(img) {
    const { data, width, height } = img;
    let x0 = width,
      y0 = height,
      x1 = 0,
      y1 = 0;
    for (let yy = 0; yy < height; yy++)
      for (let xx = 0; xx < width; xx++) {
        const k = (yy * width + xx) * 4;
        if (data[k] < 235 || data[k + 1] < 235 || data[k + 2] < 235) {
          if (xx < x0) x0 = xx;
          if (xx > x1) x1 = xx;
          if (yy < y0) y0 = yy;
          if (yy > y1) y1 = yy;
        }
      }
    return x1 > x0 && y1 > y0 ? { x0, y0, x1: x1 + 1, y1: y1 + 1 } : { x0: 0, y0: 0, x1: width, y1: height };
  }

  window.InfoSheetImport = { pick, addFiles };
})();
