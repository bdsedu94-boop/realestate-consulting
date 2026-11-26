// 추천물건 리포트 — 탱크옥션 자동 캡처 (크롬 확장프로그램 '추천물건 캡처 도우미'와 연동)
// recommend/core.js 다음에 불러옴. 공통 기능은 RecCore에서 받음.
(function () {
  const R = window.RecCore;
  const { st, num, todayStr, recApi, shrink, reload, readEditor, select, save, calcBid, genReasons } = R;

  /* ── 탱크옥션 자동 캡처 (크롬 확장프로그램 '추천물건 캡처 도우미'와 연동) ── */
  const ext = { ready: false, version: null, pending: {} };
  window.addEventListener('message', e => {
    if (e.source !== window || !e.data || e.data.source !== 'tank-ext') return;
    const d = e.data;
    if (d.type === 'PONG') {
      ext.ready = true;
      ext.version = d.version;
    } else if (d.type === 'PROGRESS') {
      const p = ext.pending[d.reqId];
      if (p && p.progress) p.progress(d.message);
    } else if (d.type === 'RESULT') {
      const p = ext.pending[d.reqId];
      if (p) {
        delete ext.pending[d.reqId];
        p.resolve(d);
      }
    }
  });
  function pingExt() {
    window.postMessage({ source: 'rec-site', type: 'PING' }, location.origin);
  }
  // hint: 같은 사건번호가 여러 법원에 있을 때 고르기 위한 법원·한 줄 요약
  function extCapture(caseNo, progress, hint) {
    return new Promise(resolve => {
      const reqId = Date.now().toString(36) + Math.random().toString(36).slice(2);
      ext.pending[reqId] = { resolve, progress };
      window.postMessage({ source: 'rec-site', type: 'CAPTURE', reqId, caseNo, hint: hint || {} }, location.origin);
      setTimeout(() => {
        if (ext.pending[reqId]) {
          delete ext.pending[reqId];
          resolve({ ok: false, error: '시간 초과 (3분). 탱크옥션 창을 확인해주세요.' });
        }
      }, 180000);
    });
  }
  const EXT_GUIDE = [
    '탱크옥션 자동 캡처를 쓰려면 크롬 확장프로그램 "추천물건 캡처 도우미"가 필요합니다.',
    '',
    '설치 방법',
    '1. 크롬 주소창에 chrome://extensions 입력',
    '2. 오른쪽 위 [개발자 모드] 켜기',
    '3. [압축해제된 확장 프로그램을 로드합니다] → 프로젝트의 tank-capture-extension 폴더 선택',
    '4. 이 페이지 새로고침',
    '',
    '※ 같은 크롬에서 탱크옥션에 로그인되어 있어야 합니다.'
  ].join('\n');
  async function captureInto(rec, status) {
    if (!ext.ready) {
      pingExt();
      await new Promise(r => setTimeout(r, 400));
    }
    if (!ext.ready) {
      alert(EXT_GUIDE);
      throw new Error('확장프로그램 미설치');
    }
    if (!/^\d{4}타경\d+/.test((rec.case_no || '').replace(/\s/g, '')))
      throw new Error('사건번호를 먼저 입력·저장해주세요.');
    const manual = (rec.images || []).filter(i => i.source !== 'auto').length;
    const res = await extCapture(rec.case_no, m => status(m), { court: rec.court || '', headline: rec.headline || '' });
    if (!res.ok) throw new Error(res.error || '자동 캡처 실패');
    if (!res.images || !res.images.length) throw new Error('캡처할 영역을 찾지 못했습니다.');
    if (manual + res.images.length > 6)
      throw new Error(`이미지는 최대 6장입니다. 직접 올린 이미지(${manual}장)를 줄여주세요.`);
    status('리포트에 저장하는 중...');
    for (const im of (rec.images || []).filter(i => i.source === 'auto'))
      await recApi(`/api/recommendations/${rec.id}/images/${encodeURIComponent(im.file)}`, 'DELETE');
    for (const im of res.images)
      await recApi(`/api/recommendations/${rec.id}/images`, 'POST', {
        dataUrl: await shrink(im.dataUrl),
        caption: im.label,
        source: 'auto'
      });
    // 캡처에서 읽은 값은 비어 있는 칸만 채움 (매각기일·법원 등 → 발송 전 체크에 사용)
    const patch = {};
    for (const [k, v] of Object.entries(res.fields || {})) {
      if (v !== null && v !== undefined && v !== '' && (rec[k] === null || rec[k] === undefined || rec[k] === ''))
        patch[k] = v;
    }
    // 낙찰가율은 시세 정보라 재캡처 때 최신 값으로 갱신 (직접 고친 값은 유지)
    if (res.fields && res.fields.win_rate && rec.win_rate && rec.win_rate === rec.win_rate_auto)
      patch.win_rate = res.fields.win_rate;
    if (res.fields && res.fields.win_rate && (patch.win_rate || !rec.win_rate))
      patch.win_rate_auto = patch.win_rate || res.fields.win_rate;
    if (!rec.image_note) patch.image_note = `※ 출처: 탱크옥션 (${todayStr()} 캡처) · 개인정보는 가림 처리`;
    if (res.fields && res.fields.auto_facts) patch.auto_facts = res.fields.auto_facts;
    // 권장 입찰가: 비어 있거나 이전 자동 계산값 그대로면 낙찰가율로 다시 계산 (직접 고친 값은 유지)
    {
      const m0 = { ...rec, ...patch },
        b = calcBid(m0);
      const untouched =
        (!num(rec.bid_low) && !num(rec.bid_high)) ||
        (rec.bid_auto && rec.bid_auto === `${num(rec.bid_low)}-${num(rec.bid_high)}`);
      if (b && untouched)
        Object.assign(patch, { bid_low: b.bid_low, bid_high: b.bid_high, bid_auto: `${b.bid_low}-${b.bid_high}` });
    }
    // 추천 사유가 비어 있으면 자동 작성 (직접 쓴 내용은 그대로 둠)
    const merged = { ...rec, ...patch };
    if (!(rec.reasons || []).some(x => (x.title || '').trim() || (x.body || '').trim())) {
      const stu =
        st.student && st.student.id === rec.student_id
          ? st.student
          : typeof students !== 'undefined'
            ? students.find(x => x.id === rec.student_id)
            : null;
      if (stu) patch.reasons = genReasons(stu, merged);
    }
    if (Object.keys(patch).length) await recApi(`/api/recommendations/${rec.id}`, 'PUT', patch);
    return res;
  }
  async function autoCapture() {
    if (!st.cur) return;
    const btn = document.getElementById('recAutoBtn'),
      stEl = document.getElementById('recAutoStatus');
    const status = (m, err) => {
      if (stEl) {
        stEl.textContent = m;
        stEl.classList.toggle('err', !!err);
      }
    };
    try {
      readEditor();
      if (st.dirty || !st.cur.case_no) await save(true);
      if (btn) btn.disabled = true;
      status('탱크옥션 창을 여는 중... (작업이 끝날 때까지 그 창을 닫지 마세요)');
      const id = st.cur.id;
      const res = await captureInto(st.cur, status);
      await reload(id);
      select(id);
      const s2 = document.getElementById('recAutoStatus');
      if (s2) {
        s2.textContent =
          `✓ ${res.images.length}장 캡처 완료 (${res.images.map(i => i.label).join(', ')})` +
          (res.masked ? ` · 이름 ${res.masked}건 가림` : '') +
          (res.fields && res.fields.win_rate ? ' · 낙찰가율 입력됨' : ' · 낙찰가율은 직접 입력 필요') +
          (res.missing && res.missing.length ? ` · 못 찾음: ${res.missing.join(', ')}` : '');
      }
    } catch (e) {
      status('⚠ ' + e.message, true);
      console.error(e);
    } finally {
      if (btn) btn.disabled = false;
    }
  }
  async function autoCaptureAll() {
    const targets = st.recs.filter(r => !(r.images || []).some(i => i.source === 'auto') && r.case_no);
    if (!targets.length) return;
    if (!confirm(`${targets.length}건을 차례대로 자동 캡처합니다. 끝날 때까지 탱크옥션 창을 닫지 마세요. 진행할까요?`))
      return;
    if (st.dirty) await save(true);
    const el = () => document.getElementById('recBulkStatus');
    const fails = [];
    for (let i = 0; i < targets.length; i++) {
      const r = targets[i];
      try {
        await captureInto(r, m => {
          const e = el();
          if (e) e.textContent = `(${i + 1}/${targets.length}) ${r.case_no} · ${m}`;
        });
      } catch (e) {
        fails.push(`${r.case_no}: ${e.message}`);
        if (e.message === '확장프로그램 미설치') break;
      }
      await new Promise(ok => setTimeout(ok, 1500));
    }
    await reload(st.cur && st.cur.id);
    if (st.cur) select(st.cur.id);
    alert(
      `자동 캡처 완료: ${targets.length - fails.length}건 성공${fails.length ? `\n\n실패 ${fails.length}건\n${fails.join('\n')}` : ''}`
    );
  }

  Object.assign(R, { pingExt });
  Object.assign(window.RecReport, { autoCapture, autoCaptureAll });
})();
