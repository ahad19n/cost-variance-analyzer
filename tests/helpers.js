process.env.NODE_ENV = 'test';
process.env.LITELLM_BASE_URL = ''; // tests never call a real AI service

const zlib = require('zlib');
const request = require('supertest');
const app = require('../src/app');

async function csrfFrom(agent, path = '/login') {
  const res = await agent.get(path);
  const m = res.text.match(/name="csrf-token" content="([^"]+)"/);
  if (!m) throw new Error(`no csrf token on ${path} (status ${res.status})`);
  return m[1];
}

async function registerAgent(username, password = 'correct-horse-battery') {
  const agent = request.agent(app);
  const token = await csrfFrom(agent, '/register');
  const res = await agent.post('/register').type('form').send({ _csrf: token, username, password });
  if (res.status !== 302) throw new Error(`register ${username} failed: ${res.status}`);
  agent.csrf = await csrfFrom(agent, '/');
  return agent;
}

async function createProject(agent, name = 'Test project') {
  const res = await agent.post('/projects').type('form').send({ _csrf: agent.csrf, name });
  return Number(res.headers.location.split('/').pop());
}

async function uploadAndCommit(agent, projectId, buf, filename) {
  const up = await agent.post(`/projects/${projectId}/upload`).set('X-CSRF-Token', agent.csrf).set('Accept', 'application/json').attach('file', buf, filename);
  if (up.status !== 200) return up;
  return agent.post(`/projects/${projectId}/upload/commit`).set('X-CSRF-Token', agent.csrf).send({ mode: 'append' });
}

// Minimal ZIP writer, used to build a "zip bomb" XLSX: one tiny compressed entry that
// claims (truthfully) to expand to tens of megabytes.
function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const comp = zlib.deflateRawSync(data);
    const nameBuf = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(0, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameBuf, comp);
    centrals.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

module.exports = { app, request, csrfFrom, registerAgent, createProject, uploadAndCommit, makeZip };
