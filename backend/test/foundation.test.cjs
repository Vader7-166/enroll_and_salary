const { test } = require("node:test");
const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
const { randomUUID, createHash } = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const { resolve } = require("node:path");
const { readFileSync, rmSync } = require("node:fs");
const net = require("node:net");

process.loadEnvFile(resolve(__dirname, "../.env"));
const backend = resolve(__dirname, "..");
const root = resolve(backend, "..");

test(
  "Foundation against a fresh PostgreSQL database and real HTTP server",
  { timeout: 120000 },
  async (t) => {
    const name = "hrtp_verify_" + randomUUID().replaceAll("-", "");
    const baseUrl = new URL(process.env.DATABASE_URL);
    assert.ok(
      ["localhost", "127.0.0.1"].includes(baseUrl.hostname),
      "Verification must stay on a local database",
    );
    const admin = new PrismaClient();
    const url = new URL(baseUrl);
    url.pathname = "/" + name;
    const credentialsPath = resolve(root, ".local", name + ".json");
    const env = {
      ...process.env,
      DATABASE_URL: url.href,
      SEED_ALLOW_ISOLATED: "true",
      SEED_DATASET: "foundation",
      DEMO_ACCOUNTS_FILE: credentialsPath,
    };
    let server;
    let db;
    try {
      await admin.$executeRawUnsafe('CREATE DATABASE "' + name + '"');
      for (const args of [
        [
          resolve(root, "node_modules/prisma/build/index.js"),
          "migrate",
          "deploy",
        ],
        ["prisma/seed.cjs"],
        ["prisma/seed.cjs"],
      ]) {
        const result = spawnSync(process.execPath, args, {
          cwd: backend,
          env,
          encoding: "utf8",
          timeout: 30000,
        });
        assert.equal(result.status, 0, result.stderr + " " + result.stdout);
      }
      db = new PrismaClient({ datasourceUrl: url.href });
      const credentials = JSON.parse(
        readFileSync(credentialsPath, "utf8"),
      ).accounts;
      const listener = net.createServer();
      await new Promise((r) => listener.listen(0, "127.0.0.1", r));
      const port = listener.address().port;
      await new Promise((r) => listener.close(r));
      server = spawn(process.execPath, ["dist/main.js"], {
        cwd: backend,
        env: { ...env, PORT: String(port) },
        stdio: ["ignore", "pipe", "pipe"],
      });
      await new Promise((resolveReady, reject) => {
        let logs = "";
        const timeout = setTimeout(
          () => reject(new Error("API readiness timeout: " + logs)),
          15000,
        );
        server.stdout.on("data", (chunk) => {
          logs += chunk;
          if (logs.includes("API ready at")) {
            clearTimeout(timeout);
            resolveReady();
          }
        });
        server.stderr.on("data", (chunk) => {
          logs += chunk;
        });
        server.once("exit", (code) => {
          clearTimeout(timeout);
          reject(new Error("API exited " + code + ": " + logs));
        });
      });
      async function request(path, cookie, body, extra = {}) {
        const response = await fetch(
          "http://127.0.0.1:" + port + "/api" + path,
          {
            method: body === undefined ? "GET" : "POST",
            headers: {
              ...(cookie ? { cookie } : {}),
              ...(body !== undefined
                ? { "Content-Type": "application/json" }
                : {}),
              ...extra,
            },
            body: body === undefined ? undefined : JSON.stringify(body),
          },
        );
        return {
          status: response.status,
          body: await response.json(),
          cookie: response.headers.get("set-cookie"),
        };
      }
      async function login(username) {
        const account = credentials.find((a) => a.username === username);
        const result = await request("/auth/login", null, {
          username,
          password: account.password,
        });
        assert.equal(result.status, 201, JSON.stringify(result.body));
        return { ...result, cookie: result.cookie.split(";")[0] };
      }
      let tt, qd, kt, ktbn, ad;
      tt = await login("tt.bn");
      qd = await login("qd.bn");
      kt = await login("kt.all");
      ktbn = await login("kt.bn");
      ad = await login("ad.demo");
      await t.test(
        "Opaque session cookie authenticates; PostgreSQL stores only its digest",
        async () => {
          const account = credentials.find((a) => a.username === "tt.bn");
          const result = await request("/auth/login", null, {
            username: account.username,
            password: account.password,
          });
          assert.equal(result.status, 201);
          assert.match(result.cookie, /HttpOnly/);
          assert.match(result.cookie, /SameSite=Strict/);
          assert.match(result.cookie, /Path=\/api/);
          const token = result.cookie.split(";")[0].split("=")[1];
          const row = await db.webSession.findUnique({
            where: {
              tokenHash: createHash("sha256").update(token).digest("hex"),
            },
          });
          assert.equal(row.userAccountId, tt.body.user.id);
          assert.notEqual(row.tokenHash, token);
          assert.equal(
            (await request("/auth/me", result.cookie.split(";")[0])).body.user
              .username,
            "tt.bn",
          );
          assert.equal((await request("/employees")).status, 401);
        },
      );
      await t.test(
        "TT team, QD department, KT site and KT company enforce distinct scopes",
        async () => {
          const totals = [];
          for (const user of [tt, qd, ktbn, kt])
            totals.push(
              (await request("/employees?pageSize=100", user.cookie)).body
                .total,
            );
          assert.deepEqual(totals, [3, 7, 11, 37]);
          const rows = (await request("/employees", tt.cookie)).body.items
            .map((e) => e.code)
            .sort();
          assert.deepEqual(rows, [
            "NM-BN-D1-T1-NV1",
            "NM-BN-D1-T1-NV2",
            "OP-TT-BN",
          ]);
          const hidden = await db.employee.findUnique({
            where: { code: "HQ-HN-D1-T1-NV1" },
          });
          assert.deepEqual(
            (await request("/employees/" + hidden.id, tt.cookie)).body,
            { employee: null },
          );
          assert.deepEqual(
            (await request("/employees/" + randomUUID(), tt.cookie)).body,
            { employee: null },
          );
          assert.equal(
            (await request("/employees?search=HQ-HN", tt.cookie)).body.total,
            0,
          );
          const vip = await db.employee.findUnique({
            where: { code: "VIP-DEMO" },
          });
          assert.deepEqual(
            (await request("/employees/" + vip.id, kt.cookie)).body,
            { employee: null },
          );
          assert.equal(
            (await request("/employees?search=VIP-DEMO", kt.cookie)).body.total,
            0,
          );
          assert.equal((await request("/employees", ad.cookie)).status, 403);
        },
      );
      const target = await db.orgUnit.findUnique({
        where: { code: "NM-BN-D1-T1" },
      });
      const foreign = await db.orgUnit.findUnique({
        where: { code: "NM-NA-D1-T1" },
      });
      const input = {
        code: "VERIFY-NEW",
        fullName: "Nhân viên kiểm chứng",
        gender: "OTHER",
        dob: "1999-01-01",
        hireDate: "2026-01-01",
        orgUnitId: target.id,
      };
      await t.test(
        "KT creates durable employee; invalid, duplicate and unauthorized writes are rejected",
        async () => {
          assert.equal(
            (await request("/employees", tt.cookie, input)).status,
            403,
          );
          assert.equal(
            (await request("/employees", qd.cookie, input)).status,
            403,
          );
          assert.equal(
            (await request("/employees", ad.cookie, input)).status,
            403,
          );
          assert.equal(
            (
              await request("/employees", ktbn.cookie, {
                ...input,
                orgUnitId: foreign.id,
              })
            ).status,
            403,
          );
          assert.equal(
            (
              await request("/employees", ktbn.cookie, {
                ...input,
                dob: "1999-02-30",
              })
            ).status,
            400,
          );
          assert.equal(
            (
              await request("/employees", ktbn.cookie, {
                ...input,
                bankAccountNo: "not-accepted",
              })
            ).status,
            400,
          );
          const result = await request("/employees", ktbn.cookie, input);
          assert.equal(result.status, 201, JSON.stringify(result.body));
          const row = await db.employee.findUnique({
            where: { code: input.code },
            include: { assignments: true },
          });
          assert.equal(row.fullName, input.fullName);
          assert.equal(row.assignments[0].orgUnitId, target.id);
          assert.equal(row.assignments[0].allocationRatio.toString(), "100");
          const reloaded = await login("kt.bn");
          assert.equal(
            (await request("/employees/" + row.id, reloaded.cookie)).body
              .employee.code,
            input.code,
          );
          assert.equal(
            (await request("/employees", ktbn.cookie, input)).status,
            409,
          );
        },
      );
      await t.test("Cross-origin browser writes are denied", async () => {
        assert.equal(
          (
            await request(
              "/employees",
              ktbn.cookie,
              { ...input, code: "VERIFY-CSRF" },
              { Origin: "https://untrusted.invalid" },
            )
          ).status,
          403,
        );
        assert.equal(
          await db.employee.count({ where: { code: "VERIFY-CSRF" } }),
          0,
        );
      });
      await t.test(
        "Multi-role union does not extend HR scope through an admin assignment",
        async () => {
          const company = await db.orgUnit.findUnique({
            where: { code: "COMPANY" },
          });
          const assignment = await db.roleAssignment.create({
            data: {
              userAccountId: ktbn.body.user.id,
              roleCode: "AD",
              scopeOrgUnitId: company.id,
              effectiveFrom: new Date("2026-01-01"),
            },
          });
          try {
            const list = await request("/employees?pageSize=100", ktbn.cookie);
            assert.equal(list.body.total, 12);
            assert.ok(
              list.body.items.every((e) => e.orgUnit.site.code === "NM-BN"),
            );
          } finally {
            await db.roleAssignment.delete({ where: { id: assignment.id } });
          }
        },
      );
      await t.test(
        "Site admin cannot list or revoke company-wide accounts",
        async () => {
          const bn = await db.orgUnit.findUnique({ where: { code: "NM-BN" } });
          const source = await db.userAccount.findUnique({
            where: { username: "ad.demo" },
          });
          await db.userAccount.create({
            data: {
              username: "ad.site",
              displayName: "Site admin verification",
              passwordHash: source.passwordHash,
              assignments: {
                create: {
                  roleCode: "AD",
                  scopeOrgUnitId: bn.id,
                  effectiveFrom: new Date("2026-01-01"),
                },
              },
            },
          });
          const result = await request("/auth/login", null, {
            username: "ad.site",
            password: credentials.find((a) => a.username === "ad.demo")
              .password,
          });
          assert.equal(result.status, 201);
          const cookie = result.cookie.split(";")[0];
          const accounts = (await request("/auth/accounts", cookie)).body.items;
          assert.deepEqual(accounts.map((a) => a.username).sort(), [
            "ad.site",
            "kt.bn",
            "qd.bn",
            "tt.bn",
          ]);
          assert.equal(
            (
              await request(
                "/auth/accounts/" + kt.body.user.id + "/revoke",
                cookie,
                {},
              )
            ).status,
            404,
          );
          assert.equal((await request("/auth/me", kt.cookie)).status, 200);
        },
      );
      await t.test(
        "Revocation and logout invalidate cookies on the next request",
        async () => {
          assert.equal(
            (
              await request(
                "/auth/accounts/" + tt.body.user.id + "/revoke",
                ad.cookie,
                {},
              )
            ).status,
            201,
          );
          assert.equal((await request("/auth/me", tt.cookie)).status, 401);
          assert.equal(
            (await request("/auth/logout", qd.cookie, {})).status,
            201,
          );
          assert.equal((await request("/auth/me", qd.cookie)).status, 401);
        },
      );
      await t.test(
        "Expired assignment and disabled account take effect without a new login",
        async () => {
          const assignment = await db.roleAssignment.findFirst({
            where: { userAccountId: ktbn.body.user.id, roleCode: "KT" },
          });
          await db.roleAssignment.update({
            where: { id: assignment.id },
            data: { effectiveTo: new Date("2026-01-02") },
          });
          assert.equal((await request("/employees", ktbn.cookie)).status, 403);
          await db.roleAssignment.update({
            where: { id: assignment.id },
            data: { effectiveTo: null },
          });
          await db.userAccount.update({
            where: { id: ktbn.body.user.id },
            data: { status: "DISABLED" },
          });
          assert.equal((await request("/employees", ktbn.cookie)).status, 403);
          await db.userAccount.update({
            where: { id: ktbn.body.user.id },
            data: { status: "ACTIVE" },
          });
        },
      );
      await t.test(
        "Idle and absolute session expiry reject old cookies",
        async () => {
          for (const absolute of [false, true]) {
            const user = await login("kt.bn");
            const now = Date.now();
            await db.webSession.updateMany({
              where: {
                tokenHash: createHash("sha256")
                  .update(user.cookie.split("=")[1])
                  .digest("hex"),
              },
              data: {
                createdAt: new Date(now - 36000000),
                lastSeenAt: new Date(now - 32400000),
                expiresAt: new Date(now - 1),
                absoluteExpiresAt: new Date(absolute ? now - 1 : now + 3600000),
              },
            });
            assert.equal((await request("/auth/me", user.cookie)).status, 401);
          }
        },
      );
      await t.test(
        "Five concurrent bad passwords lock the account",
        async () => {
          const results = await Promise.all(
            Array.from({ length: 5 }, () =>
              request("/auth/login", null, {
                username: "tt.bn",
                password: "incorrect-password",
              }),
            ),
          );
          assert.ok(results.every((r) => r.status === 401));
          const row = await db.userAccount.findUnique({
            where: { username: "tt.bn" },
          });
          assert.equal(row.failedLogins, 5);
          assert.ok(row.lockedUntil > new Date());
          const result = await request("/auth/login", null, {
            username: "tt.bn",
            password: credentials.find((a) => a.username === "tt.bn").password,
          });
          assert.equal(result.status, 401);
        },
      );
      await t.test("Audit history cannot be updated or deleted", async () => {
        const row = await db.auditLog.findFirst({ orderBy: { id: "asc" } });
        await assert.rejects(
          db.auditLog.update({
            where: { id: row.id },
            data: { result: "TAMPERED" },
          }),
        );
        await assert.rejects(db.auditLog.delete({ where: { id: row.id } }));
        assert.equal(
          (await db.auditLog.findUnique({ where: { id: row.id } })).recordHash,
          row.recordHash,
        );
      });
      await t.test("Realistic reseeding preserves edited people, user contracts, assignments and credentials", async () => {
        const edited = await db.employee.update({ where: { code: "NM-BN-D1-T1-NV1" }, data: { fullName: "Hồ sơ đã được người dùng chỉnh sửa", email: "preserve@example.invalid" } });
        const custom = await db.employee.findUniqueOrThrow({ where: { code: "VERIFY-NEW" } });
        const accountBefore = await db.userAccount.findMany({ select: { id: true, passwordHash: true, status: true }, orderBy: { id: "asc" } });
        const scopesBefore = await db.roleAssignment.findMany({ orderBy: { id: "asc" } });
        const credentialsBefore = readFileSync(credentialsPath, "utf8");
        const reader = await login("kt.bn");
        const created = await request("/employees/" + custom.id + "/contracts", reader.cookie, { number: "USER-PRESERVED", type: "INDEFINITE", startDate: "2026-01-01", signedDate: "2026-01-01", salary: "9500000", salaryBasis: "MONTHLY" });
        assert.equal(created.status, 201, JSON.stringify(created.body));
        const userContract = await db.employmentContract.findUniqueOrThrow({ where: { id: created.body.contract.id } });
        function seedRealistic() {
          const result = spawnSync(process.execPath, ["prisma/seed.cjs"], { cwd: backend, env: { ...env, SEED_DATASET: "realistic" }, encoding: "utf8", timeout: 60000 });
          assert.equal(result.status, 0, result.stderr + result.stdout);
        }
        seedRealistic();
        assert.deepEqual(await db.employee.findUnique({ where: { id: edited.id } }), edited);
        assert.deepEqual(await db.employee.findUnique({ where: { id: custom.id } }), custom);
        assert.deepEqual(await db.employmentContract.findUnique({ where: { id: userContract.id } }), userContract);
        const generated = await db.employee.findUniqueOrThrow({ where: { code: "BN00002" } });
        const contracts = await request("/employees/" + generated.id + "/contracts", reader.cookie);
        assert.equal(contracts.status, 200); const active = contracts.body.items.find(c => c.status === "ACTIVE");
        assert.equal(active.salaryBasis, "MONTHLY");
        assert.ok(Number(active.salary) >= 5310000);
        const beforeDay = (await request("/employees/" + generated.id + "/assignments?asOf=2026-08-31", reader.cookie)).body.currentOrgUnitId;
        const move = await request("/employees/" + generated.id + "/transfers", reader.cookie, { toOrgUnitId: target.id, effectiveFrom: "2026-09-01", decisionNumber: "USER-MOVE", decisionDate: "2026-08-28", reason: "Điều chuyển do người dùng nhập" });
        assert.equal(move.status, 201, JSON.stringify(move.body));
        const assignmentsBefore = await db.orgAssignment.findMany({ where: { employeeId: generated.id }, orderBy: { effectiveFrom: "asc" } });
        const contractsBefore = await db.employmentContract.findMany({ orderBy: { id: "asc" } });
        await db.employee.update({ where: { id: generated.id }, data: { fullName: "Nhân sự được sửa sau lần seed đầu" } });
        seedRealistic();
        assert.equal((await db.employee.findUnique({ where: { id: generated.id } })).fullName, "Nhân sự được sửa sau lần seed đầu");
        assert.deepEqual(await db.orgAssignment.findMany({ where: { employeeId: generated.id }, orderBy: { effectiveFrom: "asc" } }), assignmentsBefore);
        assert.deepEqual(await db.employmentContract.findMany({ orderBy: { id: "asc" } }), contractsBefore);
        assert.deepEqual(await db.userAccount.findMany({ select: { id: true, passwordHash: true, status: true }, orderBy: { id: "asc" } }), accountBefore);
        assert.deepEqual(await db.roleAssignment.findMany({ orderBy: { id: "asc" } }), scopesBefore);
        assert.equal(readFileSync(credentialsPath, "utf8"), credentialsBefore);
        assert.equal((await request("/employees/" + generated.id + "/assignments?asOf=2026-08-31", reader.cookie)).body.currentOrgUnitId, beforeDay);
        assert.equal((await request("/employees/" + generated.id + "/assignments?asOf=2026-09-01", reader.cookie)).body.currentOrgUnitId, target.id);
        assert.equal((await request("/employees/" + generated.id + "/contracts", ad.cookie)).status, 403);
      });
    } finally {
      if (server && server.exitCode === null) {
        const stopped = new Promise((r) => server.once("exit", r));
        server.kill();
        await stopped;
      }
      if (db) await db.$disconnect();
      await admin.$executeRawUnsafe(
        'DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)',
      );
      await admin.$disconnect();
      rmSync(credentialsPath, { force: true });
    }
  },
);
