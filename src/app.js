const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const { csrfSync } = require('csrf-sync');

const config = require('./config');
const { db } = require('./db');
const SqliteSessionStore = require('./sessionStore');
const limits = require('./middleware/rateLimits');
const { notFound, errorHandler } = require('./middleware/errors');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
app.disable('x-powered-by');

// --- Security headers ----------------------------------------------------------
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        ...(config.cookieSecure ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    strictTransportSecurity: config.cookieSecure ? { maxAge: 31536000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'same-origin' },
  }),
);

app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: config.isProd ? '1h' : 0 }));
app.use('/static/vendor', express.static(path.join(__dirname, '..', 'node_modules', 'chart.js', 'dist'), { maxAge: '1d' }));

app.use(limits.global);

// --- Body parsing (small limits; the PDF route allows chart images) ------------
app.use('/projects/:id/report.pdf', express.json({ limit: '5mb' }));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '50kb' }));

// --- Sessions --------------------------------------------------------------------
app.use(
  session({
    name: 'cva.sid',
    secret: config.sessionSecret,
    store: new SqliteSessionStore(db),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookieSecure,
      maxAge: 2 * 60 * 60 * 1000, // 2 h idle timeout
    },
  }),
);

// --- CSRF (synchronizer token pattern) ----------------------------------------------
const { csrfSynchronisedProtection, generateToken } = csrfSync({
  getTokenFromRequest: (req) => req.headers['x-csrf-token'] || req.body?._csrf,
});
app.use(csrfSynchronisedProtection);
app.use((req, res, next) => {
  res.locals.csrfToken = generateToken(req);
  res.locals.username = req.session.username || null;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

app.get('/healthz', (req, res) => res.json({ ok: true }));
app.use(require('./routes/auth'));
app.use(require('./routes/projects'));
app.use(require('./routes/ai'));

app.use(notFound);
app.use(errorHandler);

module.exports = app;
