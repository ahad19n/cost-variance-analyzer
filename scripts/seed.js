// Creates two demo users and a sample project for alice. Safe to re-run.
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const Papa = require('papaparse');
const { q, insertItems } = require('../src/db');
const { itemSchema } = require('../src/services/validate');

const users = [
  { username: 'alice', password: 'alice-demo-pass' },
  { username: 'bob', password: 'bob-demo-pass' },
];

for (const u of users) {
  if (!q.userByName.get(u.username)) {
    q.createUser.run(u.username, bcrypt.hashSync(u.password, 12));
    console.log(`created user ${u.username} / ${u.password}`);
  }
}

const alice = q.userByName.get('alice');
if (!q.projectsByOwner.all(alice.id).length) {
  const info = q.createProject.run(alice.id, 'Customer Portal Rebuild', 'Q1-Q2 2026 rebuild of the customer self-service portal.');
  const csv = fs.readFileSync(path.join(__dirname, '..', 'sample-data', 'valid.csv'), 'utf8');
  const rows = Papa.parse(csv, { header: true, skipEmptyLines: true }).data.map((r) => itemSchema.parse(r));
  insertItems(info.lastInsertRowid, rows);
  console.log(`created project #${info.lastInsertRowid} with ${rows.length} items for alice`);
}
const bob = q.userByName.get('bob');
if (!q.projectsByOwner.all(bob.id).length) {
  const info = q.createProject.run(bob.id, "Bob's Confidential Budget", 'Should never be visible to alice.');
  insertItems(info.lastInsertRowid, [{ category: 'Salaries', item: 'Executive bonus pool', estimated: 50000, actual: 72000, date: null, notes: 'confidential' }]);
  console.log(`created project #${info.lastInsertRowid} for bob`);
}
