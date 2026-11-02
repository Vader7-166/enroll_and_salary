// Kiểm thử đầu-cuối trên CSDL cô lập: tạo kỳ công + lịch ca, sinh một tuần lượt quẹt, nhập qua API thật,
// kiểm tra bảng công sinh ra và chạy lại phải không nhân đôi dữ liệu.
//   node tools/punch-simulator/test/smoke.cjs
const assert = require('node:assert/strict');
const { withServer } = require('../../../backend/test/http-harness.cjs');
const { Simulator } = require('../lib/core.cjs');

withServer('punchsim', async ({ db, request, login, url }) => {
  const cookie = await login('ad.demo');
  const sim = new Simulator({ databaseUrl: url, apiBase: 'unused', username: 'ad.demo', password: 'unused' }, message => console.log('  ·', message));
  sim.api = {
    credentials: { username: 'ad.demo' },
    request: async (path, body, method) => { const r = await request(path, cookie, body, method); return { status: r.status, ok: r.status >= 200 && r.status < 300, body: r.body }; },
    async must(path, body, method) { const r = await this.request(path, body, method); assert.ok(r.ok, path + ' ' + r.status + ' ' + JSON.stringify(r.body)); return r.body; },
  };
  try {
    const sites = await sim.sites();
    console.log('Cơ sở:', JSON.stringify(sites));
    assert.ok(sites.length > 0, 'cần có nhân sự trong seed');
    const from = '2026-10-05', to = '2026-10-11'; // Thứ Hai → Chủ nhật, nằm trong kỳ công tháng 10 (26/9–25/10).
    const prep = await sim.prepareSchedules(from, to);
    console.log('Lịch ca:', JSON.stringify(prep));
    assert.ok(prep.schedules > 0);
    const again = await sim.prepareSchedules(from, to);
    assert.equal(again.schedules, 0, 'chạy lại không tạo thêm lịch');

    const punches = await sim.planPunches(from, to);
    assert.ok(punches.length > 0);
    assert.deepEqual(punches.map(p => p.at), (await sim.planPunches(from, to)).map(p => p.at), 'lượt quẹt phải xác định');
    const results = await sim.send(punches, 'smoke');
    console.log('Nhập:', JSON.stringify(results.map(r => ({ site: r.site, rows: r.rows, status: r.status, ms: r.ms, summary: r.summary }))));
    for (const r of results) assert.ok(['ACCEPTED', 'ACCEPTED_WITH_EXCEPTIONS'].includes(r.status), JSON.stringify(r));

    const days = await db.dailyAttendance.groupBy({ by: ['status'], _count: true });
    const flags = await db.$queryRawUnsafe(`SELECT unnest(flags) AS flag, count(*)::int AS n FROM daily_attendance GROUP BY 1 ORDER BY 2 DESC`);
    const schedules = await db.shiftSchedule.count();
    console.log('Bảng công:', JSON.stringify(days), '· cờ:', JSON.stringify(flags), '· lịch:', schedules);
    const total = days.reduce((n, d) => n + d._count, 0);
    assert.ok(total > schedules * 0.9, 'hầu hết lịch ca phải có dòng công, có ' + total + '/' + schedules);
    assert.ok(days.find(d => d.status === "OK")?._count > total * 0.9, 'đa số ngày công phải OK');

    const rawBefore = await db.rawPunch.count();
    const rerun = await sim.send(punches, 'smoke-lai');
    assert.equal(await db.rawPunch.count(), rawBefore, 'nhập lại cùng lượt quẹt không được nhân đôi');
    console.log('Nhập lại:', JSON.stringify(rerun.map(r => r.summary)));
    console.log('OK');
  } finally { await sim.close(); }
}).catch(error => { console.error(error); process.exit(1); });
