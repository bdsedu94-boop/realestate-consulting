const express = require('express');
const fs = require('fs');
const path = require('path');

/*
 * 로그인 (비밀번호 하나로 팀 공유)
 * - 비밀번호: Railway 환경변수 SITE_PASSWORD
 * - 로그인하면 7일짜리 쿠키를 주고, 쿠키가 없으면 /api 는 401, 화면은 로그인 페이지
 */
const AUTH_TOKEN = 'consulting_auth_ok';
const loginHTML = fs.readFileSync(path.join(__dirname, 'login-page.html'), 'utf8');

function requireAuth(req, res, next) {
  if (req.path === '/login' || req.path === '/logout') return next();
  if (req.cookies?.[AUTH_TOKEN] === '1') return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: '로그인 필요' });
  res.send(loginHTML);
}

function authRouter(sitePassword) {
  const router = express.Router();
  router.post('/login', (req, res) => {
    if (req.body.password === sitePassword) {
      res.cookie(AUTH_TOKEN, '1', { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
      res.json({ ok: true });
    } else {
      res.status(401).json({ error: '비밀번호 오류' });
    }
  });
  router.get('/logout', (req, res) => {
    res.clearCookie(AUTH_TOKEN);
    res.redirect('/');
  });
  return router;
}

module.exports = { requireAuth, authRouter };
