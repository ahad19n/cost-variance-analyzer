// ST-3 Excessive requests (brute force / API abuse). Separate file = fresh limiter state.
const { app, request, csrfFrom, registerAgent, createProject, uploadAndCommit } = require('./helpers');

describe('ST-3 Rate limiting', () => {
  test('6th failed login within a minute is blocked with 429', async () => {
    const agent = request.agent(app);
    const token = await csrfFrom(agent);
    const statuses = [];
    for (let i = 0; i < 6; i++) {
      const res = await agent.post('/login').type('form').send({ _csrf: token, username: 'victim', password: `guess-${i}-wrong` });
      statuses.push(res.status);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
  });

  test('AI summary endpoint allows 5 calls per minute per user, then 429', async () => {
    const agent = await registerAgent('ai_spammer');
    const p = await createProject(agent, 'AI');
    await uploadAndCommit(agent, p, Buffer.from('category,item,estimated,actual\nA,b,100,120\n'), 'a.csv');
    const statuses = [];
    for (let i = 0; i < 6; i++) {
      const res = await agent.post(`/projects/${p}/summary`).set('X-CSRF-Token', agent.csrf).set('Accept', 'application/json');
      statuses.push(res.status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });

  test('429 responses carry standard RateLimit headers', async () => {
    const agent = await registerAgent('uploader');
    const p = await createProject(agent, 'U');
    let last;
    for (let i = 0; i < 11; i++) {
      last = await agent.post(`/projects/${p}/upload`).set('X-CSRF-Token', agent.csrf).set('Accept', 'application/json')
        .attach('file', Buffer.from('category,item,estimated,actual\nA,b,1,2\n'), 'a.csv');
    }
    expect(last.status).toBe(429);
    expect(last.headers.ratelimit || last.headers['ratelimit-policy']).toBeDefined();
  });
});
