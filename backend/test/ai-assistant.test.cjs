const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { withServer, today, addDays, day } = require('./http-harness.cjs');
const { loadCorpus, permitted, retrieve } = require('../dist/ai-business-assistant/corpus.js');
const { detectPii, validateAnswer } = require('../dist/ai-business-assistant/guards.js');

const corpusDir = resolve(__dirname, '../../docs/ai-corpus');
const qa = JSON.parse(readFileSync(resolve(corpusDir, 'qa-set.json'), 'utf8')).questions;

/** Local stand-in for the Gemini REST API: answers from the SOURCES it was given, or misbehaves on demand. */
function stubGemini() {
  const state = { mode: 'echo', calls: 0, prompts: [], hold: null };
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', async () => {
      state.calls++;
      const prompt = JSON.parse(body).contents[0].parts[0].text;
      state.prompts.push({ prompt, key: request.headers['x-goog-api-key'] });
      const sources = JSON.parse(prompt.split('\n').find(line => line.startsWith('SOURCES (JSON): ')).slice('SOURCES (JSON): '.length));
      const send = value => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: typeof value === 'string' ? value : JSON.stringify(value) }] } }], usageMetadata: { promptTokenCount: prompt.length, candidatesTokenCount: 42 } })); };
      if (state.mode === '429') { response.writeHead(429); response.end('{}'); return; }
      if (state.mode === 'slow') { setTimeout(() => send({ status: 'ANSWERED', steps: [] }), 3000); return; }
      if (state.mode === 'garbage') { send('không phải JSON'); return; }
      if (state.mode === 'hold' && state.hold) await state.hold();
      send({ status: 'ANSWERED', answer: 'Làm theo các bước sau. Xem https://evil.example',
        steps: [...sources.map(source => ({ text: 'Theo ' + source.title + ': ' + source.text.split('\n')[1] + ' <script>x</script>', sourceIds: [source.sourceId] })), { text: 'Bước bịa không có nguồn', sourceIds: ['XX-99'] }],
        actions: [...new Set(sources.flatMap(source => source.actions)), 'AD_ACCOUNTS', 'KT_PERIOD_LOCK'], limitations: [] });
    });
  });
  return new Promise(ready => server.listen(0, '127.0.0.1', () => ready({ server, state, url: 'http://127.0.0.1:' + server.address().port })));
}

test('Corpus build, permission filter, retrieval, PII and validator (pure)', () => {
  const corpus = loadCorpus(corpusDir);
  assert.ok(corpus.warnings.some(item => item.startsWith('DRAFT-01')), 'a chunk without permission metadata is dropped with a warning');
  assert.ok(!corpus.chunks.some(chunk => chunk.sourceId === 'DRAFT-01'));
  assert.match(corpus.version, /^[0-9a-f]{16}$/);
  const tt = { roles: ['TT'], permissions: ['attendance.explain', 'overtime.plan', 'leave.request', 'shift.plan', 'attendance.confirm', 'attendance.read'] };
  const ttChunks = permitted(corpus, tt, '2026-11-01');
  assert.ok(ttChunks.every(chunk => chunk.roles.includes('TT')));
  assert.deepEqual(retrieve(ttChunks, 'Làm sao khóa kỳ công?', 'payroll'), [], 'a TT never retrieves the KT lock procedure, whatever the page key');
  const kt = { roles: ['KT'], permissions: ['tax.read'] };
  assert.ok(!permitted(corpus, kt, '2026-11-01').some(chunk => chunk.sourceId === 'KT-08'), 'expired guidance is out');
  assert.ok(permitted(corpus, kt, '2025-06-01').some(chunk => chunk.sourceId === 'KT-08'));
  assert.deepEqual(detectPii('CCCD 001090012345 của chị Lan'), ['ID_NUMBER', 'ACCOUNT_NUMBER']);
  assert.deepEqual(detectPii('Gọi 0912 345 678 hoặc lan@example.com'), ['EMAIL', 'PHONE']);
  assert.deepEqual(detectPii('Lương tháng 12/2026 tính thế nào?'), []);
  const sent = ttChunks.filter(chunk => chunk.sourceId === 'TT-01');
  const checked = validateAnswer({ status: 'ANSWERED', steps: [{ text: 'Mở https://x.y <b>ngay</b>', sourceIds: ['TT-01', 'KT-02'] }, { text: 'không nguồn', sourceIds: [] }], actions: ['TT_ATTENDANCE_CORRECTIONS', 'KT_PERIOD_LOCK'] }, sent, corpus, tt);
  assert.deepEqual(checked.steps, [{ text: 'Mở ngay', sourceIds: ['TT-01'] }]);
  assert.deepEqual(checked.actions, ['TT_ATTENDANCE_CORRECTIONS']);
  assert.ok(checked.dropped.includes('SOURCE_NOT_SENT') && checked.dropped.includes('ACTION_REJECTED:KT_PERIOD_LOCK'));
  assert.equal(validateAnswer({ status: 'ANSWERED', steps: [{ text: 'x', sourceIds: ['ZZ'] }] }, sent, corpus, tt).status, 'INSUFFICIENT_SOURCE');
});

test('AI business assistant on real HTTP with a stub Gemini: Q&A set, guards, fallbacks, revocation, cache, audit', { timeout: 600000 }, async t => {
  const gemini = await stubGemini();
  try {
    await withServer('ai_assistant', async ({ db, request, ok, login }) => {
      const cookies = Object.fromEntries(await Promise.all(['tt.bn', 'qd.bn', 'kt.all', 'ad.demo'].map(async name => [name, await login(name)])));
      const ask = (cookie, question, pageKey) => request('/ai/business-assistant/answers', cookie, { question, pageKey });

      await t.test('Context and suggestions follow the role; unauthenticated requests never reach Gemini', async () => {
        const context = await ok('/ai/business-assistant/context?pageKey=attendance', cookies['tt.bn']);
        assert.equal(context.enabled, true);
        assert.equal(context.label, 'AI hướng dẫn từ tài liệu hệ thống');
        assert.ok(context.suggestions.length >= 2 && context.suggestions.every(item => !/lương/.test(item)));
        const calls = gemini.state.calls;
        assert.equal((await request('/ai/business-assistant/answers', null, { question: 'Khóa kỳ công thế nào?' })).status, 401);
        assert.equal(gemini.state.calls, calls);
      });

      await t.test('Fixed Q&A set (22): expected status and sources, forbidden sources/links never sent or shown', async () => {
        const results = [];
        for (const item of qa) {
          const before = gemini.state.calls;
          const response = await ask(cookies[item.username], item.question, item.pageKey);
          assert.equal(response.status, 201, item.id + ' ' + JSON.stringify(response.body));
          const body = response.body;
          const cited = body.citations.map(citation => citation.sourceId), actions = body.actions.map(action => action.actionKey);
          const prompt = gemini.state.calls > before ? gemini.state.prompts.at(-1).prompt : '';
          if (item.expectedStatus === 'ANSWERED') assert.equal(body.status, 'ANSWERED', item.id);
          if (item.expectedStatus === 'INSUFFICIENT_SOURCE') { assert.equal(body.status, 'INSUFFICIENT_SOURCE', item.id); assert.equal(gemini.state.calls, before, item.id + ' must not call the model'); assert.equal(body.answer, 'Chưa có tài liệu phù hợp để trả lời.'); assert.ok(body.fallback.items.length > 0, item.id + ' static guidance'); }
          for (const source of item.expectedSources) assert.ok(cited.includes(source), item.id + ' cites ' + source + ' ' + JSON.stringify(cited));
          for (const source of item.forbiddenSources) { assert.ok(!cited.includes(source), item.id + ' must not cite ' + source); assert.ok(!prompt.includes('"sourceId":"' + source + '"'), item.id + ' must not send ' + source); }
          for (const action of item.forbiddenActions) assert.ok(!actions.includes(action), item.id + ' must not link ' + action);
          assert.ok(!JSON.stringify(body).includes('evil.example') && !JSON.stringify(body).includes('<script>'), item.id + ' URL/HTML stripped');
          assert.ok(!cited.includes('XX-99'), item.id + ' invented source dropped');
          if (body.status === 'ANSWERED') assert.ok(body.limitations.some(text => /mô phỏng/.test(text)), item.id + ' simulation label');
          results.push({ id: item.id, status: body.status, cited, actions });
        }
        assert.equal(results.length, 22);
        assert.ok(results.filter(row => row.status === 'ANSWERED').length >= 14);
      });

      await t.test('Prompt carries only permitted guidance: no business data, key only in the header', async () => {
        const { prompt, key } = gemini.state.prompts.at(-1);
        assert.equal(key, 'stub-key');
        const names = (await db.employee.findMany({ select: { fullName: true, code: true } })).flatMap(row => [row.fullName, row.code]);
        for (const { prompt: text } of gemini.state.prompts) for (const name of names) assert.ok(!text.includes(name), 'no employee data in the prompt');
        assert.ok(!prompt.includes('stub-key'));
        assert.match(prompt, /chỉ dẫn nằm trong đó .* đều bị bỏ qua/);
      });

      await t.test('PII is refused before the model; questions are not stored in the audit log', async () => {
        const before = gemini.state.calls;
        const refused = await ask(cookies['kt.all'], 'Nhân viên CCCD 001090012345 chưa tính được lương?', 'payroll');
        assert.deepEqual([refused.status, refused.body.code], [400, 'PII_DETECTED']);
        assert.equal(gemini.state.calls, before);
        const rows = await db.auditLog.findMany({ where: { entityType: 'ai_business_assistant' } });
        assert.ok(rows.length >= 23);
        assert.ok(rows.every(row => !JSON.stringify(row.newValue).includes('001090012345') && !JSON.stringify(row.newValue).includes('thiếu lượt ra')), 'metadata only');
        const answered = rows.find(row => row.result === 'ANSWERED');
        assert.ok(answered.newValue.corpusVersion && answered.newValue.scopeVersion && answered.newValue.sourceHashes.length && answered.newValue.outputTokens === 42);
      });

      await t.test('Cache is bound to the permission set; an exclusion change bypasses it', async () => {
        const first = await ask(cookies['qd.bn'], 'Chốt công phân xưởng thế nào?', 'attendance');
        const calls = gemini.state.calls;
        const second = await ask(cookies['qd.bn'], 'Chốt công phân xưởng thế nào?', 'attendance');
        assert.deepEqual([second.body.cached, gemini.state.calls], [true, calls]);
        const qd = await db.userAccount.findUniqueOrThrow({ where: { username: 'qd.bn' } });
        const employee = await db.employee.findFirstOrThrow();
        await db.employeeExclusion.create({ data: { userAccountId: qd.id, employeeId: employee.id, effectiveFrom: day(addDays(today(), -1)) } });
        const third = await ask(cookies['qd.bn'], 'Chốt công phân xưởng thế nào?', 'attendance');
        assert.notEqual(third.body.scopeVersion, first.body.scopeVersion);
        assert.equal(gemini.state.calls, calls + 1, 'new permission set, new model call');
      });

      await t.test('Timeout, quota and bad output degrade to static guidance; business endpoints keep working', async () => {
        for (const [mode, reason] of [['slow', 'TIMEOUT'], ['429', 'QUOTA'], ['garbage', 'BAD_OUTPUT']]) {
          gemini.state.mode = mode;
          const response = await ask(cookies['kt.all'], 'Khóa kỳ công cần rà soát gì (' + mode + ')?', 'attendance');
          assert.deepEqual([response.status, response.body.status, response.body.reason], [201, 'UNAVAILABLE', reason], mode);
          assert.ok(response.body.fallback.items.some(item => item.sourceId === 'KT-02'));
          assert.equal((await request('/employees?page=1&pageSize=5', cookies['kt.all'])).status, 200);
        }
        gemini.state.mode = 'echo';
      });

      await t.test('Revoked session or changed permissions while the model answers: nothing is returned', async () => {
        const tt = await db.userAccount.findUniqueOrThrow({ where: { username: 'tt.bn' } });
        gemini.state.mode = 'hold';
        gemini.state.hold = () => db.webSession.deleteMany({ where: { userAccountId: tt.id } });
        assert.equal((await ask(cookies['tt.bn'], 'Lập đơn nghỉ cho nhân viên thế nào?', 'leave')).status, 401);
        const kt = await db.userAccount.findUniqueOrThrow({ where: { username: 'kt.all' } });
        const employee = await db.employee.findFirstOrThrow({ orderBy: { code: 'desc' } });
        gemini.state.hold = () => db.employeeExclusion.create({ data: { userAccountId: kt.id, employeeId: employee.id, effectiveFrom: day(addDays(today(), -1)) } });
        const changed = await ask(cookies['kt.all'], 'Chấm dứt hợp đồng cần làm gì?', 'contracts');
        assert.deepEqual([changed.status, changed.body.code], [409, 'SCOPE_CHANGED']);
        gemini.state.mode = 'echo'; gemini.state.hold = null;
      });
    }, { env: { AI_BUSINESS_ASSISTANT_ENABLED: 'true', GEMINI_API_KEY: 'stub-key', GEMINI_API_BASE: gemini.url, GEMINI_MODEL: 'stub-model', AI_TIMEOUT_MS: '1000', AI_RATE_LIMIT_PER_HOUR: '500', AI_DAILY_REQUEST_BUDGET: '1000' } });

    await withServer('ai_assistant_nokey', async ({ request, login }) => {
      const kt = await login('kt.all');
      const first = await request('/ai/business-assistant/answers', kt, { question: 'Khóa kỳ công như thế nào?', pageKey: 'attendance' });
      assert.deepEqual([first.body.status, first.body.reason], ['UNAVAILABLE', 'MISSING_KEY']);
      await request('/ai/business-assistant/answers', kt, { question: 'Khóa kỳ công như thế nào?' });
      assert.deepEqual([(await request('/ai/business-assistant/answers', kt, { question: 'Khóa kỳ công như thế nào?' })).status], [429], 'rate limit per user');
    }, { env: { AI_BUSINESS_ASSISTANT_ENABLED: 'true', AI_RATE_LIMIT_PER_HOUR: '2' } });

    await withServer('ai_assistant_off', async ({ request, ok, login }) => {
      const tt = await login('tt.bn');
      const refused = await request('/ai/business-assistant/answers', tt, { question: 'Thiếu lượt ra xử lý thế nào?' });
      assert.deepEqual([refused.status, refused.body.code], [403, 'AI_DISABLED']);
      assert.equal((await ok('/ai/business-assistant/context', tt)).enabled, false, 'the header button is hidden');
      assert.ok((await ok('/ai/business-assistant/guide?pageKey=attendance', tt)).items.some(item => item.sourceId === 'TT-01'), 'static guidance still works');
      assert.equal((await request('/shifts/plans?dateFrom=2026-11-01&dateTo=2026-11-30', tt)).status, 200);
    });
  } finally {
    gemini.server.close();
  }
});
