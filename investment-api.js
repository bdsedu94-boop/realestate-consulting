const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const rules = require('./public/investment-rules');

// 서버 사이에서만 사용하는 키입니다. 상담 사이트 로그인이나 수강생 DB 접근 권한은 부여하지 않습니다.
module.exports = function investmentApi(token = process.env.INVESTMENT_SYNC_TOKEN) {
  const router = express.Router();
  const ruleVersion = crypto.createHash('sha256')
    .update(fs.readFileSync(require.resolve('./public/investment-rules'))).digest('hex');
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!token || token.length < 32) return res.status(503).json({ error: '기준 연결이 준비되지 않았습니다.' });
    const supplied = req.get('Authorization') || '';
    const expected = `Bearer ${token}`;
    if (Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
      return res.status(401).json({ error: '기준 연결 인증이 필요합니다.' });
    }
    next();
  });
  router.use(express.json({ limit: '8kb' }));
  router.post('/diagnose', (req, res) => {
    const b = req.body || {};
    const amountOK = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1000000000;
    if (!['생애최초', '무주택', '1주택', '다주택', '일시적2주택', '미기입'].includes(b.housing_type) ||
        !['Y', 'N', 'unknown'].includes(b.transfer_available) ||
        !['실거주', '단타', '단타+실거주', '미기재'].includes(b.investment_purpose) ||
        !amountOK(b.seed_amount) || !amountOK(b.credit_amount) ||
        (b.loan_available !== undefined && !['Y', 'N', 'unknown'].includes(b.loan_available)) ||
        (b.flags !== undefined && (!Array.isArray(b.flags) || b.flags.length > 10 ||
          !b.flags.every(f => ['올현금', '기대출', '전문가확인', '명의활용'].includes(f))))) {
      return res.status(400).json({ error: '주택 현황, 전입 여부, 투자 목적과 금액을 확인해 주세요.' });
    }
    // 진단 조건만 사용하며 이름, 연락처, 상담 기록 등은 읽거나 저장하지 않습니다.
    const input = {
      housing_type: b.housing_type, transfer_available: b.transfer_available,
      investment_purpose: b.investment_purpose,
      seed_amount: b.seed_amount, credit_amount: b.credit_amount,
      loan_available: b.loan_available || 'unknown', flags: b.flags || []
    };
    res.json({ schemaVersion: 1, ruleVersion, result: rules.diagnose(input) });
  });
  return router;
};
