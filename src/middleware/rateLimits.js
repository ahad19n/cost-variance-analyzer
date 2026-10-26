const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const handler = (req, res, _next, options) => {
  res.status(options.statusCode);
  if (req.accepts(['html', 'json']) === 'json' || req.xhr) {
    return res.json({ error: 'Too many requests, please try again later.' });
  }
  return res.render('error', { status: 429, message: 'Too many requests, please slow down and try again later.' });
};

const common = { standardHeaders: 'draft-8', legacyHeaders: false, handler };
const byUser = (req) => (req.session?.userId ? `u:${req.session.userId}` : `ip:${ipKeyGenerator(req.ip)}`);

module.exports = {
  // Whole-app ceiling against floods.
  global: rateLimit({ ...common, windowMs: 60 * 1000, limit: 300 }),
  // Brute force / credential stuffing: 5 attempts per minute per IP.
  login: rateLimit({ ...common, windowMs: 60 * 1000, limit: 5, skipSuccessfulRequests: true }),
  register: rateLimit({ ...common, windowMs: 60 * 60 * 1000, limit: 10 }),
  // Uploads are CPU-heavy (parsing): 10 per minute per user.
  upload: rateLimit({ ...common, windowMs: 60 * 1000, limit: 10, keyGenerator: byUser }),
  // AI calls cost money on the LiteLLM side: 5 per minute per user.
  ai: rateLimit({ ...common, windowMs: 60 * 1000, limit: 5, keyGenerator: byUser }),
  report: rateLimit({ ...common, windowMs: 60 * 1000, limit: 20, keyGenerator: byUser }),
};
