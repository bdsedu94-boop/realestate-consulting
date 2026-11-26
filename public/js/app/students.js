// 수강생 컨설팅 화면 — 수강생 추가·삭제·수정 창, 엑셀 일괄 등록
// (일반 script: 함수·변수는 다른 app/*.js 와 전역으로 공유, index.html 에서 순서대로 불러옴)
/* ── 수강생 추가 ── */
async function addStudent() {
  const name = document.getElementById('fN').value.trim();
  if (!name) {
    alert('이름을 입력해주세요.');
    return;
  }
  const seed = parseInt(document.getElementById('fS').value) || 0;
  if (!seed) {
    alert('시드금액을 입력해주세요 (만원 단위).');
    return;
  }
  const flags = [];
  if (document.getElementById('ff1').checked) flags.push('기대출');
  if (document.getElementById('ff2').checked) flags.push('전문가확인');
  if (document.getElementById('ff3').checked) flags.push('명의활용');
  try {
    await api('/api/students', 'POST', {
      cohort: document.getElementById('fA').value.trim() || '미지정',
      name,
      housing_type: document.getElementById('fHT').value,
      seed_amount: seed,
      credit_amount: parseInt(document.getElementById('fCr').value) || 0,
      loan_available: document.getElementById('fL').value,
      transfer_available: document.getElementById('fT').value,
      note: document.getElementById('fNote').value.trim(),
      flags
    });
    ['fA', 'fN', 'fS', 'fCr', 'fNote'].forEach(id => (document.getElementById(id).value = ''));
    ['ff1', 'ff2', 'ff3'].forEach(id => (document.getElementById(id).checked = false));
    toggleForm();
    await loadStudents();
  } catch (e) {
    alert('저장 실패: ' + e.message);
  }
}

/* ── 수강생 삭제 ── */
async function delS(id, name, cohort) {
  if (!confirm(`[${cohort}] ${name} 수강생을 삭제할까요?`)) return;
  try {
    await api('/api/students/' + id, 'DELETE');
    await loadStudents();
  } catch (e) {
    alert('삭제 실패: ' + e.message);
  }
}

/* ── 편집 모달 ── */
function openEdit(d) {
  editId = d.id;
  document.getElementById('em-cohort').value = d.cohort;
  document.getElementById('em-name').value = d.name;
  document.getElementById('em-h').value = d.housing_type;
  document.getElementById('em-s').value = d.seed_amount;
  document.getElementById('em-cr').value = d.credit_amount || 0;
  document.getElementById('em-l').value = d.loan_available;
  document.getElementById('em-t').value = d.transfer_available;
  document.getElementById('em-purpose').value = d.investment_purpose || 'unknown';
  document.getElementById('em-note').value = d.note || '';
  const f = d.flags || [];
  document.getElementById('em-f1').checked = f.includes('기대출');
  document.getElementById('em-f2').checked = f.includes('전문가확인');
  document.getElementById('em-f3').checked = f.includes('명의활용');
  document.getElementById('editModal').classList.add('show');
}
function closeEdit() {
  document.getElementById('editModal').classList.remove('show');
  editId = null;
}
async function saveEdit() {
  if (!editId) return;
  const flags = [];
  if (document.getElementById('em-f1').checked) flags.push('기대출');
  if (document.getElementById('em-f2').checked) flags.push('전문가확인');
  if (document.getElementById('em-f3').checked) flags.push('명의활용');
  const updated = {
    cohort: document.getElementById('em-cohort').value.trim(),
    name: document.getElementById('em-name').value.trim(),
    housing_type: document.getElementById('em-h').value,
    seed_amount: parseInt(document.getElementById('em-s').value) || 0,
    credit_amount: parseInt(document.getElementById('em-cr').value) || 0,
    loan_available: document.getElementById('em-l').value,
    transfer_available: document.getElementById('em-t').value,
    investment_purpose: document.getElementById('em-purpose').value,
    note: document.getElementById('em-note').value.trim(),
    flags
  };
  if (previewMode) {
    // 미리보기 모드: 로컬 배열 직접 수정 후 즉시 재렌더
    const idx = students.findIndex(s => s.id === editId);
    if (idx !== -1) students[idx] = { ...students[idx], ...updated, id: editId };
    closeEdit();
    render();
    return;
  }
  try {
    await api('/api/students/' + editId, 'PUT', updated);
    closeEdit();
    await loadStudents();
  } catch (e) {
    alert('수정 실패: ' + e.message);
  }
}

/* ── Excel 업로드 일괄 등록 ── */
function mapLoanVal(v) {
  if (!v) return 'unknown';
  const s = String(v).trim();
  if (s.includes('가능') || s === 'Y' || s === 'y') return 'Y';
  if (s.includes('불가') || s === 'N' || s === 'n') return 'N';
  return 'unknown';
}
function mapTransferVal(v) {
  if (!v) return 'unknown';
  const s = String(v).trim();
  if (s.includes('가능') || s === 'Y' || s === 'y') return 'Y';
  if (s.includes('불가') || s === 'N' || s === 'n') return 'N';
  return 'unknown';
}
function mapHousing(v) {
  if (!v) return '무주택';
  const s = String(v).trim();
  if (s.includes('생애최초')) return '생애최초';
  if (s.includes('다주택')) return '다주택';
  if (s.includes('1주택') || s.includes('일시적')) return '1주택';
  if (s.includes('무주택')) return '무주택';
  return s;
}
async function importExcel(input) {
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  try {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: 'array' });

    // 시트 선택: 요약 > 수강생 리스트 > 첫 번째 시트
    const sheetName =
      wb.SheetNames.find(n => n.trim() === '요약') || wb.SheetNames.find(n => n.includes('수강생')) || wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (rows.length < 2) {
      alert('데이터가 없습니다.');
      return;
    }

    // 헤더 행 찾기 (기수가 있는 행)
    let headerIdx = 0;
    for (let i = 0; i < Math.min(5, rows.length); i++) {
      if (rows[i].some(c => String(c).includes('기수') || String(c).includes('성함') || String(c).includes('이름'))) {
        headerIdx = i;
        break;
      }
    }
    const header = rows[headerIdx].map(h => String(h).trim());

    // 컬럼 인덱스 찾기
    const ci = (...names) => {
      for (const name of names) {
        const idx = header.findIndex(h => h.replace(/\s/g, '').includes(name.replace(/\s/g, '')));
        if (idx >= 0) return idx;
      }
      return -1;
    };

    const iCohort = ci('기수');
    const iName = ci('성함', '이름', '성명');
    const iLoc = ci('거주지', '거주 지');
    const iHousing = ci('주택보유', '주택수', '주택 보유', '주택 수');
    const iSeed = ci('투자가능한금액', '투자가능금액', '투자금액', '투자금');
    const iLoanAvail = ci('추가신용대출가능여부', '신용대출가능여부', '추가신용대출');
    const iCreditAmt = ci('신용대출이가능한경우', '가능한금액');
    const iCreditLoan = iLoanAvail >= 0 ? iLoanAvail : ci('신용대출');
    const iTransfer = ci('전입가능여부', '전입가능', '전입 가능');
    const iPurpose = ci('경매투자목적', '투자목적', '경매 투자 목적', '투자 목적');
    const iNote = ci('특이사항', '비고');
    const iLastCol = header.length - 1;

    function mapLoan(v) {
      if (!v || String(v).trim() === '') return 'unknown';
      const s = String(v).trim();
      if (s.includes('잘 모르겠음') || s.includes('모르') || s.includes('불확실')) return 'unknown';
      if (s.includes('불가')) return 'N';
      if (s.includes('가능')) return 'Y';
      return 'unknown';
    }

    function mapLoanCredit(loanVal, amtVal) {
      // 신규 양식: 대출가능여부 + 금액 분리
      if (iCreditAmt >= 0) {
        const loan = mapLoan(loanVal);
        let credit = 0;
        if (loan === 'Y' && amtVal) {
          credit = parseSeedAmt(String(amtVal));
        }
        return { loan, credit };
      }
      // 이전 양식: 통합 컬럼 처리
      if (!loanVal || String(loanVal).trim() === '') return { loan: 'unknown', credit: 0 };
      const s = String(loanVal).trim();
      if (s.includes('잘 모르겠음') || s.includes('모르')) return { loan: 'unknown', credit: 0 };
      if (s.includes('불가')) return { loan: 'N', credit: 0 };
      if (s.includes('가능')) {
        return { loan: 'Y', credit: parseSeedAmt(s) };
      }
      return { loan: 'unknown', credit: 0 };
    }

    function parseSeedAmt(s) {
      s = String(s).replace(/,/g, '').trim();
      const mCombo = s.match(/(\d+\.?\d*)억\s*(\d+\.?\d*)?\s*(천만|천|만)?/);
      if (mCombo && mCombo[1]) {
        let v = Math.round(parseFloat(mCombo[1]) * 10000);
        if (mCombo[2]) {
          const u = mCombo[3];
          v += Math.round(parseFloat(mCombo[2]) * (u === '천만' || u === '천' || !u ? 1000 : 1));
        }
        return v;
      }
      const m2 = s.match(/(\d+)천만/);
      const m3 = s.match(/(\d+\.?\d*)만/);
      const mR = s.match(/\d+[~\-]\s*(\d+\.?\d*)(천만|만)/);
      const mR2 = s.match(/\d+[~\-]\s*(\d+)/);
      const mN = s.match(/^(\d+)$/);
      if (m2) return parseInt(m2[1]) * 1000;
      if (m3) return Math.round(parseFloat(m3[1]));
      if (mR) return Math.round(parseFloat(mR[1]) * (mR[2] === '천만' ? 1000 : 1));
      if (mR2) return parseInt(mR2[1]);
      if (mN) return parseInt(mN[1]);
      return 0;
    }
    function mapTransfer(v) {
      const s = String(v || '').trim();
      if (s.includes('불가')) return 'N';
      if (s.includes('가능')) return 'Y';
      return 'unknown';
    }
    function mapPurpose(v) {
      const s = String(v || '').trim();
      const hasDanta = s.includes('단타');
      const hasSilgeoju = s.includes('실거주');
      if (hasDanta && hasSilgeoju) return '단타+실거주';
      if (hasDanta) return '단타';
      if (hasSilgeoju) return '실거주';
      return 'unknown';
    }
    function mapHousing(v) {
      const s = String(v || '').trim();
      if (!s) return '미기입';
      if (s.includes('생애최초')) return '생애최초';
      if (s.includes('다주택')) return '다주택';
      if (s.includes('1주택')) return '1주택';
      if (s.includes('무주택')) return '무주택';
      return '미기입';
    }
    function parseSeed(v) {
      if (!v || String(v).trim() === '') return 0;
      const s = String(v).replace(/,/g, '').trim();
      // "1억 5천만원", "1억5천만" 등 억+천만/만 combo 우선 처리
      const mCombo = s.match(/(\d+\.?\d*)억\s*(\d+\.?\d*)?\s*(천만|천|만)?/);
      if (mCombo && mCombo[1]) {
        let total = Math.round(parseFloat(mCombo[1]) * 10000);
        if (mCombo[2]) {
          const unit = mCombo[3];
          const mult = unit === '천만' || unit === '천' || !unit ? 1000 : 1;
          total += Math.round(parseFloat(mCombo[2]) * mult);
        }
        return total;
      }
      const m2 = s.match(/(\d+)천만/);
      const m3 = s.match(/(\d+\.?\d*)만/);
      const m4 = s.match(/^(\d+)$/);
      if (m2) return parseInt(m2[1]) * 1000;
      if (m3) return Math.round(parseFloat(m3[1]));
      if (m4) return parseInt(m4[1]);
      // 범위 처리: 2~7천만, 1500~2000 등 → 최댓값 사용
      const mRange1 = s.match(/\d+[~\-]\s*(\d+\.?\d*)(천만|만)/);
      if (mRange1) {
        const mult = mRange1[2] === '천만' ? 1000 : 1;
        return Math.round(parseFloat(mRange1[1]) * mult);
      }
      const mRange2 = s.match(/\d+[~\-]\s*(\d+)/);
      if (mRange2) return parseInt(mRange2[1]); // 단위 없는 숫자 범위 → 최댓값
      return 0;
    }

    const newStudents = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      const name = String(r[iName] || '').trim();
      if (!name || name === 'nan') continue;
      const cohort = String(r[iCohort] || '').trim() || '미정';
      const loc = iLoc >= 0 ? String(r[iLoc] || '').trim() : '';
      const rawNote = iNote >= 0 && r[iNote] ? String(r[iNote]).trim() : r[iLastCol] ? String(r[iLastCol]).trim() : '';
      const note = [loc ? loc + ' 거주' : '', rawNote].filter(Boolean).join(' · ');
      const { loan, credit } = mapLoanCredit(
        r[iLoanAvail >= 0 ? iLoanAvail : iCreditLoan],
        iCreditAmt >= 0 ? r[iCreditAmt] : undefined
      );

      newStudents.push({
        cohort,
        name,
        housing_type: mapHousing(r[iHousing]),
        seed_amount: parseSeed(r[iSeed]),
        credit_amount: credit,
        loan_available: loan,
        transfer_available: mapTransfer(r[iTransfer]),
        investment_purpose: iPurpose >= 0 ? mapPurpose(r[iPurpose]) : 'unknown',
        note,
        flags: []
      });
    }

    if (!newStudents.length) {
      alert(
        `등록할 수강생이 없습니다.\n감지된 헤더: ${header.slice(0, 5).join(', ')}\n이름 컬럼(${iName}), 기수 컬럼(${iCohort})`
      );
      return;
    }
    const preview = newStudents
      .slice(0, 5)
      .map(s => `${s.cohort} ${s.name}(${s.housing_type})`)
      .join('\n');
    if (
      !confirm(
        `${newStudents.length}명을 일괄 등록하시겠습니까?\n\n${preview}${newStudents.length > 5 ? '\n...외 ' + (newStudents.length - 5) + '명' : ''}`
      )
    )
      return;
    if (previewMode) {
      const maxId = students.length ? Math.max(...students.map(s => s.id)) : 0;
      newStudents.forEach((s, i) => students.push({ ...s, id: maxId + i + 1 }));
      await loadCohorts();
      render();
      alert(`${newStudents.length}명 등록 완료! (시트: ${sheetName})`);
    } else {
      await api('/api/students/bulk', 'POST', { students: newStudents });
      await loadStudents();
      alert(`${newStudents.length}명 등록 완료! (시트: ${sheetName})`);
    }
  } catch (e) {
    alert('Excel 파싱 오류: ' + e.message);
    console.error(e);
  }
}
