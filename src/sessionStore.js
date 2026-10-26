// Minimal express-session store backed by the app's SQLite database.
const session = require('express-session');

class SqliteSessionStore extends session.Store {
  constructor(db, { pruneIntervalMs = 15 * 60 * 1000 } = {}) {
    super();
    db.exec(`CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expires INTEGER NOT NULL)`);
    this.stmts = {
      get: db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expires > ?'),
      set: db.prepare('INSERT OR REPLACE INTO sessions (sid, sess, expires) VALUES (?, ?, ?)'),
      destroy: db.prepare('DELETE FROM sessions WHERE sid = ?'),
      touch: db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?'),
      prune: db.prepare('DELETE FROM sessions WHERE expires <= ?'),
    };
    this.timer = setInterval(() => this.stmts.prune.run(Date.now()), pruneIntervalMs);
    this.timer.unref();
  }

  static expiry(sess) {
    return sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 24 * 60 * 60 * 1000;
  }

  get(sid, cb) {
    try {
      const row = this.stmts.get.get(sid, Date.now());
      cb(null, row ? JSON.parse(row.sess) : null);
    } catch (err) { cb(err); }
  }

  set(sid, sess, cb = () => {}) {
    try {
      this.stmts.set.run(sid, JSON.stringify(sess), SqliteSessionStore.expiry(sess));
      cb(null);
    } catch (err) { cb(err); }
  }

  destroy(sid, cb = () => {}) {
    try { this.stmts.destroy.run(sid); cb(null); } catch (err) { cb(err); }
  }

  touch(sid, sess, cb = () => {}) {
    try { this.stmts.touch.run(SqliteSessionStore.expiry(sess), sid); cb(null); } catch (err) { cb(err); }
  }
}

module.exports = SqliteSessionStore;
