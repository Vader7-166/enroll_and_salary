const Decimal = require('decimal.js');
const { createHash } = require('node:crypto');
const { cipherText } = require('../dist/personnel/contract-crypto.js');

// Fictional snapshot, not personal data or a source of statutory/business policy.
const SNAPSHOT = '2026-10-18';
const sites = [
  { code: 'HQ-HN', prefix: 'HN', name: 'Trụ sở Hà Nội', region: 'I', departments: [
    ['HQ-HN-D1', 'Phòng Tài chính – Kế toán', 20, ['Kế toán tiền lương', 'Kế toán tổng hợp'], 'FIN'],
    ['HQ-HN-D2', 'Phòng Công nghệ thông tin', 15, ['Hạ tầng hệ thống', 'Ứng dụng doanh nghiệp'], 'IT'],
    ['HN-BOD', 'Ban Tổng Giám đốc', 8, [], 'BOD'],
    ['HN-HR', 'Phòng Nhân sự', 40, ['Tiền lương & C&B', 'Hồ sơ & Hợp đồng', 'BHXH & Thuế', 'Tuyển dụng & Đào tạo'], 'HR'],
    ['HN-PLAN', 'Phòng Kế hoạch – Vật tư', 32, ['Kế hoạch sản xuất', 'Mua hàng'], 'PLAN'],
    ['HN-SALE', 'Phòng Kinh doanh – Xuất nhập khẩu', 35, ['Kinh doanh', 'Xuất nhập khẩu'], 'SALE'],
    ['HN-ADM', 'Phòng Hành chính – Pháp chế', 30, ['Hành chính', 'Pháp chế'], 'ADM'],
  ] },
  { code: 'NM-BN', prefix: 'BN', name: 'Nhà máy Bắc Ninh', region: 'I', departments: [
    ['NM-BN-D1', 'Phân xưởng Công nghệ dán bề mặt (SMT)', 300, ['SMT-1', 'SMT-2', 'SMT-3', 'In kem hàn', 'Kiểm tra AOI'], 'PROD'],
    ['NM-BN-D2', 'Phân xưởng Lắp ráp', 320, ['Lắp ráp 1', 'Lắp ráp 2', 'Lắp ráp 3', 'Hàn linh kiện'], 'PROD'],
    ['BN-PX-QC', 'Phân xưởng Kiểm tra chất lượng', 160, ['Kiểm tra ICT', 'Kiểm tra FCT', 'Kiểm tra ngoại quan'], 'PROD'],
    ['BN-PX-PKG', 'Phân xưởng Đóng gói', 120, ['Đóng gói 1', 'Đóng gói 2'], 'PROD'],
    ['BN-ENG', 'Phòng Kỹ thuật sản xuất', 65, [], 'ENG'],
    ['BN-QA', 'Phòng Đảm bảo chất lượng', 40, [], 'QA'],
    ['BN-WH', 'Phòng Kho vận', 45, ['Kho nguyên vật liệu', 'Kho thành phẩm'], 'WH'],
    ['BN-HSE', 'Phòng An toàn – Môi trường', 15, [], 'HSE'],
    ['BN-HRS', 'Bộ phận Nhân sự nhà máy', 20, [], 'HR'],
    ['BN-GA', 'Bộ phận Hành chính nhà máy', 15, ['Bảo vệ', 'Bếp ăn', 'Y tế'], 'ADM'],
  ] },
  { code: 'NM-HNA', prefix: 'HNA', name: 'Nhà máy Hà Nam', region: 'II', departments: [
    ['NM-HNA-D1', 'Phân xưởng Cuộn dây & Linh kiện thụ động', 230, ['Quấn dây 1', 'Quấn dây 2', 'Ép nhựa'], 'PROD'],
    ['NM-HNA-D2', 'Phân xưởng Lắp ráp mô-đun', 180, ['Lắp ráp A', 'Lắp ráp B'], 'PROD'],
    ['HNA-PX-TPK', 'Phân xưởng Kiểm tra – Đóng gói', 90, ['Kiểm tra sản phẩm', 'Đóng gói'], 'PROD'],
    ['HNA-ENG', 'Phòng Kỹ thuật', 35, [], 'ENG'],
    ['HNA-QA', 'Bộ phận Đảm bảo chất lượng', 20, [], 'QA'],
    ['HNA-WH', 'Bộ phận Kho vận', 25, [], 'WH'],
    ['HNA-HRS', 'Bộ phận Hành chính – Nhân sự', 20, ['Bảo vệ', 'Bếp ăn'], 'HR'],
  ] },
  { code: 'NM-NA', prefix: 'NA', name: 'Nhà máy Nghệ An', region: 'III', departments: [
    ['NM-NA-D1', 'Phân xưởng Gia công cơ khí chính xác', 170, ['Dập linh kiện', 'Tiện – Phay CNC'], 'PROD'],
    ['NM-NA-D2', 'Phân xưởng Hoàn thiện & Đóng gói', 100, ['Sơn tĩnh điện', 'Đóng gói'], 'PROD'],
    ['NA-ENG', 'Bộ phận Kỹ thuật', 20, [], 'ENG'],
    ['NA-QA', 'Bộ phận Đảm bảo chất lượng', 15, [], 'QA'],
    ['NA-HRS', 'Bộ phận Hành chính – Nhân sự', 15, ['Bảo vệ', 'Kho vật tư'], 'HR'],
  ] },
];
const titles = [
  ['A1-TGD', 'Tổng Giám đốc', 1, 'A', 65000000],
  ['A2-GDK', 'Giám đốc chức năng', 2, 'A', 42000000],
  ['B3-TP', 'Trưởng phòng', 3, 'B', 25000000],
  ['B3-QDPX', 'Quản đốc phân xưởng', 3, 'B', 23000000],
  ['JOB-C', 'Tổ trưởng sản xuất', 5, 'C', 12500000],
  ['D6-KTTL', 'Kế toán tiền lương', 6, 'D', 14000000],
  ['D6-QTHT', 'Chuyên viên Công nghệ thông tin', 6, 'D', 17000000],
  ['D6-CVNS', 'Chuyên viên Nhân sự', 6, 'D', 12500000],
  ['D6-KYSU', 'Kỹ sư sản xuất', 6, 'D', 15500000],
  ['D6-QA', 'Chuyên viên Đảm bảo chất lượng', 6, 'D', 13000000],
  ['D6-KH', 'Chuyên viên Kế hoạch – Vật tư', 6, 'D', 13000000],
  ['D6-KD', 'Chuyên viên Kinh doanh – Xuất nhập khẩu', 6, 'D', 14500000],
  ['D6-HSE', 'Chuyên viên An toàn – Môi trường', 6, 'D', 12500000],
  ['D6-HC', 'Nhân viên Hành chính', 6, 'D', 10000000],
  ['E7-KTV', 'Kỹ thuật viên bảo trì', 7, 'E', 10000000],
  ['E7-KHO', 'Nhân viên Kho vận', 7, 'E', 8500000],
  ['JOB-F', 'Công nhân sản xuất', 8, 'F', 6500000],
];
const jobByKind = { FIN: 'D6-KTTL', IT: 'D6-QTHT', HR: 'D6-CVNS', ENG: 'D6-KYSU', QA: 'D6-QA', PLAN: 'D6-KH', SALE: 'D6-KD', ADM: 'D6-HC', HSE: 'D6-HSE', WH: 'E7-KHO' };
const operators = [
  ['tt.bn', 'Nguyễn Văn Hùng', 'Tổ trưởng mô phỏng Bắc Ninh', 'NM-BN-D1-T1', 'JOB-C', 'MALE'],
  ['qd.bn', 'Trần Quang Minh', 'Quản đốc mô phỏng Bắc Ninh', 'NM-BN-D1', 'B3-QDPX', 'MALE'],
  ['kt.all', 'Lê Thị Mai Anh', 'Kế toán mô phỏng toàn công ty', 'HQ-HN-D1', 'D6-KTTL', 'FEMALE'],
  ['kt.bn', 'Phạm Thu Hà', 'Kế toán mô phỏng Bắc Ninh', 'NM-BN-D1', 'D6-KTTL', 'FEMALE'],
  ['ad.demo', 'Đỗ Minh Tuấn', 'Quản trị mô phỏng', 'HQ-HN-D2', 'D6-QTHT', 'MALE'],
];
const families = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Vũ', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lý', 'Đinh', 'Đào', 'Trịnh', 'Mai'];
const femaleNames = ['Anh', 'Linh', 'Hương', 'Trang', 'Hà', 'Thảo', 'Ngọc', 'Lan', 'Yến', 'Hằng', 'Nhung', 'Phương', 'Mai', 'Oanh', 'Quỳnh', 'Thu', 'Hiền', 'Giang', 'Tâm', 'Vy'];
const maleNames = ['Hùng', 'Minh', 'Tuấn', 'Dũng', 'Huy', 'Long', 'Nam', 'Sơn', 'Thành', 'Đức', 'Trung', 'Hải', 'Phong', 'Quân', 'Khánh', 'Bảo', 'Cường', 'Hiếu', 'Phúc', 'Kiên'];
const middles = { FEMALE: ['Thị', 'Thu', 'Ngọc', 'Thanh', 'Diệu', 'Mai', 'Bảo', 'Khánh'], MALE: ['Văn', 'Quang', 'Minh', 'Đức', 'Hữu', 'Đình', 'Xuân', 'Thanh'] };
const day = 86400000;
function date(value) { return new Date(value + 'T00:00:00.000Z'); }
function titleId(id, code) { return id('job:' + (code.startsWith('JOB-') ? code.slice(4) : code)); }
function profile(code, index, job, legacy = false) {
  const gender = index % 10 < 6 ? 'FEMALE' : 'MALE';
  const nameBytes = createHash('sha256').update('hrtp-fictional-name:' + code).digest();
  const given = gender === 'FEMALE' ? femaleNames : maleNames;
  const fullName = `${families[nameBytes[0] % families.length]} ${middles[gender][nameBytes[1] % 8]} ${given[nameBytes[2] % given.length]}`;
  const probation = !legacy && index % 31 === 0 && job !== 'B3-TP' && job !== 'B3-QDPX' && !job.startsWith('A');
  const year = probation ? 2026 : 2020 + index % (legacy ? 6 : 7);
  const hireDate = probation ? date('2026-10-01') : new Date(Date.UTC(year, index % 9, 1 + index % 20));
  return { code, fullName, gender, dob: new Date(Date.UTC(year - 21 - index % 24, (index * 7) % 12, 1 + (index * 11) % 28)), hireDate,
    nationality: 'Việt Nam', email: `${code.toLowerCase()}@example.invalid`, phone: null, job, index, probation, legacy };
}
function dataset() {
  const people = [];
  let index = 0;
  for (const site of sites) {
    for (let d = 1; d <= 2; d++) for (let t = 1; t <= 2; t++) for (let n = 1; n <= 2; n++) {
      const department = site.departments[d - 1];
      people.push({ ...profile(`${site.code}-D${d}-T${t}-NV${n}`, index++, jobByKind[department[4]] || 'JOB-F', true),
        site, department: department[0], unit: `${site.code}-D${d}-T${t}`, oldName: `Nhân viên mô phỏng ${site.code}-D${d}-T${t}-NV${n}`, oldGrade: 'F' });
    }
  }
  for (const [username, fullName, oldName, unit, job, gender] of operators) {
    const site = sites.find(s => unit.startsWith(s.code));
    people.push({ ...profile('OP-' + username.toUpperCase().replaceAll('.', '-'), index++, job, true), fullName, gender,
      site, department: unit.replace(/-T\d+$/, ''), unit, oldName, oldGrade: ['tt.bn', 'qd.bn'].includes(username) ? 'C' : 'A' });
  }
  const hq = sites[0];
  people.push({ ...profile('VIP-DEMO', index++, 'D6-QTHT', true), site: hq, department: 'HQ-HN-D2', unit: 'HQ-HN-D2',
    oldName: 'Hồ sơ mô phỏng giới hạn truy cập', oldGrade: 'A' });
  for (const site of sites) {
    let serial = 1;
    for (const [code, , count, teamNames, kind] of site.departments) {
      const existing = people.filter(p => p.legacy && p.department === code).length;
      for (let n = existing; n < count; n++) {
        let job = jobByKind[kind] || 'JOB-F';
        if (kind === 'BOD') job = n === 0 ? 'A1-TGD' : 'A2-GDK';
        else if (n === existing && code !== 'NM-BN-D1') job = kind === 'PROD' ? 'B3-QDPX' : 'B3-TP';
        else if (kind === 'PROD' && n <= existing + teamNames.length) job = 'JOB-C';
        else if (kind === 'PROD' && n % 12 === 0) job = 'E7-KTV';
        const unit = teamNames.length && job !== 'B3-TP' && job !== 'B3-QDPX' ? code + '-T' + (n % teamNames.length + 1) : code;
        people.push({ ...profile(site.prefix + String(serial++).padStart(5, '0'), index++, job), site, department: code, unit });
      }
    }
  }
  return people;
}

async function seedRealistic(tx, id, from) {
  const keyText = process.env.HR_DATA_KEY || '';
  const key = Buffer.from(keyText, 'base64');
  if (key.length !== 32 || key.toString('base64') !== keyText) throw Error('Realistic seed requires the existing valid 32-byte HR_DATA_KEY; it never generates or replaces it.');
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(8210472)::text AS lock`;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(8210473)::text AS lock`;
  async function label(code, oldName, name, extra = {}) {
    await tx.orgUnitVersion.updateMany({ where: { id: id('version:' + code), name: oldName, effectiveFrom: from, effectiveTo: null }, data: { name, ...extra } });
  }
  async function unit(code, name, type, level, parent, site, extra = {}) {
    const row = await tx.orgUnit.findUnique({ where: { code } });
    if (row && row.id !== id('org:' + code)) throw Error('Seed unit code is already owned by another record: ' + code);
    await tx.orgUnit.upsert({ where: { id: id('org:' + code) }, update: {}, create: { id: id('org:' + code), code } });
    await tx.orgUnitVersion.upsert({ where: { id: id('version:' + code) }, update: {}, create: {
      id: id('version:' + code), orgUnitId: id('org:' + code), name, type, level, parentId: id('org:' + parent), siteId: id('site:' + site), effectiveFrom: from, ...extra,
    } });
  }
  await label('COMPANY', 'Công ty mô phỏng HRTP', 'Công ty TNHH Điện tử HRTP (giả lập)');
  for (const [code, name] of [['A', 'Quản lý cấp cao'], ['B', 'Quản lý cấp trung'], ['C', 'Giám sát'], ['D', 'Chuyên môn nghiệp vụ'], ['E', 'Kỹ thuật'], ['F', 'Công nhân sản xuất']]) {
    await tx.jobGrade.upsert({ where: { code }, update: {}, create: { id: id('grade:' + code), code, name } });
    if (['A', 'C', 'F'].includes(code)) await tx.jobGrade.updateMany({ where: { id: id('grade:' + code), name: { in: ['Chuyên viên', 'Quản lý sản xuất', 'Công nhân'] } }, data: { name } });
  }
  for (const [code, name, jobLevel, grade] of titles) {
    await tx.jobTitle.upsert({ where: { code }, update: {}, create: { id: titleId(id, code), code, name, jobLevel, jobGradeId: id('grade:' + grade) } });
    if (['JOB-C', 'JOB-F'].includes(code)) await tx.jobTitle.updateMany({ where: { id: titleId(id, code), name: { in: ['Quản lý sản xuất', 'Công nhân'] } }, data: { name } });
  }
  await tx.jobTitle.updateMany({ where: { id: id('job:A'), name: 'Chuyên viên', jobLevel: 4, jobGradeId: id('grade:A') }, data: { jobLevel: 6, jobGradeId: id('grade:D') } });
  for (const site of sites) {
    await tx.site.updateMany({ where: { id: id('site:' + site.code), address: 'Địa chỉ mô phỏng — ' + site.name }, data: { address: 'Khu vực ' + site.name.replace('Nhà máy ', '').replace('Trụ sở ', '') + ' — địa điểm giả lập phục vụ đồ án, không phải địa chỉ doanh nghiệp' } });
    await label(site.code + '-BLOCK', 'Khối vận hành — ' + site.name, site.code === 'HQ-HN' ? 'Khối Điều hành – Nghiệp vụ' : 'Khối Sản xuất trực tiếp');
    if (site.code !== 'HQ-HN') await unit(site.code + '-GT', 'Khối Hỗ trợ – Gián tiếp', 'BLOCK', 3, site.code, site.code);
    for (const [code, name, , teams, kind] of site.departments) {
      const block = kind === 'PROD' || site.code === 'HQ-HN' ? site.code + '-BLOCK' : site.code + '-GT';
      const extra = { costCenterCode: 'CC-' + code.replace(/^HQ-HN-/, 'HN-').replace(/^NM-/, ''), accountingAccount: kind === 'PROD' ? '622' : '642' };
      await unit(code, name, 'DEPARTMENT', 4, block, site.code, extra);
      const legacy = /-D[12]$/.test(code);
      if (legacy) await label(code, 'Phân xưởng ' + code.slice(-1) + ' — ' + site.name, name, extra);
      for (let t = 0; t < teams.length; t++) {
        await unit(code + '-T' + (t + 1), 'Tổ ' + teams[t], 'TEAM', 5, code, site.code);
        if (legacy && t < 2) await label(code + '-T' + (t + 1), 'Tổ ' + (t + 1) + ' — Phân xưởng ' + code.slice(-1), 'Tổ ' + teams[t]);
      }
    }
  }
  const people = dataset();
  const present = await tx.employee.findMany({ where: { code: { in: people.map(p => p.code) } }, select: { id: true, code: true } });
  const existing = new Map(present.map(p => [p.code, p.id]));
  for (const person of people) if (existing.has(person.code) && existing.get(person.code) !== id('employee:' + person.code)) throw Error('Seed employee code is already owned by another record: ' + person.code);
  const fresh = people.filter(p => !existing.has(p.code));
  function employeeData(p) {
    return { id: id('employee:' + p.code), code: p.code, fullName: p.fullName, gender: p.gender, dob: p.dob, hireDate: p.hireDate, nationality: p.nationality, email: p.email, phone: p.phone, jobTitleId: titleId(id, p.job) };
  }
  if (fresh.length) await tx.employee.createMany({ data: fresh.map(employeeData) });
  const eligible = new Set(fresh.map(p => p.code));
  // Compare the whole original profile: an edited seed employee is user data too.
  for (const p of people.filter(p => p.legacy)) {
    const data = employeeData(p); delete data.id; delete data.code;
    const changed = await tx.employee.updateMany({ where: { id: id('employee:' + p.code), fullName: p.oldName, gender: 'OTHER', dob: date('1995-05-15'), hireDate: from,
      nationality: 'Việt Nam', email: null, phone: null, status: 'ACTIVE', terminationDate: null, jobTitleId: id('job:' + p.oldGrade) }, data });
    if (changed.count) eligible.add(p.code);
  }
  for (const [username, fullName, oldName] of operators) await tx.userAccount.updateMany({ where: { id: id('account:' + username), displayName: oldName }, data: { displayName: fullName + ' (giả lập)' } });
  const assignments = [], transfers = [];
  for (const p of fresh) {
    const effectiveFrom = p.hireDate > from ? p.hireDate : from;
    const dept = p.site.departments.find(d => d[0] === p.department);
    const moved = p.index % 97 === 0 && effectiveFrom < date('2026-07-01') && dept[3].length > 1 && /-T\d+$/.test(p.unit);
    const priorUnit = moved ? p.department + '-T' + (Number(p.unit.match(/-T(\d+)$/)[1]) % dept[3].length + 1) : p.unit;
    assignments.push({ id: id('assignment:' + p.code), employeeId: id('employee:' + p.code), orgUnitId: id('org:' + priorUnit), allocationRatio: '100', isPrimary: true, effectiveFrom, effectiveTo: moved ? date('2026-06-30') : null });
    if (moved) {
      assignments.push({ id: id('assignment:transfer:' + p.code), employeeId: id('employee:' + p.code), orgUnitId: id('org:' + p.unit), allocationRatio: '100', isPrimary: true, effectiveFrom: date('2026-07-01') });
      transfers.push({ id: id('transfer:' + p.code), employeeId: id('employee:' + p.code), fromOrgUnitId: id('org:' + priorUnit), toOrgUnitId: id('org:' + p.unit), effectiveFrom: date('2026-07-01'), decisionNumber: 'GL-QD-2026-' + p.code,
        decisionDate: date('2026-06-25'), reason: 'Giả lập: điều phối nhân lực giữa các tổ cùng phân xưởng theo kế hoạch sản xuất quý III.' });
    }
  }
  if (assignments.length) await tx.orgAssignment.createMany({ data: assignments });
  if (transfers.length) await tx.personnelTransfer.createMany({ data: transfers });
  const hasContracts = new Set((await tx.employmentContract.findMany({ where: { employeeId: { in: people.filter(p => eligible.has(p.code)).map(p => id('employee:' + p.code)) } }, select: { employeeId: true } })).map(c => c.employeeId));
  const parameters = await tx.legalParameter.findMany({ where: { subjectType: 'ALL', applicationBasis: 'WORK_DATE' }, orderBy: { effectiveFrom: 'desc' } });
  function parameter(code, p, asOf) {
    for (const scope of ['SITE:' + id('site:' + p.site.code), 'REGION:' + p.site.region, 'GLOBAL']) {
      const found = parameters.find(v => v.paramCode === code && v.scopeKey === scope && v.effectiveFrom <= asOf && (!v.effectiveTo || v.effectiveTo >= asOf));
      if (found) return new Decimal(String(found.value));
    }
    throw Error('Missing legal parameter for realistic seed: ' + code + ' / ' + p.site.code);
  }
  const contracts = [], annexes = [];
  for (const p of people) {
    if (!eligible.has(p.code) || hasContracts.has(id('employee:' + p.code))) continue;
    const startDate = p.hireDate > from ? p.hireDate : from;
    const type = p.probation ? 'PROBATION' : p.index % 5 === 0 ? 'INDEFINITE' : 'FIXED_TERM';
    const wage = parameter('MIN_WAGE_MONTH_' + p.site.region, p, startDate);
    const base = titles.find(t => t[0] === p.job)[4] + p.index % 9 * 250000;
    const official = Decimal.max(base, wage).toFixed(0);
    const salary = p.probation ? Decimal.max(wage, new Decimal(official).mul(parameter('PROBATION_MIN_RATIO', p, startDate))).ceil().toFixed(0) : official;
    const probationClass = p.job === 'JOB-F' || p.job === 'E7-KHO' ? 'WORKER' : 'TECHNICAL';
    let endDate = null;
    if (type === 'PROBATION') {
      const maximum = parameter('PROBATION_MAX_DAYS_' + probationClass, p, startDate).toNumber();
      endDate = new Date(startDate.getTime() + (Math.min(probationClass === 'WORKER' ? 30 : 60, maximum) - 1) * day);
    } else if (type === 'FIXED_TERM') {
      const minimum = parameter('FIXED_TERM_MIN_MONTHS', p, startDate).toNumber();
      const maximum = parameter('FIXED_TERM_MAX_MONTHS', p, startDate).toNumber();
      if (minimum > maximum) throw Error('Inconsistent fixed-term legal parameters');
      const months = Math.max(minimum, Math.min(maximum, p.index % 2 ? 12 : 24));
      endDate = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + months, startDate.getUTCDate()) - day);
    }
    const contract = { id: id('contract:realistic:' + p.code), employeeId: id('employee:' + p.code), number: 'GL-HD-2026-' + p.code, type, status: 'ACTIVE', startDate, endDate,
      signedDate: new Date(startDate.getTime() - 3 * day), salaryCipher: cipherText(key, salary), officialSalaryCipher: p.probation ? cipherText(key, official) : null,
      salaryBasis: 'MONTHLY', probationClass: p.probation ? probationClass : null,
      insuranceEligible: type === 'INDEFINITE' || (type === 'FIXED_TERM' && endDate >= new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + parameter('INSURANCE_MIN_CONTRACT_MONTHS', p, startDate).toNumber(), startDate.getUTCDate()) - day)) };
    contracts.push(contract);
    if (!p.probation && p.index % 67 === 0 && startDate <= date('2026-08-01')) annexes.push({ id: id('annex:realistic:' + p.code), contractId: contract.id, number: 'GL-PL-2026-' + p.code,
      effectiveFrom: date('2026-08-01'), signedDate: date('2026-07-28'), contentCipher: cipherText(key, 'Dữ liệu giả lập: xác nhận địa điểm làm việc và nhiệm vụ theo phân công hiện hành. Giữ nguyên mức lương của hợp đồng; không phải quyết định nhân sự thật.') });
    if (!p.probation && type === 'FIXED_TERM' && p.index % 41 === 0) {
      const nextStart = new Date(endDate.getTime() + day);
      contracts.push({ ...contract, id: id('contract:renewal:' + p.code), number: 'GL-HD-GIAHAN-' + p.code, status: 'DRAFT', startDate: nextStart,
        endDate: new Date(Date.UTC(nextStart.getUTCFullYear() + 1, nextStart.getUTCMonth(), nextStart.getUTCDate()) - day), signedDate: new Date(nextStart.getTime() - 7 * day) });
    }
  }
  if (contracts.length) await tx.employmentContract.createMany({ data: contracts });
  if (annexes.length) await tx.contractAnnex.createMany({ data: annexes });
  for (const site of sites) for (const month of [10, 11]) {
    const asOf = date(`2026-${month}-01`);
    const policy = await tx.sitePolicy.findFirst({ where: { orgUnitId: id('org:' + site.code), policyKey: 'CUTOFF_DAY', effectiveFrom: { lte: asOf }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }] } });
    if (!policy) throw Error('Missing cutoff policy for ' + site.code);
    const cutoff = m => new Date(Date.UTC(2026, m - 1, Math.min(policy.value, new Date(Date.UTC(2026, m, 0)).getUTCDate())));
    const dateFrom = new Date(cutoff(month - 1).getTime() + day), dateTo = cutoff(month);
    const overlap = await tx.businessPeriod.findFirst({ where: { scopeOrgUnitId: id('org:' + site.code), periodType: 'ATTENDANCE', dateFrom: { lte: dateTo }, dateTo: { gte: dateFrom } }, select: { id: true } });
    if (overlap) continue;
    const code = `GL-CC-2026-${month}-${site.prefix}`;
    if (await tx.businessPeriod.findUnique({ where: { code } })) continue;
    await tx.businessPeriod.create({ data: { id: id('period:realistic:' + code), code, scopeOrgUnitId: id('org:' + site.code), dateFrom, dateTo, cutoffDay: policy.value, cutoffPolicyId: policy.id,
      status: month === 10 ? 'OPEN' : 'PLANNED', revision: month === 10 ? 1 : 0, openedAt: month === 10 ? date(SNAPSHOT) : null } });
  }
  return { snapshot: SNAPSHOT, datasetEmployees: people.length, createdEmployees: fresh.length, enrichedEmployees: eligible.size - fresh.length, createdContracts: contracts.length, createdTransfers: transfers.length, createdAnnexes: annexes.length };
}
module.exports = { seedRealistic };
