// Kiểm thử web giả lập thời gian thực trên CSDL cô lập: đăng nhập, bắt đầu đồng hồ ×3600, kích hoạt sự kiện,
// kiểm tra lượt quẹt được gửi qua API thật và sinh bảng công.
//   node tools/punch-simulator/test/live.cjs
const assert = require('node:assert/strict');
const http = require('node:http');
const { withServer } = require('../../../backend/test/http-harness.cjs');
const { Simulator } = require('../lib/core.cjs');
const { createApp } = require('../server.cjs');

const sleep = ms => new Promise(done => setTimeout(done, ms));

withServer('punchlive', async ({ db, request, login, url }) => {
  const cookie = await login('ad.demo');
  const config = { databaseUrl: url, apiBase: 'unused', username: 'ad.demo', password: '' };
  const sim = new Simulator(config);
  sim.api = {
    credentials: { username: 'ad.demo' },
    async login() {},
    request: async (path, body, method) => { const r = await request(path, cookie, body, method); return { status: r.status, ok: r.status >= 200 && r.status < 300, body: r.body }; },
    async must(path, body, method) { const r = await this.request(path, body, method); assert.ok(r.ok, path + ' ' + r.status + ' ' + JSON.stringify(r.body)); return r.body; },
  };
  const app = createApp(config, sim);
  await new Promise(done => app.server.listen(0, '127.0.0.1', done));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const post = async (path, body = {}) => { const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  const state = async () => (await fetch(base + '/api/state')).json();
  try {
    assert.equal((await fetch(base + '/')).status, 200, 'trang chủ phải phục vụ được');
    const foreign = await new Promise((done, fail) => http.get({ host: '127.0.0.1', port: app.server.address().port, path: '/api/state', headers: { Host: 'evil.example' } }, r => { r.resume(); done(r.statusCode); }).on('error', fail));
    assert.equal(foreign, 403, 'Host lạ phải bị chặn');
    assert.equal((await fetch(base + '/api/pause', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status, 415, 'POST không phải JSON phải bị chặn');
    assert.equal((await post('/api/login', { username: 'ad.demo', password: 'x' })).body.connected, true);

    const started = await post('/api/start', { from: '2026-10-06T07:00', speed: 600, sites: [], autoPrepare: true });
    assert.equal(started.status, 200, JSON.stringify(started.body));
    let s;
    for (let i = 0; i < 40 && (s = await state()).queue < 20; i++) await sleep(500);
    assert.ok(s.queue >= 20 || s.totals.punches > 0, 'hàng đợi phải có lượt quẹt, lỗi: ' + s.error);

    const late = await post('/api/event', { type: 'late', count: 5 });
    assert.equal(late.status, 200, JSON.stringify(late.body));
    assert.ok((await state()).notes[0].includes('muộn'), 'sự kiện phải được ghi nhật ký');
    await post('/api/speed', { speed: 3600 });

    for (let i = 0; i < 120 && (s = await state()).simTime < '2026-10-06 18:30'; i++) await sleep(500);
    await post('/api/pause'); // khi tạm dừng, hàng đợi đến hạn vẫn được xả hết
    for (let i = 0; i < 120 && ((s = await state()).busy || s.overdue > 0); i++) await sleep(500);
    assert.ok(s.simTime >= '2026-10-06 18:30', 'đồng hồ phải chạy đến cuối ngày, hiện ' + s.simTime + ' lỗi: ' + s.error);
    assert.equal(s.error, null, s.error);
    console.log('Tổng:', JSON.stringify(s.totals), '· hàng đợi:', s.queue);
    assert.equal(s.overdue, 0, 'mọi lượt đến hạn phải đã gửi');
    assert.ok(s.totals.punches > 20 && s.totals.processed > 0, 'phải gửi và ghép được lượt quẹt');
    assert.equal(s.tagged['muộn'], 5, 'cả 5 lượt quẹt gắn sự kiện đi muộn phải đã gửi: ' + JSON.stringify(s.tagged));

    const days = await db.dailyAttendance.count({ where: { workDate: new Date('2026-10-06T00:00:00Z') } });
    console.log('Dòng công ngày 06/10:', days);
    assert.ok(days > 10, 'phải có bảng công ngày 06/10');
    const lateDays = await db.dailyAttendance.count({ where: { workDate: new Date('2026-10-06T00:00:00Z'), flags: { has: 'LATE' } } });
    assert.ok(lateDays >= 1, 'sự kiện đi muộn phải ra cờ LATE trong bảng công');

    const before = (await state()).totals.rejected;
    await post('/api/event', { type: 'badFile' });
    assert.equal((await state()).totals.rejected, before + 1, 'tệp mã lạ phải bị từ chối');

    assert.equal((await state()).running, false);
    assert.equal((await post('/api/jump', { to: '2026-10-01T00:00' })).status, 400, 'không được tua lùi');
    console.log('OK');
  } finally { app.stop(); await sim.close(); }
}).catch(error => { console.error(error); process.exit(1); });
