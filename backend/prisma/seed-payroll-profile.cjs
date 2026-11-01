const { createHash, randomUUID } = require('node:crypto');
const { blindIndex, cipherText } = require('../dist/common/data-crypto.js');

const BANKS = ['VCB', 'BIDV', 'CTG', 'AGR', 'TCB', 'MB'];
const date = text => new Date(text + 'T00:00:00.000Z');
// Deterministic fictional identifiers derived from the employee code; never real people.
function digits(code, salt, length) {
  const hex = createHash('sha256').update(salt + ':' + code).digest('hex');
  return BigInt('0x' + hex).toString().slice(0, length).padStart(length, '0');
}

/** Payroll/tax profile for a slice of realistic demo employees, labelled SIMULATION (FR-2.1.1/2/4). */
async function seedPayrollProfiles(tx, limit = 40) {
  const keyText = process.env.HR_DATA_KEY || '';
  const key = Buffer.from(keyText, 'base64');
  if (key.length !== 32) throw Error('Payroll profile seed requires the 32-byte HR_DATA_KEY.');
  const people = await tx.employee.findMany({ where: { contracts: { some: { status: 'ACTIVE' } }, identity: null }, orderBy: { code: 'asc' }, take: limit, select: { id: true, code: true, fullName: true, gender: true, hireDate: true, dob: true } });
  let created = 0;
  for (const [index, person] of people.entries()) {
    const idNumber = '0' + digits(person.code, 'cccd', 11), taxCode = '8' + digits(person.code, 'mst', 9), siBook = '01' + digits(person.code, 'bhxh', 8);
    const account = digits(person.code, 'account', 12), bankCode = BANKS[index % BANKS.length];
    const from = person.hireDate > date('2026-01-01') ? person.hireDate : date('2026-01-01');
    await tx.employeeIdentity.create({ data: {
      employeeId: person.id, documentType: 'CCCD', idNumberCipher: cipherText(key, idNumber), idNumberHash: blindIndex(key, 'ID_NUMBER', idNumber),
      taxCodeCipher: cipherText(key, taxCode), taxCodeHash: blindIndex(key, 'TAX_CODE', taxCode), siBookCipher: cipherText(key, siBook), siBookHash: blindIndex(key, 'SI_BOOK', siBook),
      emergencyContactName: 'Người liên hệ mô phỏng', emergencyContactPhone: '09' + digits(person.code, 'phone', 8), emergencyContactRelation: 'Gia đình',
      documentReference: 'SIM-HS-' + person.code, dataStatus: 'SIMULATION',
    } });
    await tx.employeeIdentityHistory.create({ data: { employeeId: person.id, revision: 1, snapshot: { seeded: true, dataStatus: 'SIMULATION' }, reason: 'Seed hồ sơ lương mô phỏng' } });
    await tx.employeeBankAccount.create({ data: { employeeId: person.id, bankCode, accountNumberCipher: cipherText(key, account), accountNumberHash: blindIndex(key, 'BANK_ACCOUNT', bankCode + ':' + account), accountHolder: person.fullName.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toUpperCase(), reason: 'Seed tài khoản nhận lương mô phỏng', dataStatus: 'SIMULATION', effectiveFrom: from } });
    await tx.taxProfile.create({ data: { employeeId: person.id, residency: 'RESIDENT', finalizationAuthorized: index % 2 === 0, reason: 'Seed hồ sơ thuế mô phỏng', dataStatus: 'SIMULATION', effectiveFrom: from } });
    if (person.gender === 'FEMALE') await tx.employeeSpecialStatus.create({ data: { employeeId: person.id, statusType: 'FEMALE', reference: 'Hồ sơ nhân sự', reason: 'Seed diện lao động nữ', dataStatus: 'SIMULATION', effectiveFrom: from } });
    if (index % 4 === 0) await tx.employeeSpecialStatus.create({ data: { employeeId: person.id, statusType: 'VOCATIONAL_TRAINED', reference: 'Chứng chỉ nghề mô phỏng ' + person.code, reason: 'Seed lao động qua đào tạo nghề', dataStatus: 'SIMULATION', effectiveFrom: from } });
    if (index % 3 === 0) await tx.employeeDependent.create({ data: { employeeId: person.id, dependentKey: randomUUID(), version: 1, fullName: 'Con mô phỏng của ' + person.code, relationship: 'Con', deductionFromMonth: '2026-01', evidenceReference: 'Giấy khai sinh mô phỏng ' + person.code, reason: 'Seed người phụ thuộc mô phỏng', dataStatus: 'SIMULATION' } });
    created += 1;
  }
  return created;
}
module.exports = { seedPayrollProfiles };
