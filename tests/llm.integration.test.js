// Exercises the LiteLLM integration against a local mock OpenAI-compatible server,
// so the real request/response path is tested without a network or API key.
const http = require('http');

let server; let received; let mode = 'ok';

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      received = { url: req.url, auth: req.headers.authorization, body: JSON.parse(body) };
      if (mode === 'error') { res.writeHead(500); return res.end('{"error":"boom"}'); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        id: 'x', object: 'chat.completion', created: 0, model: 'mock',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '**Overview:** over budget by 20%.\u0007' } }],
      }));
    });
  });
  await new Promise((r) => server.listen(0, r));
  process.env.LITELLM_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;
  process.env.LITELLM_API_KEY = 'sk-test-key';
  process.env.LITELLM_MODEL = 'mock-model';
  process.env.LITELLM_TIMEOUT_MS = '3000';
});
afterAll(() => server.close());

const load = () => {
  jest.resetModules();
  const { generateSummary } = require('../src/services/llm');
  const { summarize } = require('../src/services/calc');
  const s = summarize([
    { id: 1, category: 'Labour', item: 'Dev', estimated: 100, actual: 120, notes: 'private note' },
  ]);
  return () => generateSummary({ name: 'Proj' }, s, []);
};

test('sends a chat completion with system guardrails, key and model; sanitises reply', async () => {
  mode = 'ok';
  const r = await load()();
  expect(received.url).toBe('/v1/chat/completions');
  expect(received.auth).toBe('Bearer sk-test-key');
  expect(received.body.model).toBe('mock-model');
  expect(received.body.messages[0].role).toBe('system');
  expect(received.body.messages[0].content).toMatch(/untrusted DATA/);
  expect(JSON.stringify(received.body)).not.toMatch(/private note/);
  expect(r).toEqual({ text: 'Overview: over budget by 20%.', source: 'ai', model: 'mock-model' });
});

test('falls back to the local summary when the AI service fails', async () => {
  mode = 'error';
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const r = await load()();
  expect(r.source).toBe('local');
  expect(r.text).toMatch(/Overview: Proj is over budget/);
  warn.mockRestore();
});
