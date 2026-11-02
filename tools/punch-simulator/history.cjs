#!/usr/bin/env node
// Sinh dữ liệu chấm công lịch sử: tạo kỳ công + lịch ca đã duyệt + lượt quẹt, rồi nhập qua API thật.
//
//   HRTP_SIM_PASSWORD='...' node tools/punch-simulator/history.cjs [--from 2026-07-26] [--to 2026-11-01]
//                                                                  [--sites NM-BN,HQ-HN] [--user admin] [--dry-run]
//
// Mặc định: từ 2026-07-26 (đầu kỳ công tháng 8) đến hôm qua, mọi cơ sở. Chạy lại an toàn: lịch ca đã có được bỏ qua,
// lượt quẹt là xác định nên trùng sẽ bị khóa duy nhất của raw_punch loại bỏ.
const { Simulator, loadConfig, vnDate, addDays, dateRange } = require('./lib/core.cjs');

function args() {
  const out = { flags: new Set() };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    if (key === 'dry-run') out.flags.add(key); else out[key] = argv[++i];
  }
  return out;
}
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s ?? '');

(async () => {
  const a = args();
  const yesterday = addDays(vnDate(Date.now()), -1);
  const from = a.from ?? '2026-07-26', to = a.to ?? yesterday;
  if (!isDate(from) || !isDate(to) || from > to) throw new Error('--from/--to phải là YYYY-MM-DD và from ≤ to.');
  const config = loadConfig({ username: a.user });
  const sim = new Simulator(config, message => console.log('  ·', message));
  try {
    const all = await sim.sites();
    const siteCodes = a.sites ? a.sites.split(',').map(s => s.trim()) : all.map(s => s.code);
    for (const code of siteCodes) if (!all.some(s => s.code === code)) throw new Error('Không có cơ sở ' + code + ' (có: ' + all.map(s => s.code).join(', ') + ')');
    console.log('Khoảng ngày:', from, '→', to, '(' + dateRange(from, to).length + ' ngày)');
    for (const s of all.filter(s => siteCodes.includes(s.code))) console.log('  ' + s.code + ': ' + s.employees + ' nhân sự (' + s.direct + ' ca kíp, ' + (s.employees - s.direct) + ' hành chính)');
    if (a.flags.has('dry-run')) { console.log('Chạy thử (--dry-run): không ghi gì. Bỏ cờ này để sinh dữ liệu.'); return; }

    await sim.login();
    console.log('Đã đăng nhập với', config.username);
    console.log('Tạo ca và kỳ công…');
    await sim.ensureShifts();
    await sim.ensurePeriods(siteCodes, from, to);

    const totals = { files: 0, rows: 0, inserted: 0, duplicates: 0, waiting: 0, late: 0, exceptionDays: 0, rejected: 0, ms: 0 };
    const started = Date.now();
    // Mỗi lượt một tuần: đủ nhỏ để tệp ≤ 8.000 dòng/kỳ và vẫn theo thứ tự thời gian.
    for (let cursor = from; cursor <= to; cursor = addDays(cursor, 7)) {
      const end = addDays(cursor, 6) < to ? addDays(cursor, 6) : to;
      // Lịch ca tạo theo từng tuần ngay trước khi nhập, như lịch được duyệt dần: mỗi lần nhập backend xử lý lại mọi lịch ca
      // của các kỳ liền kề, nên tạo sẵn cả 3 tháng khiến lần nhập đầu phải ghi hàng chục nghìn ngày vắng cùng lúc.
      const prep = await sim.prepareSchedules(cursor, end, siteCodes);
      const punches = await sim.planPunches(cursor, end, siteCodes);
      // Ca đêm của ngày cuối tuần có lượt ra sang tuần sau: gửi cùng tuần, kỳ công được suy từ ngày quẹt.
      const results = await sim.send(punches, 'lichsu');
      for (const r of results) {
        totals.files++; totals.rows += r.rows; totals.ms += r.ms;
        if (r.status === 'ERROR' || r.status === 'REJECTED') { totals.rejected++; console.log('  ✗', r.site, r.period, r.status, JSON.stringify(r.errors)); continue; }
        for (const k of ['inserted', 'duplicates', 'waiting', 'late', 'exceptionDays']) totals[k] += r.summary?.[k] ?? 0;
      }
      console.log(cursor + ' → ' + end + ': ' + prep.schedules + ' lịch ca mới, ' + punches.length + ' lượt quẹt, ' + results.length + ' tệp, ' + Math.round((Date.now() - started) / 1000) + 's');
    }
    console.log('Xong:', JSON.stringify(totals));
    if (totals.rejected) process.exitCode = 1;
  } finally { await sim.close(); }
})().catch(error => { console.error('Lỗi:', error.message); process.exit(1); });
