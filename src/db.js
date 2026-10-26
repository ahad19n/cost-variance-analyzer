const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

if (config.dbPath !== ':memory:') {
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
}

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS projects (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    ai_summary  TEXT,
    ai_summary_at TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS line_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    category   TEXT NOT NULL,
    item       TEXT NOT NULL,
    estimated  REAL NOT NULL,
    actual     REAL NOT NULL,
    date       TEXT,
    notes      TEXT NOT NULL DEFAULT ''
  );

  CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);
  CREATE INDEX IF NOT EXISTS idx_items_project ON line_items(project_id);
`);

// All queries are prepared statements with bound parameters (no string concatenation).
const q = {
  createUser: db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)'),
  userByName: db.prepare('SELECT * FROM users WHERE username = ?'),

  createProject: db.prepare('INSERT INTO projects (owner_id, name, description) VALUES (?, ?, ?)'),
  projectsByOwner: db.prepare(`
    SELECT p.*, COUNT(li.id) AS item_count,
           COALESCE(SUM(li.estimated), 0) AS total_estimated,
           COALESCE(SUM(li.actual), 0) AS total_actual
    FROM projects p LEFT JOIN line_items li ON li.project_id = p.id
    WHERE p.owner_id = ? GROUP BY p.id ORDER BY p.created_at DESC, p.id DESC`),
  // Ownership is enforced in SQL: a project that belongs to someone else is simply "not found".
  projectForOwner: db.prepare('SELECT * FROM projects WHERE id = ? AND owner_id = ?'),
  deleteProject: db.prepare('DELETE FROM projects WHERE id = ? AND owner_id = ?'),
  saveSummary: db.prepare("UPDATE projects SET ai_summary = ?, ai_summary_at = datetime('now') WHERE id = ?"),

  itemsForProject: db.prepare('SELECT * FROM line_items WHERE project_id = ? ORDER BY category, id'),
  insertItem: db.prepare(`
    INSERT INTO line_items (project_id, category, item, estimated, actual, date, notes)
    VALUES (@project_id, @category, @item, @estimated, @actual, @date, @notes)`),
  deleteItem: db.prepare('DELETE FROM line_items WHERE id = ? AND project_id = ?'),
  clearItems: db.prepare('DELETE FROM line_items WHERE project_id = ?'),
};

const insertItems = db.transaction((projectId, rows) => {
  for (const r of rows) q.insertItem.run({ ...r, project_id: projectId });
});

module.exports = { db, q, insertItems };
