// Lõi dùng chung cho công cụ giả lập chấm công (CLI lịch sử + web thời gian thực).
//
// Công cụ đóng vai máy chấm công: sinh lượt quẹt thẻ rồi gửi qua API nhập tệp thật của HRTP
// (POST /attendance/imports), nên toàn bộ luồng ghép công, ngoại lệ, kỳ công đều chạy như thật.
// Phần chuẩn bị (ca, lịch ca đã duyệt, kỳ công) cần có thì ghi trực tiếp vào CSDL local, giống
// scripts/benchmark-attendance.cjs, vì API lập lịch chỉ phục vụ từng tổ một.
//
// Mọi lượt quẹt sinh ra là xác định (seed theo mã nhân viên + ngày) nên chạy lại cùng khoảng ngày
// cho đúng các lượt quẹt cũ, và khóa duy nhất của raw_punch sẽ bỏ qua thay vì nhân đôi.
const { randomUUID } = require('node:crypto');
const { resolve } = require('node:path');
const { existsSync } = require('node:fs');
const { PrismaClient } = require('@prisma/client');

const DAY_MS = 86_400_000;
const VN_OFFSET_MS = 7 * 3_600_000; // Asia/Ho_Chi_Minh, không có giờ mùa hè.
// Ngày nghỉ lễ không xếp ca. Lịch lễ chính thức do cơ sở xác nhận; đây chỉ là dữ liệu giả lập.
const HOLIDAYS = new Set(['2026-09-02']);

const SHIFTS = {
  HC: { code: 'HC', name: 'Hành chính', kind: 'ADMINISTRATIVE', startTime: '08:00', endTime: '17:00', crossesMidnight: false, breakStartOffset: 240, breakMinutes: 60, paidBreak: false },
  A: { code: 'CA-A', name: 'Ca A (sáng)', kind: 'DAY', startTime: '06:00', endTime: '14:00', crossesMidnight: false, breakStartOffset: 240, breakMinutes: 30, paidBreak: true },
  B: { code: 'CA-B', name: 'Ca B (chiều)', kind: 'DAY', startTime: '14:00', endTime: '22:00', crossesMidnight: false, breakStartOffset: 240, breakMinutes: 30, paidBreak: true },
  C: { code: 'CA-C', name: 'Ca C (đêm)', kind: 'NIGHT', startTime: '22:00', endTime: '06:00', crossesMidnight: true, breakStartOffset: 240, breakMinutes: 45, paidBreak: true },
};

// ---------- thời gian theo giờ Việt Nam ----------
const pad = n => String(n).padStart(2, '0');
const vnDate = ms => new Date(ms + VN_OFFSET_MS).toISOString().slice(0, 10);
const vnTime = ms => new Date(ms + VN_OFFSET_MS).toISOString().slice(11, 19);
const vnMidnight = date => Date.parse(date + 'T00:00:00+07:00');
const addDays = (date, n) => vnDate(vnMidnight(date) + n * DAY_MS);
const minutesOf = hhmm => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const dateRange = (from, to) => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };
const weekdayOf = date => new Date(vnMidnight(date) + VN_OFFSET_MS).getUTCDay(); // 0 = Chủ nhật
const MONDAY_EPOCH = '2026-01-05';
const weekIndex = date => Math.floor((vnMidnight(date) - vnMidnight(MONDAY_EPOCH)) / (7 * DAY_MS));

// ---------- ngẫu nhiên xác định ----------
function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function rng(seedText) {
  let a = hash32(seedText);
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const between = (r, lo, hi) => lo + (hi - lo) * r();

// ---------- cấu hình / kết nối ----------
function loadConfig(overrides = {}) {
  const envFile = resolve(__dirname, '../../../backend/.env');
  if (existsSync(envFile)) { try { process.loadEnvFile(envFile); } catch { /* đã nạp */ } }
  const databaseUrl = overrides.databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Thiếu DATABASE_URL (đặt trong backend/.env hoặc biến môi trường).');
  const host = new URL(databaseUrl).hostname;
  // HRTP_SIM_DB_HOST: tên host CSDL demo trong mạng Docker Compose (vd. `db`), tương tự SEED_DB_HOST của seed.
  const allowed = ['localhost', '127.0.0.1', '::1', ...(process.env.HRTP_SIM_DB_HOST ? [process.env.HRTP_SIM_DB_HOST] : [])];
  if (!allowed.includes(host) && process.env.HRTP_SIM_ALLOW_REMOTE !== 'true')
    throw new Error('Công cụ giả lập chỉ chạy với CSDL local/demo (' + host + '). Đặt HRTP_SIM_DB_HOST=' + host + ' nếu đây là CSDL demo trong Docker.');
  const port = process.env.API_PORT ?? process.env.PORT ?? '3000';
  return {
    databaseUrl,
    apiBase: overrides.apiBase ?? process.env.HRTP_SIM_API ?? 'http://127.0.0.1:' + port + '/api',
    username: overrides.username ?? process.env.HRTP_SIM_USER ?? 'admin',
    password: overrides.password ?? process.env.HRTP_SIM_PASSWORD ?? '',
  };
}

class HrtpApi {
  constructor(base) { this.base = base; this.cookie = null; this.credentials = null; }
  async login(username, password) {
    const res = await fetch(this.base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    const body = await res.json().catch(() => ({}));
    if (res.status !== 201 && res.status !== 200) throw new Error('Đăng nhập thất bại (' + res.status + '): ' + (body.message ?? JSON.stringify(body)));
    this.cookie = res.headers.get('set-cookie')?.split(';')[0] ?? null;
    if (!this.cookie) throw new Error('API không trả cookie phiên.');
    this.credentials = { username, password };
    return body;
  }
  async request(path, body, method, retry = true) {
    const form = body instanceof FormData;
    const res = await fetch(this.base + path, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: { ...(this.cookie ? { cookie: this.cookie } : {}), ...(!form && body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: form ? body : body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401 && retry && this.credentials) { await this.login(this.credentials.username, this.credentials.password); return this.request(path, body, method, false); }
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : await res.text();
    return { status: res.status, ok: res.status >= 200 && res.status < 300, body: data };
  }
  async must(path, body, method) {
    const r = await this.request(path, body, method);
    if (!r.ok) throw new Error(path + ' → ' + r.status + ' ' + (typeof r.body === 'string' ? r.body : r.body.message ?? JSON.stringify(r.body)).slice(0, 400));
    return r.body;
  }
}

// ---------- lõi giả lập ----------
class Simulator {
  constructor(config, log = () => {}) {
    this.config = config;
    this.log = log;
    this.db = new PrismaClient({ datasourceUrl: config.databaseUrl });
    this.api = new HrtpApi(config.apiBase);
    this.rosterCache = null;
    this.periodCache = null;
  }
  async close() { await this.db.$disconnect(); }
  async login(username = this.config.username, password = this.config.password) {
    if (!password) throw new Error('Chưa có mật khẩu: đặt HRTP_SIM_PASSWORD hoặc nhập trên giao diện.');
    await this.api.login(username, password);
  }

  /** Nhân sự đang làm, đơn vị phân công chính, cơ sở và cờ "khối trực tiếp" (làm ca kíp). */
  async roster(force = false) {
    if (this.rosterCache && !force) return this.rosterCache;
    const rows = await this.db.$queryRawUnsafe(`
      WITH RECURSIVE up AS (
        SELECT v.org_unit_id AS start_id, v.org_unit_id AS id, v.parent_id, v.unit_type, v.name
          FROM org_unit_version v WHERE v.effective_to IS NULL
        UNION ALL
        SELECT u.start_id, p.org_unit_id, p.parent_id, p.unit_type, p.name
          FROM up u JOIN org_unit_version p ON p.org_unit_id = u.parent_id AND p.effective_to IS NULL
      ), kind AS (
        SELECT start_id, bool_or(unit_type = 'BLOCK' AND name ILIKE '%trực tiếp%' AND name NOT ILIKE '%gián tiếp%') AS direct
          FROM up GROUP BY start_id
      )
      SELECT e.id AS "employeeId", e.code, e.hire_date::text AS "hireDate", a.org_unit_id AS "unitId",
             s.code AS "siteCode", s.id AS "siteId", COALESCE(k.direct, false) AS direct
        FROM employee e
        JOIN org_assignment a ON a.employee_id = e.id AND a.is_primary AND a.effective_to IS NULL
        JOIN org_unit_version v ON v.org_unit_id = a.org_unit_id AND v.effective_to IS NULL
        JOIN site s ON s.id = v.site_id
        LEFT JOIN kind k ON k.start_id = a.org_unit_id
       WHERE e.status = 'ACTIVE' AND e.termination_date IS NULL
       ORDER BY s.code, e.code`);
    this.rosterCache = rows;
    return rows;
  }

  async sites() {
    const roster = await this.roster();
    const map = new Map();
    for (const r of roster) { const s = map.get(r.siteCode) ?? { code: r.siteCode, id: r.siteId, employees: 0, direct: 0 }; s.employees++; if (r.direct) s.direct++; map.set(r.siteCode, s); }
    return [...map.values()];
  }

  async adminUserId() {
    const username = this.api.credentials?.username ?? this.config.username;
    const row = await this.db.userAccount.findUnique({ where: { username }, select: { id: true } });
    if (!row) throw new Error('Không tìm thấy tài khoản ' + username + ' trong CSDL.');
    return row.id;
  }

  /** Đảm bảo có 4 ca (hành chính, A, B, C) ở cấp công ty, tạo qua API để đúng kiểm tra nghiệp vụ. */
  async ensureShifts() {
    const company = await this.db.orgUnit.findUnique({ where: { code: 'COMPANY' } });
    if (!company) throw new Error('Không tìm thấy đơn vị gốc COMPANY.');
    const existing = (await this.api.must('/shifts/definitions?orgUnitId=' + company.id)).items.filter(i => i.orgUnitId === company.id);
    const ids = {};
    for (const [key, def] of Object.entries(SHIFTS)) {
      let item = existing.find(i => i.code === def.code);
      if (!item) { item = (await this.api.must('/shifts/definitions', { orgUnitId: company.id, ...def })).shift; this.log('Tạo ca ' + def.code); }
      if (!item.active) throw new Error('Ca ' + def.code + ' đang bị vô hiệu; bật lại trước khi giả lập.');
      ids[key] = { id: item.id, ...def, workMinutes: item.workMinutes };
    }
    return ids;
  }

  /** Kỳ công của từng cơ sở trong khoảng ngày; tạo và mở kỳ còn thiếu qua API. */
  async periods(force = false) {
    if (this.periodCache && !force) return this.periodCache;
    this.periodCache = await this.db.$queryRawUnsafe(`SELECT id, code, scope_org_unit_id AS "scopeId", date_from::text AS "dateFrom", date_to::text AS "dateTo", status::text AS status, revision FROM business_period WHERE period_type = 'ATTENDANCE' ORDER BY date_from`);
    return this.periodCache;
  }
  async siteUnits() {
    const rows = await this.db.$queryRawUnsafe(`SELECT s.code AS "siteCode", s.id AS "siteId", v.org_unit_id AS "unitId" FROM site s JOIN org_unit_version v ON v.site_id = s.id AND v.unit_type = 'SITE' AND v.effective_to IS NULL`);
    return new Map(rows.map(r => [r.siteCode, r]));
  }
  periodFor(site, date, periods) {
    return periods.find(p => p.scopeId === site.unitId && p.dateFrom <= date && date <= p.dateTo);
  }
  async ensurePeriods(siteCodes, from, to) {
    const units = await this.siteUnits();
    let periods = await this.periods(true);
    const suffixes = new Map();
    for (const code of siteCodes) {
      const unit = units.get(code);
      if (!unit) throw new Error('Cơ sở ' + code + ' chưa có đơn vị SITE.');
      const known = periods.find(p => p.scopeId === unit.unitId);
      suffixes.set(code, known ? known.code.split('-').pop() : code.replace(/[^A-Z0-9]/g, ''));
      for (const date of dateRange(from, to)) {
        let period = this.periodFor(unit, date, periods);
        if (!period) {
          // Kỳ chốt ngày 25: ngày 26 trở đi thuộc kỳ tháng sau.
          const [y, m, d] = date.split('-').map(Number);
          const month = d > 25 ? (m === 12 ? (y + 1) + '-01' : y + '-' + pad(m + 1)) : y + '-' + pad(m);
          const code2 = 'GL-CC-' + month.slice(0, 4) + '-' + month.slice(5) + '-' + suffixes.get(code);
          await this.api.must('/periods', { scopeOrgUnitId: unit.unitId, month, code: code2 });
          this.log('Tạo kỳ công ' + code2);
          periods = await this.periods(true);
          period = this.periodFor(unit, date, periods);
          if (!period) throw new Error('Kỳ ' + code2 + ' không bao phủ ngày ' + date + '.');
        }
        if (period.status === 'PLANNED') {
          await this.api.must('/periods/' + period.id + '/open', { revision: period.revision });
          this.log('Mở kỳ công ' + period.code);
          periods = await this.periods(true);
        }
      }
    }
    return periods;
  }

  /** Ca của một nhân sự trong một ngày, hoặc null nếu nghỉ. */
  shiftKeyFor(emp, date, shiftsAtSite) {
    if (weekdayOf(date) === 0 || HOLIDAYS.has(date) || emp.hireDate > date) return null;
    if (!emp.direct) return 'HC';
    const rotation = shiftsAtSite;
    const offset = hash32(emp.unitId) % rotation.length;
    return rotation[(weekIndex(date) + offset) % rotation.length];
  }

  /**
   * Tạo kế hoạch ca đã duyệt (APPROVED) cho khoảng ngày, bỏ qua ngày đã có lịch.
   * Khối trực tiếp xoay A→B→C theo tuần (Nghệ An: A→B), nghỉ Chủ nhật; khối gián tiếp làm hành chính T2–T7.
   */
  async prepareSchedules(from, to, siteCodes = null) {
    const shifts = await this.ensureShifts();
    const roster = (await this.roster()).filter(r => !siteCodes || siteCodes.includes(r.siteCode));
    if (!roster.length) return { employees: 0, schedules: 0, plans: 0 };
    const sites = [...new Set(roster.map(r => r.siteCode))];
    await this.ensurePeriods(sites, from, to);
    const actor = await this.adminUserId();
    const existing = await this.db.$queryRawUnsafe(`SELECT employee_id AS "employeeId", work_date::text AS "workDate" FROM shift_schedule WHERE work_date BETWEEN $1::date AND $2::date`, from, to);
    const has = new Set(existing.map(r => r.employeeId + '|' + r.workDate));
    const dates = dateRange(from, to);
    const byUnit = new Map();
    for (const emp of roster) {
      const rotation = emp.siteCode === 'NM-NA' ? ['A', 'B'] : ['A', 'B', 'C'];
      for (const date of dates) {
        const key = this.shiftKeyFor(emp, date, rotation);
        if (!key || has.has(emp.employeeId + '|' + date)) continue;
        const list = byUnit.get(emp.unitId) ?? []; list.push({ emp, date, key }); byUnit.set(emp.unitId, list);
      }
    }
    const planRows = [], scheduleRows = [];
    for (const [unitId, items] of byUnit) {
      const planId = randomUUID();
      planRows.push({ id: planId, teamOrgUnitId: unitId, title: 'Lịch ca giả lập ' + from + ' → ' + to, status: 'APPROVED', revision: 1, createdById: actor });
      for (const { emp, date, key } of items) {
        const shift = shifts[key], start = vnMidnight(date) + minutesOf(shift.startTime) * 60_000;
        const end = vnMidnight(date) + (minutesOf(shift.endTime) + (shift.crossesMidnight ? 1440 : 0)) * 60_000;
        scheduleRows.push({ id: randomUUID(), planId, employeeId: emp.employeeId, workDate: new Date(date + 'T00:00:00Z'), shiftId: shift.id, startAt: new Date(start), endAt: new Date(end), workMinutes: shift.workMinutes });
      }
    }
    for (let i = 0; i < planRows.length; i += 500) await this.db.shiftPlan.createMany({ data: planRows.slice(i, i + 500) });
    for (let i = 0; i < scheduleRows.length; i += 5000) await this.db.shiftSchedule.createMany({ data: scheduleRows.slice(i, i + 5000), skipDuplicates: true });
    return { employees: roster.length, schedules: scheduleRows.length, plans: planRows.length };
  }

  /** Lượt quẹt (xác định) cho các lịch ca trong khoảng ngày. */
  async planPunches(from, to, siteCodes = null) {
    const rows = await this.db.$queryRawUnsafe(`
      SELECT e.code, s.code AS "siteCode", ss.work_date::text AS "workDate", ss.start_at AS "startAt", ss.end_at AS "endAt", sd.kind::text AS kind,
             (sd.kind <> 'ADMINISTRATIVE') AS direct
        FROM shift_schedule ss
        JOIN shift_plan p ON p.id = ss.plan_id AND p.status = 'APPROVED'
        JOIN shift_definition sd ON sd.id = ss.shift_id
        JOIN employee e ON e.id = ss.employee_id
        JOIN org_assignment a ON a.employee_id = e.id AND a.is_primary AND a.effective_to IS NULL
        JOIN org_unit_version v ON v.org_unit_id = a.org_unit_id AND v.effective_to IS NULL
        JOIN site s ON s.id = v.site_id
       WHERE ss.work_date BETWEEN $1::date AND $2::date
       ORDER BY ss.start_at, e.code`, from, to);
    const out = [];
    for (const row of rows) {
      if (siteCodes && !siteCodes.includes(row.siteCode)) continue;
      out.push(...punchesForShift(row.code, row.siteCode, row.workDate, row.startAt.getTime(), row.endAt.getTime(), row.direct));
    }
    return out;
  }

  /** Gửi các lượt quẹt (đã gom theo cơ sở/kỳ) qua API nhập tệp. Trả về danh sách kết quả từng tệp. */
  async send(punches, label = 'sim') {
    if (!punches.length) return [];
    const units = await this.siteUnits();
    let periods = await this.periods();
    const groups = new Map();
    for (const p of punches) {
      const unit = units.get(p.siteCode);
      if (!unit) throw new Error('Cơ sở không xác định: ' + p.siteCode);
      let period = this.periodFor(unit, vnDate(p.at), periods);
      if (!period) { periods = await this.periods(true); period = this.periodFor(unit, vnDate(p.at), periods); }
      if (!period) throw new Error('Chưa có kỳ công cho ' + p.siteCode + ' ngày ' + vnDate(p.at) + ' — hãy tạo lịch ca/kỳ công trước.');
      const key = unit.siteId + '|' + period.id;
      const group = groups.get(key) ?? { siteId: unit.siteId, siteCode: p.siteCode, periodId: period.id, periodCode: period.code, rows: [] };
      group.rows.push(p); groups.set(key, group);
    }
    const results = [];
    for (const group of groups.values()) {
      group.rows.sort((a, b) => a.at - b.at);
      for (let i = 0; i < group.rows.length; i += 8000) {
        const slice = group.rows.slice(i, i + 8000);
        const csv = slice.map(r => [r.code, vnDate(r.at), vnTime(r.at), r.device, r.dir].join(',')).join('\n');
        const form = new FormData();
        form.set('file', new Blob([csv]), label + '-' + group.siteCode + '-' + vnDate(slice[0].at) + '.csv');
        form.set('siteId', group.siteId); form.set('referencePeriodId', group.periodId);
        const started = Date.now();
        const res = await this.api.request('/attendance/imports', form);
        const batch = res.body?.batch;
        results.push({
          site: group.siteCode, period: group.periodCode, rows: slice.length, ms: Date.now() - started, httpStatus: res.status,
          status: res.ok ? batch?.status : 'ERROR', summary: batch?.summary ?? null,
          errors: res.ok ? (batch?.errors ?? []).slice(0, 3) : [{ message: typeof res.body === 'string' ? res.body.slice(0, 200) : res.body?.message ?? JSON.stringify(res.body).slice(0, 200) }],
        });
      }
    }
    return results;
  }
}

/**
 * Lượt quẹt của một ca. Phân phối bám cửa sổ ghép công mặc định (vào: −30…+15 phút quanh giờ bắt đầu,
 * ra: −15…+30 phút quanh giờ kết thúc) để đa số ngày công là OK; một phần nhỏ cố ý rơi ra ngoài hoặc thiếu quẹt:
 * ~6% đi muộn, ~2,5% về sớm (đều trong cửa sổ, ra cờ LATE/EARLY), ~1,2% vắng, ~2% quên quẹt,
 * ~0,4% đến muộn quá cửa sổ (coi như thiếu quẹt vào), ~1,5% quẹt trùng.
 * OT không sinh mặc định vì OT cần đề nghị được duyệt; truyền options.overtime để tạo lượt ra muộn (sự kiện OT).
 */
function punchesForShift(code, siteCode, workDate, startAt, endAt, direct, options = {}) {
  const r = rng(code + '|' + workDate + '|v1');
  const habit = (hash32(code) % 1000) / 1000; // tính cách: người hay muộn / hay quên
  const device = 'MAY0' + (1 + (hash32(code) % 2));
  if (r() < 0.012) return []; // vắng
  const out = [];
  const late = r() < 0.03 + 0.09 * habit;
  const veryLate = r() < 0.004;
  const inAt = veryLate ? startAt + between(r, 16, 40) * 60_000 : late ? startAt + between(r, 1, 14) * 60_000 : startAt - between(r, 1, 25) * 60_000;
  const early = r() < 0.025;
  let outAt = early ? endAt - between(r, 1, 14) * 60_000 : endAt + between(r, 0, 14) * 60_000;
  if (options.overtime) outAt = endAt + between(r, 60, 150) * 60_000;
  const missing = r();
  const miss = missing < 0.008 ? 'IN' : missing < 0.02 ? 'OUT' : null;
  const jitter = ms => Math.round(ms / 1000) * 1000 + (Math.floor(r() * 59) - 29) * 1000;
  if (miss !== 'IN') out.push({ code, siteCode, at: jitter(inAt), dir: 'IN', device });
  if (miss !== 'OUT') out.push({ code, siteCode, at: jitter(outAt), dir: 'OUT', device });
  if (miss !== 'IN' && r() < 0.015) out.push({ code, siteCode, at: out[0].at + Math.round(between(r, 5, 40)) * 1000, dir: 'IN', device });
  return out;
}

module.exports = { Simulator, HrtpApi, loadConfig, punchesForShift, rng, hash32, between, vnDate, vnTime, vnMidnight, addDays, dateRange, DAY_MS, HOLIDAYS, SHIFTS };
