#!/usr/bin/env node
// Web giả lập máy chấm công thời gian thực cho HRTP.
//
//   npm run sim:live          → mở http://127.0.0.1:4100
//
// Một đồng hồ giả lập chạy với tốc độ chọn được. Mỗi nhịp, các lượt quẹt đã đến giờ được gom thành tệp CSV
// nhỏ theo cơ sở/kỳ công rồi gửi qua API nhập tệp thật; hệ thống ghép công như khi nhận dữ liệu từ máy chấm công.
// Chỉ lắng nghe 127.0.0.1. Mật khẩu chỉ giữ trong bộ nhớ tiến trình.
const http = require('node:http');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { Simulator, loadConfig, vnDate, vnTime, vnMidnight, addDays, DAY_MS } = require('./lib/core.cjs');

const PORT = Number(process.env.HRTP_SIM_PORT ?? 4100);
// Trong container phải nghe 0.0.0.0; compose chỉ publish cổng ra 127.0.0.1 của máy chủ.
const HOST = process.env.HRTP_SIM_HOST ?? '127.0.0.1';
const SPEEDS = [1, 10, 60, 300, 900, 3600];
const pageHtml = () => readFileSync(resolve(__dirname, 'public/index.html'));
const stamp = ms => vnDate(ms) + ' ' + vnTime(ms).slice(0, 5);
const pick = (list, n) => { const copy = [...list], out = []; while (out.length < n && copy.length) out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]); return out; };
const rand = (lo, hi) => lo + Math.random() * (hi - lo);

function createApp(config, sim) {
sim.log = message => note(message);
const state = {
  connected: false, user: null, running: false, simMs: 0, speed: 60, lastTick: Date.now(),
  queue: [], planned: new Set(), cutoffMs: 0, siteFilter: null, autoPrepare: true,
  feed: [], recent: [], notes: [], tagged: {}, error: null, busy: false, started: false, backlogSent: 0,
  totals: { punches: 0, files: 0, processed: 0, waiting: 0, late: 0, duplicates: 0, rejected: 0 }, bySite: {},
};

function note(message) { state.notes.unshift(new Date().toTimeString().slice(0, 8) + '  ' + message); state.notes.length = Math.min(state.notes.length, 30); }
function defaultStart() { return vnMidnight(vnDate(Date.now())) + 5 * 3_600_000; }
function parseVn(text) { const ms = Date.parse(text.length === 16 ? text + ':00+07:00' : text + '+07:00'); if (Number.isNaN(ms)) throw new Error('Thời điểm không hợp lệ: ' + text); return ms; }
function activeSites() { return state.siteFilter?.length ? state.siteFilter : null; }

function view() {
  const upcoming = state.queue.slice(0, 8).map(p => ({ at: stamp(p.at) + ':' + vnTime(p.at).slice(6), code: p.code, dir: p.dir, site: p.siteCode, tag: p.tag ?? null }));
  return {
    connected: state.connected, user: state.user, running: state.running, started: state.started, speed: state.speed, speeds: SPEEDS,
    simTime: state.simMs ? vnDate(state.simMs) + ' ' + vnTime(state.simMs) : null, simInput: state.simMs ? vnDate(state.simMs) + 'T' + vnTime(state.simMs).slice(0, 5) : null,
    queue: state.queue.length, overdue: state.queue.filter(p => p.at <= state.simMs).length, today: state.today ?? null, upcoming, busy: state.busy, autoPrepare: state.autoPrepare, siteFilter: state.siteFilter,
    totals: state.totals, tagged: state.tagged, bySite: state.bySite, feed: state.feed, recent: state.recent, notes: state.notes, error: state.error,
    sites: state.sitesInfo ?? [], apiBase: config.apiBase,
  };
}

async function planDate(date) {
  if (state.planned.has(date)) return;
  const sites = activeSites();
  const count = (await sim.db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM shift_schedule WHERE work_date = $1::date`, date))[0].n;
  if (!count && state.autoPrepare) {
    note('Chưa có lịch ca ngày ' + date + ' → tạo lịch 14 ngày');
    const r = await sim.prepareSchedules(date, addDays(date, 13), sites);
    note('Đã tạo ' + r.schedules + ' lịch ca');
  }
  const punches = await sim.planPunches(date, date, sites);
  let added = 0;
  for (const p of punches) if (p.at > state.cutoffMs) { state.queue.push(p); added++; }
  state.queue.sort((a, b) => a.at - b.at);
  state.planned.add(date);
  note('Ngày ' + date + ': ' + added + ' lượt quẹt vào hàng đợi (' + punches.length + ' theo kế hoạch)');
}

async function dispatch(punches, label) {
  if (!punches.length) return;
  const results = await sim.send(punches, label);
  const bySite = new Map();
  for (const r of results) {
    const s = r.summary ?? {};
    const t = state.totals;
    t.files++; t.punches += r.rows;
    const site = state.bySite[r.site] ??= { punches: 0, files: 0, processed: 0, waiting: 0, late: 0, duplicates: 0, rejected: 0 };
    site.files++; site.punches += r.rows;
    if (r.status === 'REJECTED' || r.status === 'ERROR') { t.rejected++; site.rejected++; }
    for (const k of ['processed', 'waiting', 'late', 'duplicates']) { t[k] += s[k] ?? 0; site[k] += s[k] ?? 0; }
    state.feed.unshift({ at: new Date().toTimeString().slice(0, 8), sim: stamp(state.simMs), site: r.site, period: r.period, rows: r.rows, ms: r.ms, status: r.status, summary: s, errors: r.errors });
    bySite.set(r.site, r.status);
  }
  state.feed.length = Math.min(state.feed.length, 40);
  if (results.some(r => r.status !== 'ERROR')) for (const p of punches) if (p.tag) state.tagged[p.tag] = (state.tagged[p.tag] ?? 0) + 1;
  for (const p of punches.slice(-30).reverse()) state.recent.unshift({ at: stamp(p.at) + ':' + vnTime(p.at).slice(6), code: p.code, dir: p.dir, site: p.siteCode, tag: p.tag ?? null });
  state.recent.length = Math.min(state.recent.length, 40);
}

async function refreshToday() {
  const day = vnDate(state.simMs);
  const rows = await sim.db.$queryRawUnsafe(`SELECT s.code AS site, d.status, count(*)::int AS n
      FROM daily_attendance d JOIN org_unit_version v ON v.org_unit_id = d.org_unit_id AND v.effective_to IS NULL JOIN site s ON s.id = v.site_id
     WHERE d.work_date BETWEEN $1::date AND $2::date GROUP BY 1, 2`, addDays(day, -1), day);
  const today = { ok: 0, err: 0, bySite: {} };
  for (const r of rows) { const k = r.status === 'OK' ? 'ok' : 'err'; today[k] += r.n; (today.bySite[r.site] ??= { ok: 0, err: 0 })[k] += r.n; }
  state.today = today;
}

async function pump() {
  if (state.busy || !state.connected || !state.started) return;
  state.busy = true;
  try {
    const day = vnDate(state.simMs);
    for (const date of [addDays(day, -1), day, addDays(day, 1)]) await planDate(date);
    const due = [];
    while (state.queue.length && state.queue[0].at <= state.simMs) due.push(state.queue.shift());
    await dispatch(due, 'live');
    if (due.length) await refreshToday();
    state.error = null;
  } catch (error) {
    state.error = error.message;
    note('Lỗi: ' + error.message);
  } finally { state.busy = false; }
}

function tick() {
  const now = Date.now(), dt = now - state.lastTick;
  state.lastTick = now;
  if (state.running) state.simMs += dt * state.speed;
  pump();
}

// ---------- sự kiện kích hoạt bằng nút ----------
// "Đợt" vào/ra kế tiếp: các lượt chưa gắn sự kiện trong 2 giờ tính từ lượt chờ sớm nhất cùng hướng,
// để sự kiện rơi vào ca sắp tới chứ không vào ca của ngày mai đã nằm sẵn trong hàng đợi.
const pending = type => {
  const items = state.queue.filter(p => p.dir === type && !p.tag);
  return items.length ? items.filter(p => p.at <= items[0].at + 2 * 3_600_000) : [];
};
const EVENTS = {
  late: n => { const items = pick(pending('IN'), n); for (const p of items) { p.at += rand(5, 14) * 60_000; p.tag = 'muộn'; } return items.length + ' lượt vào bị đẩy muộn 5–14 phút (trong cửa sổ, ra cờ LATE)'; },
  veryLate: n => { const items = pick(pending('IN'), n); for (const p of items) { p.at += rand(20, 45) * 60_000; p.tag = 'muộn quá'; } return items.length + ' lượt vào muộn 20–45 phút (ngoài cửa sổ ghép → thiếu quẹt vào)'; },
  earlyLeave: n => { const items = pick(pending('OUT'), n); for (const p of items) { p.at -= rand(3, 14) * 60_000; p.tag = 'về sớm'; } return items.length + ' lượt ra về sớm 3–14 phút (cờ EARLY)'; },
  missOut: n => { const items = pick(pending('OUT'), n); const ids = new Set(items); state.queue = state.queue.filter(p => !ids.has(p)); return 'Bỏ ' + items.length + ' lượt quẹt ra (quên quẹt ra → ngoại lệ)'; },
  missIn: n => { const items = pick(pending('IN'), n); const ids = new Set(items); state.queue = state.queue.filter(p => !ids.has(p)); return 'Bỏ ' + items.length + ' lượt quẹt vào (quên quẹt vào → ngoại lệ)'; },
  overtime: n => { const items = pick(pending('OUT'), n); for (const p of items) { p.at += rand(60, 150) * 60_000; p.tag = 'tăng ca'; } return items.length + ' lượt ra muộn 1–2,5 giờ (OT chưa đăng ký → nằm ngoài cửa sổ ghép)'; },
  duplicate: n => { const items = pick(state.lastSent ?? [], n); for (const p of items) state.queue.push({ ...p, at: Math.max(state.simMs, p.at) + 20_000, tag: 'trùng' }); state.queue.sort((x, y) => x.at - y.at); return items.length + ' lượt quẹt trùng sẽ gửi sau 20 giây giả lập (cửa sổ chống trùng 5 phút)'; },
};

async function handle(req, res, body) {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(pageHtml()); }
  if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, view());
  if (req.method !== 'POST') return json(res, 404, { message: 'Không tìm thấy' });
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return json(res, 415, { message: 'Cần application/json' });
  const b = body ? JSON.parse(body) : {};
  switch (url.pathname) {
    case '/api/login': {
      await sim.login(b.username || config.username, b.password || config.password);
      state.connected = true; state.user = b.username || config.username; state.error = null;
      state.sitesInfo = await sim.sites(); note('Đăng nhập HRTP với ' + state.user);
      return json(res, 200, view());
    }
    case '/api/start': {
      if (b.speed) state.speed = SPEEDS.includes(Number(b.speed)) ? Number(b.speed) : state.speed;
      if (b.sites) state.siteFilter = b.sites.length ? b.sites : null;
      if (typeof b.autoPrepare === 'boolean') state.autoPrepare = b.autoPrepare;
      if (!state.started || b.reset) {
        state.simMs = b.from ? parseVn(b.from) : state.simMs || defaultStart();
        state.cutoffMs = state.simMs; state.queue = []; state.planned = new Set(); state.started = true;
        note('Bắt đầu giả lập tại ' + stamp(state.simMs) + ' (×' + state.speed + ')');
      }
      state.lastTick = Date.now(); state.running = true; return json(res, 200, view());
    }
    case '/api/pause': state.running = false; return json(res, 200, view());
    case '/api/speed': if (SPEEDS.includes(Number(b.speed))) state.speed = Number(b.speed); return json(res, 200, view());
    case '/api/jump': {
      if (!state.started) throw new Error('Chưa bắt đầu giả lập.');
      const target = b.to ? parseVn(b.to) : state.queue[0] ? state.queue[0].at - 10 * 60_000 : null;
      if (target == null) throw new Error('Hàng đợi trống, hãy chọn thời điểm cụ thể.');
      if (target < state.simMs) throw new Error('Chỉ tua tiến. Muốn quay lại hãy bắt đầu lại (đặt lại) với thời điểm mới.');
      state.simMs = target; note('Tua đến ' + stamp(target)); return json(res, 200, view());
    }
    case '/api/event': {
      if (b.type === 'badFile') {
        const site = (state.sitesInfo ?? [])[0]?.code; if (!site) throw new Error('Chưa có cơ sở.');
        await dispatch([{ code: 'KHONGTONTAI', siteCode: site, at: state.simMs || Date.now(), dir: 'IN', device: 'MAY01' }], 'loi');
        note('Đã gửi tệp có mã nhân viên không tồn tại → hệ thống phải từ chối cả tệp'); return json(res, 200, view());
      }
      const fn = EVENTS[b.type]; if (!fn) throw new Error('Sự kiện không hợp lệ.');
      if (!state.started) throw new Error('Hãy bắt đầu giả lập trước.');
      const n = Math.max(1, Math.min(200, Number(b.count) || 5)); note(fn(n)); return json(res, 200, view());
    }
    case '/api/punch': {
      if (!state.started) throw new Error('Hãy bắt đầu giả lập trước.');
      const code = String(b.code ?? '').trim().toUpperCase(); const dir = b.dir === 'OUT' ? 'OUT' : 'IN';
      const emp = (await sim.roster()).find(r => r.code === code); if (!emp) throw new Error('Không tìm thấy nhân viên ' + code + '.');
      state.queue.push({ code, siteCode: emp.siteCode, at: state.simMs, dir, device: 'MAY99', tag: 'thủ công' }); state.queue.sort((a, c) => a.at - c.at);
      note('Quẹt thủ công ' + code + ' ' + dir + ' lúc ' + stamp(state.simMs)); return json(res, 200, view());
    }
    case '/api/prepare': {
      const from = b.from, to = b.to; if (!/^\d{4}-\d{2}-\d{2}$/.test(from ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(to ?? '') || from > to) throw new Error('Khoảng ngày không hợp lệ.');
      const r = await sim.prepareSchedules(from, to, activeSites()); note('Chuẩn bị lịch ca ' + from + ' → ' + to + ': ' + r.schedules + ' lịch mới'); state.planned.clear(); state.queue = []; return json(res, 200, view());
    }
    default: return json(res, 404, { message: 'Không tìm thấy' });
  }
}
function json(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }

// Ghi nhớ các lượt đã gửi gần đây để sự kiện "quẹt trùng" nhân bản được.
const baseSend = sim.send.bind(sim);
sim.send = async (punches, label) => { state.lastSent = punches.slice(-200); return baseSend(punches, label); };

const server = http.createServer((req, res) => {
  const host = String(req.headers.host ?? '');
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) { res.writeHead(403); return res.end('Forbidden'); }
  let body = '';
  req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
  req.on('end', () => handle(req, res, body).catch(error => { note('Lỗi: ' + error.message); json(res, 400, { message: error.message }); }));
});
const timer = setInterval(tick, 1000);
return { server, state, stop() { clearInterval(timer); server.close(); }, async autoLogin() {
  if (!config.password) return;
  // API có thể chưa sẵn sàng ngay khi container khởi động: thử lại vài lần.
  for (let attempt = 1; attempt <= 10; attempt++) {
    try { await sim.login(); state.connected = true; state.user = config.username; state.sitesInfo = await sim.sites(); state.error = null; note('Tự đăng nhập với ' + config.username); break; }
    catch (error) { state.error = 'Tự đăng nhập thất bại: ' + error.message + ' — đăng nhập trên giao diện.'; if (/40[13]/.test(error.message)) break; await new Promise(done => setTimeout(done, 3000)); }
  }
  // HRTP_SIM_AUTOSTART=true: chạy đồng hồ ngay từ giờ hiện tại (mặc định ×1, tức đúng thời gian thực).
  if (state.connected && process.env.HRTP_SIM_AUTOSTART === 'true') {
    const speed = Number(process.env.HRTP_SIM_SPEED ?? 1);
    state.speed = SPEEDS.includes(speed) ? speed : 1;
    state.simMs = Date.now(); state.cutoffMs = state.simMs; state.started = true; state.running = true; state.lastTick = Date.now();
    note('Tự chạy đồng hồ từ ' + stamp(state.simMs) + ' (×' + state.speed + ')');
  }
} };
}

module.exports = { createApp };

if (require.main === module) {
  const config = loadConfig();
  const sim = new Simulator(config);
  const app = createApp(config, sim);
  app.server.listen(PORT, HOST, () => { console.log('Giả lập chấm công: http://127.0.0.1:' + PORT + '  (API HRTP: ' + config.apiBase + ')'); app.autoLogin(); });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { app.stop(); await sim.close(); process.exit(0); });
}
