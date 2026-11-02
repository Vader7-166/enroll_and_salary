// add-caching-layer: p95 latency and database queries per request of read-heavy routes, reference cache off vs on.
//   node scripts/benchmark-read-routes.cjs [samples=30]
// Isolated database over real HTTP with QUERY_METRICS=true; requests are sequential so per-request query counts are exact.
const { withServer } = require('../backend/test/http-harness.cjs');

const SAMPLES = Number(process.argv[2] ?? 30);
const p = (values, q) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * q) - 1)]; };

withServer('benchmark_read_routes', async ({ db, request, ok, login, restart, logs }) => {
  const ad0 = await login('ad.demo');
  const site = await db.orgUnit.findUniqueOrThrow({ where: { code: 'NM-BN' } });
  const period = (await ok('/periods', ad0, { code: 'RR-OCT', scopeOrgUnitId: site.id, month: '2026-10' })).period;
  await ok('/periods/' + period.id + '/open', ad0, { revision: period.revision });
  const routes = [
    ['Ngữ cảnh tổ chức', 'kt.all', '/organization/context'],
    ['Danh sách nhân sự', 'kt.all', '/employees?pageSize=50'],
    ['Bảng công', 'kt.all', '/attendance/board?periodId=' + period.id + '&pageSize=50'],
    ['Kỳ lương', 'kt.all', '/payroll/periods'],
    ['Danh mục báo cáo', 'kt.all', '/reports'],
  ];
  const result = {};
  for (const enabled of ['false', 'true']) {
    await restart({ QUERY_METRICS: 'true', CACHE_REFERENCE_ENABLED: enabled });
    const cookies = { 'kt.all': await login('kt.all') };
    const rows = {};
    for (const [label, user, path] of routes) {
      for (let i = 0; i < 3; i++) await ok(path, cookies[user]);
      const from = logs().length, times = [];
      for (let i = 0; i < SAMPLES; i++) { const started = performance.now(); const res = await request(path, cookies[user]); if (res.status !== 200) throw new Error(path + ' HTTP ' + res.status); times.push(performance.now() - started); }
      await new Promise(done => setTimeout(done, 200)); // let the last finish-log flush
      const metrics = logs().slice(from).split('\n').filter(line => line.includes('{"metric":"request"')).map(line => JSON.parse(line.slice(line.indexOf('{"metric"'), line.lastIndexOf('}') + 1)));
      rows[label] = { path, p50Ms: Math.round(p(times, 0.5)), p95Ms: Math.round(p(times, 0.95)), queriesPerRequest: p(metrics.map(m => m.queries), 0.5), queryMsPerRequest: Math.round(p(metrics.map(m => m.queryMs), 0.5)), cacheHitsPerRequest: p(metrics.map(m => m.cacheHit), 0.5), samples: metrics.length };
    }
    result[enabled === 'true' ? 'cacheOn' : 'cacheOff'] = rows;
  }
  console.log(JSON.stringify({ samples: SAMPLES, node: process.version, ...result }, null, 1));
}).catch(error => { console.error(error); process.exitCode = 1; });
