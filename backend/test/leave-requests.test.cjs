const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const { readFileSync, rmSync } = require('node:fs');
const net = require('node:net');
const { businessDate } = require('../dist/auth/business-date');
process.loadEnvFile(resolve(__dirname, '../.env'));
const root = resolve(__dirname, '../..'), backend = resolve(root, 'backend');
const today = businessDate();
const date = value => new Date(value + 'T00:00:00.000Z');

test('Leave requests: isolated PostgreSQL and real HTTP', { timeout: 180000 }, async t => {
  const name = 'hrtp_leave_requests_' + randomUUID().replaceAll('-', '');
  const base = new URL(process.env.DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1'].includes(base.hostname));
  const admin = new PrismaClient(), url = new URL(base); url.pathname = '/' + name;
  const credentialsPath = resolve(root, '.local', name + '.json');
  const env = { ...process.env, DATABASE_URL: url.href, SEED_ALLOW_ISOLATED: 'true', SEED_DATASET: 'foundation', DEMO_ACCOUNTS_FILE: credentialsPath };
  let db, server, logs = '';
  try {
    await admin.$executeRawUnsafe('CREATE DATABASE "' + name + '"');
    for (const args of [[resolve(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], ['prisma/seed.cjs']]) {
      const result = spawnSync(process.execPath, args, { cwd: backend, env, encoding: 'utf8', timeout: 45000 });
      assert.equal(result.status, 0, result.stderr + result.stdout);
    }
    db = new PrismaClient({ datasourceUrl: url.href });
    // Fixture history predates the seed's 2026 organization; expand its valid coverage atomically.
    await db.$transaction(async tx => {
      await tx.orgUnitVersion.updateMany({ data: { effectiveFrom: date('2020-01-01') } });
      await tx.roleAssignment.updateMany({ data: { effectiveFrom: date('2020-01-01') } });
    });
    const credentials = JSON.parse(readFileSync(credentialsPath, 'utf8')).accounts;
    const listener = net.createServer();
    await new Promise(done => listener.listen(0, '127.0.0.1', done));
    const port = listener.address().port; await new Promise(done => listener.close(done));
    server = spawn(process.execPath, ['dist/main.js'], { cwd: backend, env: { ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stdout.on('data', chunk => { logs += chunk; }); server.stderr.on('data', chunk => { logs += chunk; });
    await new Promise((ready, reject) => {
      let finished = false;
      const timeout = setTimeout(() => { finished = true; reject(new Error(logs)); }, 20000);
      server.once("exit", code => { finished = true; clearTimeout(timeout); reject(new Error("API exited " + code + "\n" + logs)); });
      const poll = async () => { if (finished) return; try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) { finished = true; clearTimeout(timeout); ready(); return; } } catch {} if (!finished) setTimeout(poll, 100); }; poll();
    });
    async function request(path, cookie, body) {
      const response = await fetch(`http://127.0.0.1:${port}/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
    }
    async function ok(path, cookie, body) {
      const result = await request(path, cookie, body);
      assert.ok(result.status >= 200 && result.status < 300, JSON.stringify(result) + (result.status >= 500 ? '\n' + logs : ''));
      return result.body;
    }
    const login = async username => { const a=credentials.find(a=>a.username===username);return (await request('/auth/login',null,{username,password:a.password})).cookie; };
    const [tt,qd,kt,ad]=await Promise.all(['tt.bn','qd.bn','kt.all','ad.demo'].map(login));
    const leader=await db.userAccount.findUniqueOrThrow({where:{username:'tt.bn'}});
    const team=await db.orgUnit.findUniqueOrThrow({where:{code:'NM-BN-D1-T1'}});
    const company=await db.orgUnit.findUniqueOrThrow({where:{code:'COMPANY'}});
    const person=await db.employee.create({data:{code:'REQUEST-MAIN',fullName:'Nhân sự kiểm chứng đơn nghỉ',gender:'FEMALE',dob:date('1990-01-01'),hireDate:date('2020-01-01'),assignments:{create:{orgUnitId:team.id,effectiveFrom:date('2020-01-01'),allocationRatio:'100',isPrimary:true}}}});
    const shift=await db.shiftDefinition.create({data:{orgUnitId:team.id,code:'REQUEST_DAY',name:'Ca kiểm chứng',kind:'DAY',startTime:'08:00',endTime:'17:00',crossesMidnight:false,breakStartOffset:240,breakMinutes:60,paidBreak:false,workMinutes:480,isNightShift:false}});
    const plan=await db.shiftPlan.create({data:{teamOrgUnitId:team.id,title:'Lịch kiểm chứng đơn nghỉ',status:'APPROVED',createdById:leader.id}});
    const days=['2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06'];
    for(const day of days) await db.shiftSchedule.create({data:{planId:plan.id,employeeId:person.id,workDate:date(day),shiftId:shift.id,startAt:new Date(day+'T08:00:00+07:00'),endAt:new Date(day+'T17:00:00+07:00'),workMinutes:480}});
    const leaveType=await db.leaveType.findUniqueOrThrow({where:{orgUnitId_code:{orgUnitId:company.id,code:'UNPAID'}}});
    const base={employeeId:person.id,leaveTypeId:leaveType.id,dateFrom:days[0],dateTo:days[0],unit:"DAY",reason:"Nghỉ giải quyết việc gia đình",documentReference:"Đơn giấy số 123"};
    let draft;
    await t.test('TT creates, edits and submits without changing funds or attendance',async()=>{
      const before=await db.leaveLedgerEntry.count(), attendance=await db.dailyAttendance.count();
      draft=(await ok('/leave/requests',tt,base)).item;
      assert.equal(draft.status,'DRAFT');assert.equal(draft.preview.totalDays,'1.00');assert.equal(draft.preview.totalMinutes,480);
      const changed=(await ok('/leave/requests/'+draft.id+'/update',tt,{...base,unit:'HALF',half:'FIRST',revision:draft.revision})).item;
      assert.equal(changed.preview.totalDays,'0.50');assert.equal(changed.preview.totalMinutes,240);
      assert.equal((await request('/leave/requests/'+draft.id+'/update',tt,{...base,revision:draft.revision})).status,409);
      const sent=(await ok('/leave/requests/'+draft.id+'/submit',tt,{revision:changed.revision})).item;
      assert.equal(sent.status,'PENDING');assert.equal(sent.revision,3);
      assert.equal((await request('/leave/requests/'+draft.id+'/update',tt,{...base,revision:sent.revision})).status,409);
      assert.equal((await request('/leave/requests/'+draft.id+'/submit',tt,{revision:sent.revision})).status,409);
      const detail=await ok('/leave/requests/'+draft.id,tt);
      assert.deepEqual(detail.history.map(h=>h.action),['CREATE','UPDATE','SUBMIT']);
      assert.equal(detail.history[0].snapshot.preview.totalDays,'1.00');
      assert.equal(await db.leaveLedgerEntry.count(),before);assert.equal(await db.dailyAttendance.count(),attendance);
      await assert.rejects(db.leaveRequestHistory.update({where:{id:detail.history[0].id},data:{action:'EDIT'}}));
    });
    await t.test('overlap is blocked; adjacent half shifts remain valid',async()=>{
      assert.equal((await request('/leave/requests',tt,base)).status,409);
      const second=(await ok('/leave/requests',tt,{...base,unit:'HALF',half:'SECOND'})).item;
      assert.equal(second.preview.totalDays,'0.50');assert.equal(second.preview.totalMinutes,240);
      assert.equal(second.preview.lines[0].startAt,'2026-11-02T05:00:00.000Z');
    });
    await t.test('hour requests exclude unpaid breaks and reject break-only or out-of-shift intervals',async()=>{
      const hour={...base,dateFrom:days[1],dateTo:days[1],unit:'HOUR',startAt:days[1]+'T11:00:00+07:00',endAt:days[1]+'T14:00:00+07:00'};
      const result=(await ok('/leave/requests',tt,hour)).item;
      assert.equal(result.preview.totalMinutes,120);assert.equal(result.preview.totalDays,'0.25');
      assert.equal((await request('/leave/requests',tt,{...hour,startAt:days[1]+'T12:00:00+07:00',endAt:days[1]+'T13:00:00+07:00'})).status,400);
      assert.equal((await request('/leave/requests',tt,{...hour,startAt:days[1]+'T07:00:00+07:00'})).status,400);
      assert.equal((await request('/leave/requests',tt,{...base,dateFrom:'2026-02-30',dateTo:'2026-02-30'})).status,400);
      assert.equal((await request('/leave/requests',tt,{...hour,startAt:days[1]+'T11:00:00'})).status,400);
    });
    await t.test('read-only roles cannot write; excluded people disappear from list and detail',async()=>{
      for(const cookie of [qd,kt,ad]) assert.equal((await request('/leave/requests',cookie,{...base,dateFrom:days[2],dateTo:days[2]})).status,403);
      await db.employeeExclusion.create({data:{employeeId:person.id,userAccountId:leader.id,effectiveFrom:today}});
      assert.equal((await request('/leave/requests/'+draft.id,tt)).status,404);
      assert.deepEqual((await ok('/leave/requests',tt)).items,[]);
      assert.equal((await request('/leave/requests',tt,{...base,dateFrom:days[2],dateTo:days[2]})).status,404);
      await db.employeeExclusion.deleteMany({where:{employeeId:person.id}});
    });
    await t.test("night hours keep the starting work date across midnight",async()=>{
      const night=await db.shiftDefinition.create({data:{orgUnitId:team.id,code:"REQUEST_NIGHT",name:"Ca đêm",kind:"NIGHT",startTime:"22:00",endTime:"06:00",crossesMidnight:true,breakStartOffset:240,breakMinutes:45,paidBreak:true,workMinutes:480,isNightShift:true}});
      await db.shiftSchedule.create({data:{planId:plan.id,employeeId:person.id,workDate:date("2026-11-07"),shiftId:night.id,startAt:new Date("2026-11-07T22:00:00+07:00"),endAt:new Date("2026-11-08T06:00:00+07:00"),workMinutes:480}});
      const row=(await ok("/leave/requests",tt,{...base,dateFrom:"2026-11-07",dateTo:"2026-11-07",unit:"HOUR",startAt:"2026-11-07T23:00:00+07:00",endAt:"2026-11-08T01:00:00+07:00"})).item;
      assert.equal(row.preview.totalMinutes,120);assert.equal(row.preview.totalDays,"0.25");assert.equal(row.preview.lines[0].workDate,"2026-11-07");
    });
    await t.test("dated exclusions, out-of-scope people and inactive types are rejected",async()=>{
      const remoteTeam=await db.orgUnit.findUniqueOrThrow({where:{code:"NM-NA-D1-T1"}});
      const remote=await db.employee.create({data:{code:"REQUEST_REMOTE",fullName:"Nhân sự ngoài phạm vi",gender:"MALE",dob:date("1990-01-01"),hireDate:date("2020-01-01"),assignments:{create:{orgUnitId:remoteTeam.id,effectiveFrom:date("2020-01-01"),allocationRatio:"100",isPrimary:true}}}});
      assert.equal((await request("/leave/requests",tt,{...base,employeeId:remote.id})).status,404);
      await db.employeeExclusion.create({data:{employeeId:person.id,userAccountId:leader.id,effectiveFrom:date(days[1]),effectiveTo:date(days[1])}});
      assert.equal((await request("/leave/requests",tt,{...base,dateFrom:days[0],dateTo:days[2]})).status,404);
      await db.employeeExclusion.deleteMany({where:{employeeId:person.id}});
      const inactive=await db.leaveType.create({data:{orgUnitId:company.id,code:"INACTIVE_TEST",versions:{create:{name:"Loại nghỉ đã ngừng",active:false,isPaid:false,countsAsWorkday:false,deductsAnnualQuota:false,siPaid:false,requiresDocument:false,attendanceSymbol:"KL",status:"SIMULATION",decisionReference:"TEST",reason:"Kiểm tra hiệu lực",effectiveFrom:date("2026-01-01")}}}});
      assert.equal((await request("/leave/requests",tt,{...base,leaveTypeId:inactive.id,dateFrom:days[3],dateTo:days[3]})).status,409);
    });
    await t.test('submit revalidates missing documents, balance and changed schedules',async()=>{
      const sick=await db.leaveType.findUniqueOrThrow({where:{orgUnitId_code:{orgUnitId:company.id,code:'SICK'}}});
      const value={...base,leaveTypeId:sick.id,dateFrom:days[2],dateTo:days[2],documentReference:undefined};
      let row=(await ok('/leave/requests',tt,value)).item;
      assert.equal((await request('/leave/requests/'+row.id+'/submit',tt,{revision:row.revision})).status,409);
      row=(await ok('/leave/requests/'+row.id+'/update',tt,{...value,documentReference:'Giấy khám số 123',revision:row.revision})).item;
      assert.equal((await ok('/leave/requests/'+row.id+'/submit',tt,{revision:row.revision})).item.status,'PENDING');
      const annual=await db.leaveType.findUniqueOrThrow({where:{orgUnitId_code:{orgUnitId:company.id,code:'ANNUAL'}}});
      const annualDraft=(await ok('/leave/requests',tt,{...base,leaveTypeId:annual.id,dateFrom:days[3],dateTo:days[3]})).item;
      assert.equal((await request('/leave/requests/'+annualDraft.id+'/submit',tt,{revision:annualDraft.revision})).status,409);
      const fund=await db.leaveBalance.create({data:{employeeId:person.id,year:2026}});
      await db.leaveOperation.create({data:{requestId:randomUUID(),requestHash:"a".repeat(64),kind:"ADJUSTMENT",effectiveDate:date("2026-01-01"),reason:"Cấp phép kiểm chứng",reference:"BB-TEST",snapshot:{},actorId:leader.id,entries:{create:{balanceId:fund.id,kind:"ADJUSTMENT",bucket:"ANNUAL",days:"1.00"}}}});
      const beforeEntries=await db.leaveLedgerEntry.count();
      assert.equal((await ok("/leave/requests/"+annualDraft.id+"/submit",tt,{revision:annualDraft.revision})).item.status,"PENDING");
      assert.equal(await db.leaveLedgerEntry.count(),beforeEntries);
      const last=(await ok('/leave/requests',tt,{...base,dateFrom:days[4],dateTo:days[4]})).item;
      await db.shiftPlan.update({where:{id:plan.id},data:{status:'RETURNED'}});
      assert.equal((await request('/leave/requests/'+last.id+'/submit',tt,{revision:last.revision})).status,409);
      assert.equal((await db.leaveRequest.findUniqueOrThrow({where:{id:last.id}})).status,'DRAFT');
      await db.shiftPlan.update({where:{id:plan.id},data:{status:"APPROVED"}});
      const site=await db.orgUnit.findUniqueOrThrow({where:{code:"NM-BN"}});
      const policy=await db.sitePolicy.findFirstOrThrow({where:{orgUnitId:site.id}});
      await db.businessPeriod.create({data:{code:"REQUEST_CLOSED",scopeOrgUnitId:site.id,dateFrom:date("2026-11-01"),dateTo:date("2026-11-30"),cutoffDay:policy.value,cutoffPolicyId:policy.id,status:"CLOSED"}});
      assert.equal((await request("/leave/requests/"+last.id+"/submit",tt,{revision:last.revision})).status,409);
      assert.equal((await db.leaveRequest.findUniqueOrThrow({where:{id:last.id}})).status,"DRAFT");
    });
  } finally {
    if(server&&server.exitCode===null){server.kill();await new Promise(done=>server.once('exit',done));}
    if(db) await db.$disconnect();
    await admin.$executeRawUnsafe('DROP DATABASE IF EXISTS "'+name+'" WITH (FORCE)');
    await admin.$disconnect();rmSync(credentialsPath,{force:true});
  }
});
