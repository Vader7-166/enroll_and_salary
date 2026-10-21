const { seedHrSettings } = require("./seed-hr-settings.cjs");
const { seedRealistic } = require("./seed-realistic.cjs");
const { seedLeave } = require("./seed-leave.cjs");
const { PrismaClient } = require("@prisma/client");
const { createHash, randomBytes } = require("node:crypto");
const {
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
} = require("node:fs");
const { resolve, dirname } = require("node:path");
const { hashPassword } = require("../dist/auth/password.js");
if (existsSync(resolve(__dirname, "../.env")))
  process.loadEnvFile(resolve(__dirname, "../.env"));
const url = new URL(process.env.DATABASE_URL);
const statePath = resolve(__dirname, "../../.local/postgres.json");
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : null;
const managedDemo = state && url.port === String(state.port) && url.username === "hrtp_demo" && url.pathname === "/hrtp_demo";
if (
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  (!managedDemo && process.env.SEED_ALLOW_ISOLATED !== "true")
)
  throw new Error(
    "Seed requires the managed local demo database or explicit SEED_ALLOW_ISOLATED=true on an isolated local database.",
  );
const prisma = new PrismaClient();
const dataset = process.env.SEED_DATASET || "realistic";
if (!["realistic", "foundation"].includes(dataset)) throw new Error("SEED_DATASET must be realistic or foundation.");
const from = new Date("2026-01-01T00:00:00Z");
function id(key) {
  const bytes = createHash("sha256")
    .update("hrtp-demo:" + key)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString("hex");
  return (
    hex.slice(0, 8) +
    "-" +
    hex.slice(8, 12) +
    "-" +
    hex.slice(12, 16) +
    "-" +
    hex.slice(16, 20) +
    "-" +
    hex.slice(20)
  );
}
const definitions = [
  {
    username: "tt.bn",
    role: "TT",
    scope: "NM-BN-D1-T1",
    name: "Tổ trưởng mô phỏng Bắc Ninh",
    unit: "NM-BN-D1-T1",
  },
  {
    username: "qd.bn",
    role: "QD",
    scope: "NM-BN-D1",
    name: "Quản đốc mô phỏng Bắc Ninh",
    unit: "NM-BN-D1",
  },
  {
    username: "kt.all",
    role: "KT",
    scope: "COMPANY",
    name: "Kế toán mô phỏng toàn công ty",
    unit: "HQ-HN-D1",
  },
  {
    username: "kt.bn",
    role: "KT",
    scope: "NM-BN",
    name: "Kế toán mô phỏng Bắc Ninh",
    unit: "NM-BN-D1",
  },
  {
    username: "ad.demo",
    role: "AD",
    scope: "COMPANY",
    name: "Quản trị mô phỏng",
    unit: "HQ-HN-D2",
  },
];
const credentialsPath = resolve(
  process.env.DEMO_ACCOUNTS_FILE ||
    resolve(__dirname, "../../.local/demo-accounts.json"),
);
async function seed() {
  const existing = existsSync(credentialsPath)
    ? JSON.parse(readFileSync(credentialsPath, "utf8")).accounts
    : [];
  const credentials = definitions.map((d) => ({
    ...d,
    password:
      existing.find((a) => a.username === d.username)?.password ||
      randomBytes(18).toString("base64url"),
  }));
  for (const account of credentials) {
    if (
      !existing.some((a) => a.username === account.username) &&
      (await prisma.userAccount.findUnique({
        where: { username: account.username },
      }))
    )
      throw new Error(
        "Existing demo account has no local credential record; seed will not reset its password.",
      );
  }
  const passwords = new Map(
    await Promise.all(
      credentials.map(async (a) => [
        a.username,
        await hashPassword(a.password),
      ]),
    ),
  );
  let realisticSummary;
  await prisma.$transaction(
    async (tx) => {
      for (const [code, name] of [
        ["I", "Vùng I"],
        ["II", "Vùng II"],
        ["III", "Vùng III"],
        ["IV", "Vùng IV"],
      ])
        await tx.wageRegion.upsert({
          where: { code },
          update: {},
          create: { code, name },
        });
      const permissions = {
        TT: ["employee.read", "employee.history", "organization.read", "period.read", "shift.read", "shift.plan", "attendance.read", "attendance.explain", "attendance.confirm", "overtime.read", "overtime.plan", "leave.read", "leave.request", "leave.balance.read"],
        QD: ["employee.read", "employee.history", "organization.read", "period.read", "shift.read", "shift.approve", "attendance.read", "attendance.review", "overtime.read", "overtime.approve", "leave.read", "leave.balance.read"],
        KT: ["employee.read", "employee.create", "employee.history", "employee.transfer", "contract.read", "contract.manage", "organization.read", "period.read", "shift.read", "attendance.read", "attendance.lock", "overtime.read", "leave.read", "leave.balance.read", "leave.balance.manage"],
        AD: ["accounts.manage", "organization.read", "settings.manage", "period.manage", "period.read", "shift.read", "shift.manage", "attendance.read", "attendance.import", "leave.read", "leave.configure"],
      };
      for (const [code, name] of [
        ["TT", "Tổ trưởng"],
        ["QD", "Quản đốc"],
        ["KT", "Kế toán"],
        ["AD", "Quản trị hệ thống"],
      ])
        await tx.role.upsert({
          where: { code },
          update: { permissions: permissions[code] },
          create: { code, name, permissions: permissions[code] },
        });
      async function unit(code, name, type, level, parent, site) {
        await tx.orgUnit.upsert({
          where: { id: id("org:" + code) },
          update: {},
          create: { id: id("org:" + code), code },
        });
        await tx.orgUnitVersion.upsert({
          where: { id: id("version:" + code) },
          update: {},
          create: {
            id: id("version:" + code),
            orgUnitId: id("org:" + code),
            name,
            type,
            level,
            parentId: parent ? id("org:" + parent) : null,
            siteId: site ? id("site:" + site) : null,
            effectiveFrom: from,
          },
        });
      }
      await unit("COMPANY", "Công ty mô phỏng HRTP", "COMPANY", 1, null, null);
      for (const [code, name, region] of [
        ["HQ-HN", "Trụ sở Hà Nội", "I"],
        ["NM-BN", "Nhà máy Bắc Ninh", "I"],
        ["NM-HNA", "Nhà máy Hà Nam", "II"],
        ["NM-NA", "Nhà máy Nghệ An", "III"],
      ]) {
        await tx.site.upsert({
          where: { code },
          update: {},
          create: {
            id: id("site:" + code),
            code,
            name,
            address: "Địa chỉ mô phỏng — " + name,
            wageRegionCode: region,
          },
        });
        await unit(code, name, "SITE", 2, "COMPANY", code);
        await unit(
          code + "-BLOCK",
          "Khối vận hành — " + name,
          "BLOCK",
          3,
          code,
          code,
        );
        for (let d = 1; d <= 2; d++) {
          const department = code + "-D" + d;
          await unit(
            department,
            "Phân xưởng " + d + " — " + name,
            "DEPARTMENT",
            4,
            code + "-BLOCK",
            code,
          );
          for (let t = 1; t <= 2; t++)
            await unit(
              department + "-T" + t,
              "Tổ " + t + " — Phân xưởng " + d,
              "TEAM",
              5,
              department,
              code,
            );
        }
      }
      for (const [code, name, level] of [
        ["F", "Công nhân", 8],
        ["C", "Quản lý sản xuất", 5],
        ["A", "Chuyên viên", 4],
      ]) {
        await tx.jobGrade.upsert({
          where: { code },
          update: {},
          create: { id: id("grade:" + code), code, name },
        });
        await tx.jobTitle.upsert({
          where: { code: "JOB-" + code },
          update: {},
          create: {
            id: id("job:" + code),
            code: "JOB-" + code,
            name,
            jobLevel: level,
            jobGradeId: id("grade:" + code),
          },
        });
      }
      async function employee(code, name, unitCode, grade = "F") {
        await tx.employee.upsert({
          where: { code },
          update: {},
          create: {
            id: id("employee:" + code),
            code,
            fullName: name,
            gender: "OTHER",
            dob: new Date("1995-05-15T00:00:00Z"),
            hireDate: from,
            jobTitleId: id("job:" + grade),
          },
        });
        await tx.orgAssignment.upsert({
          where: { id: id("assignment:" + code) },
          update: {},
          create: {
            id: id("assignment:" + code),
            employeeId: id("employee:" + code),
            orgUnitId: id("org:" + unitCode),
            allocationRatio: "100",
            isPrimary: true,
            effectiveFrom: from,
          },
        });
      }
      for (const site of ["HQ-HN", "NM-BN", "NM-HNA", "NM-NA"])
        for (let d = 1; d <= 2; d++)
          for (let t = 1; t <= 2; t++)
            for (let n = 1; n <= 2; n++) {
              const code = site + "-D" + d + "-T" + t + "-NV" + n;
              await employee(
                code,
                "Nhân viên mô phỏng " + code,
                site + "-D" + d + "-T" + t,
              );
            }
      for (const account of credentials) {
        const code =
          "OP-" + account.username.toUpperCase().replaceAll(".", "-");
        await employee(
          code,
          account.name,
          account.unit,
          account.role === "TT" || account.role === "QD" ? "C" : "A",
        );
        await tx.userAccount.upsert({
          where: { username: account.username },
          update: {},
          create: {
            id: id("account:" + account.username),
            username: account.username,
            displayName: account.name,
            passwordHash: passwords.get(account.username),
            employeeId: id("employee:" + code),
          },
        });
        await tx.roleAssignment.upsert({
          where: { id: id("role:" + account.username) },
          update: {},
          create: {
            id: id("role:" + account.username),
            userAccountId: id("account:" + account.username),
            roleCode: account.role,
            scopeOrgUnitId: id("org:" + account.scope),
            effectiveFrom: from,
          },
        });
      }
      await employee(
        "VIP-DEMO",
        "Hồ sơ mô phỏng giới hạn truy cập",
        "HQ-HN-D2",
        "A",
      );
      await tx.employeeExclusion.upsert({
        where: { id: id("exclusion:vip") },
        update: {},
        create: {
          id: id("exclusion:vip"),
          userAccountId: id("account:kt.all"),
          employeeId: id("employee:VIP-DEMO"),
          effectiveFrom: from,
        },
      });
      await seedHrSettings(tx, id, from);
      await seedLeave(tx, id("org:COMPANY"), from);
      if (dataset === "realistic") realisticSummary = await seedRealistic(tx, id, from);
    },
    { timeout: 60000 },
  );
  mkdirSync(dirname(credentialsPath), { recursive: true });
  if (!existsSync(credentialsPath))
    writeFileSync(
      credentialsPath,
      JSON.stringify(
        { context: "ACADEMIC_SIMULATION", accounts: credentials },
        null,
        2,
      ),
      { flag: "wx", mode: 0o600 },
    );
  if (realisticSummary) console.log("Fictional enterprise snapshot: " + JSON.stringify(realisticSummary));
  console.log(
    "Seed complete: four sites, four roles, five demo accounts; " +
      (await prisma.employee.count()) + " employees currently stored. Credentials: " + credentialsPath,
  );
}
seed()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
