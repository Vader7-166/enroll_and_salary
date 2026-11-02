const { Prisma } = require("@prisma/client");

const TYPES = [
  ["ANNUAL", "Nghỉ hằng năm", true, true, true, true, false, false, null, "P"],
  ["UNPAID", "Nghỉ không lương", true, false, false, false, false, true, null, "KL"],
  ["COMPENSATORY", "Nghỉ bù", true, true, true, false, false, false, null, "NB"],
  ["SICK", "Nghỉ ốm", true, false, false, false, true, true, null, "OM"],
  ["CHILD_SICK", "Nghỉ chăm con ốm", true, false, false, false, true, true, null, "CO"],
  ["MATERNITY", "Nghỉ thai sản", true, false, false, false, true, true, null, "TS"],
  ["PRENATAL", "Nghỉ khám thai", true, false, false, false, true, true, "5.00", "KT"],
  ["RECOVERY", "Nghỉ dưỡng sức", true, false, false, false, true, true, null, "DS"],
  ["WORK_ACCIDENT", "Nghỉ tai nạn lao động", true, false, false, false, true, true, null, "TNL"],
  ["MARRIAGE", "Nghỉ kết hôn", true, true, true, false, false, true, "3.00", "KH"],
  ["BEREAVEMENT", "Nghỉ việc riêng có lương", true, true, true, false, false, true, "3.00", "VR"],
  ["PERSONAL", "Nghỉ việc riêng", true, false, false, false, false, true, null, "VR"],
  ["COMPANY", "Nghỉ theo chính sách công ty", true, true, true, false, false, false, null, "CT"],
];

async function seedLeave(tx, unitId, effectiveFrom) {
  const policy = await tx.leavePolicy.findUnique({ where: { orgUnitId: unitId } });
  if (!policy) {
    await tx.leavePolicy.create({
      data: {
        orgUnitId: unitId,
        revision: 1,
        versions: { create: {
          name: "Chính sách phép năm mặc định", normalDays: 12, hazardousDays: 14, extremeDays: 16,
          carryLimitDays: new Prisma.Decimal("5.00"), carryExpiryMonth: 3, carryExpiryDay: 31,
          advanceLimitDays: new Prisma.Decimal("3.00"), status: "SIMULATION", decisionReference: "DEC03",
          reason: "Thiết lập dữ liệu nền", effectiveFrom, createdById: null,
        } },
      },
    });
  }
  for (const [code, name, active, isPaid, countsAsWorkday, deductsAnnualQuota, siPaid, requiresDocument, maxDays, attendanceSymbol] of TYPES) {
    const existing = await tx.leaveType.findUnique({ where: { orgUnitId_code: { orgUnitId: unitId, code } } });
    if (existing) continue;
    await tx.leaveType.create({
      data: {
        orgUnitId: unitId, code, revision: 1,
        versions: { create: {
          name, active, isPaid, countsAsWorkday, deductsAnnualQuota, siPaid, requiresDocument,
          maxDays: maxDays ? new Prisma.Decimal(maxDays) : null, attendanceSymbol,
          status: "SIMULATION", decisionReference: "DEC03", reason: "Thiết lập dữ liệu nền", effectiveFrom, createdById: null,
        } },
      },
    });
  }
}

module.exports = { seedLeave };
