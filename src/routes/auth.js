const express = require('express');
const bcrypt = require('bcryptjs');
const { q } = require('../db');
const limits = require('../middleware/rateLimits');
const { credentialsSchema, formatIssues } = require('../services/validate');

const router = express.Router();
const BCRYPT_ROUNDS = 12;
// Used when the username does not exist so that response time does not reveal valid usernames.
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser', BCRYPT_ROUNDS);

function startSession(req, user, cb) {
  // Regenerate the session ID on login to prevent session fixation.
  req.session.regenerate((err) => {
    if (err) return cb(err);
    req.session.userId = user.id;
    req.session.username = user.username;
    return req.session.save(cb);
  });
}

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  return res.render('login', { mode: 'login', errors: [], values: {} });
});

router.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  return res.render('login', { mode: 'register', errors: [], values: {} });
});

router.post('/login', limits.login, async (req, res, next) => {
  const parsed = credentialsSchema.safeParse(req.body);
  const username = parsed.success ? parsed.data.username : '';
  const user = parsed.success ? q.userByName.get(username) : null;
  const ok = await bcrypt.compare(String(req.body.password || ''), user ? user.password_hash : DUMMY_HASH);

  if (!user || !ok) {
    return res.status(401).render('login', { mode: 'login', errors: ['Invalid username or password.'], values: { username: String(req.body.username || '').slice(0, 32) } });
  }
  return startSession(req, user, (err) => (err ? next(err) : res.redirect('/')));
});

router.post('/register', limits.register, async (req, res, next) => {
  const parsed = credentialsSchema.safeParse(req.body);
  const values = { username: String(req.body.username || '').slice(0, 32) };
  if (!parsed.success) {
    return res.status(400).render('login', { mode: 'register', errors: formatIssues(parsed.error), values });
  }
  if (q.userByName.get(parsed.data.username)) {
    return res.status(409).render('login', { mode: 'register', errors: ['That username is taken.'], values });
  }
  const hash = await bcrypt.hash(parsed.data.password, BCRYPT_ROUNDS);
  const info = q.createUser.run(parsed.data.username, hash);
  return startSession(req, { id: info.lastInsertRowid, username: parsed.data.username }, (err) => (err ? next(err) : res.redirect('/')));
});

router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('cva.sid');
    return res.redirect('/login');
  });
});

module.exports = router;
