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
    async function workflow(day, submitted = true) {
      await db.shiftSchedule.create({data:{planId:plan.id,employeeId:person.id,workDate:date(day),shiftId:shift.id,startAt:new Date(day+'T08:00:00+07:00'),endAt:new Date(day+'T17:00:00+07:00'),workMinutes:480}});
      const payload={...base,dateFrom:day,dateTo:day};
      const row=(await ok('/leave/requests',tt,payload)).item;
      return {payload,row:submitted?(await ok('/leave/requests/'+row.id+'/submit',tt,{revision:row.revision})).item:row};
    }
    await t.test('return, correction, resubmission, approval and cancellation retain actor, reason and snapshots',async()=>{
      const {payload,row}=await workflow('2026-11-09');
      const beforeFunds=await db.leaveLedgerEntry.findMany(), beforeAttendance=await db.dailyAttendance.findMany();
      for(const action of ['return','reject','cancel']) {
        assert.equal((await request('/leave/requests/'+row.id+'/'+action,tt,{revision:row.revision})).status,400);
        assert.equal((await request('/leave/requests/'+row.id+'/'+action,tt,{revision:row.revision,reason:'  '})).status,400);
      }
      const returned=(await ok('/leave/requests/'+row.id+'/return',tt,{revision:row.revision,reason:'  Bổ sung căn cứ nghỉ  '})).item;
      assert.equal(returned.status,'RETURNED');
      assert.equal((await request('/leave/requests/'+row.id+'/approve',tt,{revision:returned.revision})).status,409);
      assert.equal((await request('/leave/requests/'+row.id+'/update',tt,{...payload,revision:row.revision})).status,409);
      const changed=(await ok('/leave/requests/'+row.id+'/update',tt,{...payload,reason:'Nghỉ việc gia đình, bổ sung căn cứ',revision:returned.revision})).item;
      assert.equal(changed.status,'DRAFT');assert.equal(changed.submittedAt,null);
      const sent=(await ok('/leave/requests/'+row.id+'/submit',tt,{revision:changed.revision})).item;
      const approved=(await ok('/leave/requests/'+row.id+'/approve',tt,{revision:sent.revision,reason:'Đã đối chiếu đơn giấy'})).item;
      assert.equal(approved.status,'APPROVED');
      assert.equal((await request('/leave/requests/'+row.id+'/update',tt,{...payload,revision:approved.revision})).status,409);
      assert.equal((await request('/leave/requests/'+row.id+'/approve',tt,{revision:approved.revision})).status,409);
      const cancelled=(await ok('/leave/requests/'+row.id+'/cancel',tt,{revision:approved.revision,reason:'Công nhân đi làm, rút đơn'})).item;
      assert.equal(cancelled.status,'CANCELLED');
      const detail=await ok('/leave/requests/'+row.id,tt);
      assert.deepEqual(detail.history.map(h=>h.action),['CREATE','SUBMIT','RETURN','UPDATE','SUBMIT','APPROVE','CANCEL']);
      assert.deepEqual(detail.history.map(h=>h.snapshot.status),['DRAFT','PENDING','RETURNED','DRAFT','PENDING','APPROVED','CANCELLED']);
      assert.deepEqual(detail.history.map(h=>h.revision),[1,2,3,4,5,6,7]);
      assert.equal(detail.history[2].reason,'Bổ sung căn cứ nghỉ');assert.equal(detail.history[2].fromStatus,'PENDING');
      assert.equal(detail.history[5].actor.id,leader.id);assert.equal(detail.history[5].snapshot.reason,'Nghỉ việc gia đình, bổ sung căn cứ');
      const audit=await db.auditLog.findFirstOrThrow({where:{entityId:row.id,action:'CANCEL'}});
      assert.equal(audit.actorId,leader.id);assert.equal(audit.newValue.reason,'Công nhân đi làm, rút đơn');
      assert.deepEqual(await db.leaveLedgerEntry.findMany(),beforeFunds);assert.deepEqual(await db.dailyAttendance.findMany(),beforeAttendance);
      await assert.rejects(db.leaveRequestHistory.delete({where:{id:detail.history[2].id}}));
      assert.equal((await ok('/leave/requests?status=CANCELLED',tt)).items.some(r=>r.id===row.id),true);
    });
    await t.test('terminal requests release overlaps and cannot be edited or reopened',async()=>{
      const {payload,row}=await workflow('2026-11-10');
      const rejected=(await ok('/leave/requests/'+row.id+'/reject',tt,{revision:row.revision,reason:'Không đủ căn cứ nghỉ'})).item;
      assert.equal(rejected.status,'REJECTED');
      for(const action of ["approve","return","reject","cancel"]) assert.equal((await request("/leave/requests/"+row.id+"/"+action,tt,{revision:rejected.revision,reason:"Thử mở lại"})).status,409);
      assert.equal((await request("/leave/requests/"+row.id+"/submit",tt,{revision:rejected.revision})).status,409);
      assert.equal((await request('/leave/requests/'+row.id+'/update',tt,{...payload,revision:rejected.revision})).status,409);
      const replacement=(await ok('/leave/requests',tt,payload)).item;
      const cancelled=(await ok('/leave/requests/'+replacement.id+'/cancel',tt,{revision:replacement.revision,reason:'Rút đơn nháp'})).item;
      assert.equal(cancelled.status,'CANCELLED');
      const next=(await ok('/leave/requests',tt,payload)).item;
      assert.equal(next.status,'DRAFT');
      assert.equal((await ok('/leave/requests?status=REJECTED',tt)).items.some(r=>r.id===row.id),true);
    });
    await t.test('decisions enforce TT permission, current and historical exclusions, and block own employee data',async()=>{
      const {row}=await workflow('2026-11-11');
      const {payload,row:editable}=await workflow('2026-11-12',false);
      for(const cookie of [qd,kt,ad]) for(const action of ['approve','return','reject','cancel']) assert.equal((await request('/leave/requests/'+row.id+'/'+action,cookie,{revision:row.revision,reason:'Không có quyền'})).status,403);
      for(const effectiveFrom of [today,date('2026-11-11')]) {
        await db.employeeExclusion.create({data:{employeeId:person.id,userAccountId:leader.id,effectiveFrom,effectiveTo:effectiveFrom}});
        for(const action of ['approve','return','reject','cancel']) assert.equal((await request('/leave/requests/'+row.id+'/'+action,tt,{revision:row.revision,reason:'Ngoài phạm vi'})).status,404);
        await db.employeeExclusion.deleteMany({where:{employeeId:person.id}});
      }
      const roles=await db.roleAssignment.findMany({where:{userAccountId:leader.id}});
      const foreignTeam=await db.orgUnit.findUniqueOrThrow({where:{code:"NM-NA-D1-T1"}});
      await db.roleAssignment.updateMany({where:{userAccountId:leader.id},data:{scopeOrgUnitId:foreignTeam.id}});
      assert.equal((await request("/leave/requests/"+row.id+"/approve",tt,{revision:row.revision})).status,404);
      for(const role of roles) await db.roleAssignment.update({where:{id:role.id},data:{scopeOrgUnitId:role.scopeOrgUnitId}});
      await db.roleAssignment.updateMany({where:{userAccountId:leader.id},data:{effectiveTo:date('2026-11-10')}});
      assert.equal((await request('/leave/requests/'+row.id+'/approve',tt,{revision:row.revision})).status,404);
      for(const role of roles) await db.roleAssignment.update({where:{id:role.id},data:{effectiveTo:role.effectiveTo}});
      await db.userAccount.update({where:{id:leader.id},data:{employeeId:person.id}});
      try {
        assert.equal((await request('/leave/requests',tt,payload)).status,403);
        assert.equal((await request('/leave/requests/'+editable.id+'/update',tt,{...payload,revision:editable.revision})).status,403);
        assert.equal((await request('/leave/requests/'+editable.id+'/submit',tt,{revision:editable.revision})).status,403);
        for(const action of ['approve','return','reject','cancel']) assert.equal((await request('/leave/requests/'+row.id+'/'+action,tt,{revision:row.revision,reason:'Tự xử lý'})).status,403);
      } finally { await db.userAccount.update({where:{id:leader.id},data:{employeeId:leader.employeeId}}); }
      assert.equal((await ok('/leave/requests/'+row.id,tt)).item.status,'PENDING');
    });
    await t.test('approval rejects changed submitted sources; returning remains possible and resubmission refreshes the snapshot',async()=>{
      const {row}=await workflow('2026-11-13');
      const schedule=await db.shiftSchedule.findUniqueOrThrow({where:{id:row.preview.lines[0].scheduleId}});
      await db.shiftSchedule.update({where:{id:schedule.id},data:{startAt:new Date('2026-11-13T09:00:00+07:00'),endAt:new Date('2026-11-13T18:00:00+07:00')}});
      assert.equal((await request('/leave/requests/'+row.id+'/approve',tt,{revision:row.revision})).status,409);
      const returned=(await ok('/leave/requests/'+row.id+'/return',tt,{revision:row.revision,reason:'Kiểm tra ca thay đổi'})).item;
      const resent=(await ok('/leave/requests/'+row.id+'/submit',tt,{revision:returned.revision})).item;
      assert.equal(resent.preview.lines[0].startAt,'2026-11-13T02:00:00.000Z');
      const approved=(await ok('/leave/requests/'+row.id+'/approve',tt,{revision:resent.revision})).item;
      assert.equal(approved.status,'APPROVED');assert.equal(approved.preview.totalMinutes,480);
    });
    await t.test('competing decisions commit exactly one revision and reject the stale action',async()=>{
      const {row}=await workflow('2026-11-14');
      const responses=await Promise.all(['approve','cancel'].map(action=>request('/leave/requests/'+row.id+'/'+action,tt,{revision:row.revision,reason:'Quyết định cạnh tranh'})));
      assert.deepEqual(responses.map(r=>r.status).sort((a,b)=>a-b),[201,409]);
      const winner=responses.find(r=>r.status===201).body.item;
      const detail=await ok('/leave/requests/'+row.id,tt);
      assert.equal(detail.item.status,winner.status);assert.equal(detail.item.revision,row.revision+1);
      assert.deepEqual(detail.history.map(h=>h.action),['CREATE','SUBMIT',winner.status==='APPROVED'?'APPROVE':'CANCEL']);
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
      const pendingAnnual=await db.leaveRequest.findUniqueOrThrow({where:{id:annualDraft.id}});
      await db.leaveOperation.create({data:{requestId:randomUUID(),requestHash:'b'.repeat(64),kind:'ADJUSTMENT',effectiveDate:date('2026-01-01'),reason:'Điều chỉnh lại căn cứ phép',reference:'BB-TEST-2',snapshot:{},actorId:leader.id,entries:{create:{balanceId:fund.id,kind:'ADJUSTMENT',bucket:'ANNUAL',days:'-1.00'}}}});
      assert.equal((await request('/leave/requests/'+annualDraft.id+'/approve',tt,{revision:pendingAnnual.revision})).status,409);
      assert.equal((await ok('/leave/requests/'+annualDraft.id,tt)).item.status,'PENDING');
      const pendingClosed=(await workflow('2026-11-20')).row;
      const toReturn=(await workflow("2026-11-21")).row;
      const returnedClosed=(await ok("/leave/requests/"+toReturn.id+"/return",tt,{revision:toReturn.revision,reason:"Cần chỉnh thời gian"})).item;
      await db.shiftSchedule.create({data:{planId:plan.id,employeeId:person.id,workDate:date("2026-12-01"),shiftId:shift.id,startAt:new Date("2026-12-01T08:00:00+07:00"),endAt:new Date("2026-12-01T17:00:00+07:00"),workMinutes:480}});
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
      for(const action of ['approve','return','reject','cancel']) assert.equal((await request('/leave/requests/'+pendingClosed.id+'/'+action,tt,{revision:pendingClosed.revision,reason:'Kỳ đã chốt'})).status,409);
      assert.equal((await ok('/leave/requests/'+pendingClosed.id,tt)).item.status,'PENDING');
      assert.equal((await request("/leave/requests/"+returnedClosed.id+"/update",tt,{...base,dateFrom:"2026-12-01",dateTo:"2026-12-01",revision:returnedClosed.revision})).status,409);
      assert.equal((await ok("/leave/requests/"+returnedClosed.id,tt)).item.dateFrom,"2026-11-21");
    });
 const siteUnit=await db.orgUnit.findUniqueOrThrow({where:{code:'NM-BN'}});
     const siteVersion=await db.orgUnitVersion.findFirstOrThrow({where:{orgUnitId:siteUnit.id}});
     const cutoff=await db.sitePolicy.findFirstOrThrow({where:{orgUnitId:siteUnit.id}});
     const integrationPeriod=await db.businessPeriod.create({data:{code:'LEAVE_INTEGRATION_DEC',scopeOrgUnitId:siteUnit.id,dateFrom:date('2026-12-01'),dateTo:date('2026-12-31'),cutoffDay:cutoff.value,cutoffPolicyId:cutoff.id,status:'OPEN'}});
     const annualType=await db.leaveType.findUniqueOrThrow({where:{orgUnitId_code:{orgUnitId:company.id,code:'ANNUAL'}}});
     const integrationFund=await db.leaveBalance.findUniqueOrThrow({where:{employeeId_year:{employeeId:person.id,year:2026}}});
     async function credit(bucket,amount,expiry=null) {
       const kind=bucket==='CARRY'?'CARRY_IN':bucket==='ADVANCE'?'ADVANCE_IN':'ADJUSTMENT';
       await db.leaveOperation.create({data:{requestId:randomUUID(),requestHash:'c'.repeat(64),kind,effectiveDate:date('2026-01-01'),reason:'Cấp quỹ kiểm chứng tích hợp',reference:'BB-INTEGRATION',snapshot:{},actorId:leader.id,entries:{create:{balanceId:integrationFund.id,kind,bucket,days:amount,expiresAt:expiry?date(expiry):null}}}});
     }
     await credit('CARRY','0.75','2026-12-31');await credit('ADVANCE','0.50');await credit('ANNUAL','5.00');
     const baseCalendar=await db.legalParameter.findFirstOrThrow({where:{paramCode:'HOLIDAY_CALENDAR',scopeKey:'GLOBAL'}});
     await db.legalParameter.create({data:{paramCode:'HOLIDAY_CALENDAR',scopeKey:'SITE:'+siteVersion.siteId,subjectType:'ALL',applicationBasis:'WORK_DATE',value:{...baseCalendar.value,dates:[...baseCalendar.value.dates,'2026-12-09']},unit:'date-list',effectiveFrom:date('2026-01-01'),effectiveTo:date('2026-12-31'),documentEffectiveDate:date('2026-01-01'),legalBasis:'Ngày lễ kiểm chứng phạm vi cơ sở'}});
     async function scheduleDay(day) { return db.shiftSchedule.create({data:{planId:plan.id,employeeId:person.id,workDate:date(day),shiftId:shift.id,startAt:new Date(day+'T08:00:00+07:00'),endAt:new Date(day+'T17:00:00+07:00'),workMinutes:480}}); }
     async function send(payload) { const row=(await ok('/leave/requests',tt,payload)).item;return (await ok('/leave/requests/'+row.id+'/submit',tt,{revision:row.revision})).item; }
     let integrated;
     await t.test('five scheduled days with one scoped holiday debit four days and project P/L without manufacturing worked minutes',async()=>{
       for(const day of ['2026-12-07','2026-12-08','2026-12-09','2026-12-10','2026-12-11']) await scheduleDay(day);
       const sent=await send({...base,leaveTypeId:annualType.id,dateFrom:'2026-12-07',dateTo:'2026-12-11'});
       assert.equal(sent.preview.balances[0].requestedDays,'4.00');
       integrated=(await ok('/leave/requests/'+sent.id+'/approve',tt,{revision:sent.revision})).item;
       assert.equal(integrated.integration.status,'APPLIED');
       const entries=await db.leaveLedgerEntry.findMany({where:{operation:{leaveRequestId:sent.id}},include:{operation:true}});
       const sum=(bucket)=>entries.filter(e=>e.bucket===bucket).reduce((n,e)=>n+Number(e.days),0);
       assert.equal(sum('CARRY'),-.75);assert.equal(sum('ADVANCE'),-.5);assert.equal(sum('ANNUAL'),-2.75);
       const board=await ok('/attendance/board?periodId='+integrationPeriod.id,tt);
       const rows=board.items.filter(r=>r.employee.id===person.id);
       assert.equal(rows.length,5);
       for(const row of rows) {assert.equal(row.workedMinutes,0);assert.equal(Number(row.workUnits),1);assert.equal(row.absent,false);assert.deepEqual(row.flags,[]);assert.equal(row.leave.minutes,480);assert.equal(row.leave.sources[0].requestId,sent.id);}
       assert.deepEqual(rows.find(r=>r.workDate==='2026-12-09').leave.symbols,['L']);
       assert.equal((await request('/leave/requests/'+sent.id+'/approve',tt,{revision:sent.revision})).status,409);
       assert.equal(await db.leaveLedgerEntry.count({where:{operation:{leaveRequestId:sent.id}}}),entries.length);
       await ok('/attendance/process',ad,{siteId:siteVersion.siteId,referencePeriodId:integrationPeriod.id});
       assert.equal((await db.dailyAttendance.findUniqueOrThrow({where:{scheduleId:sent.preview.lines[0].scheduleId}})).leave.minutes,480);
     });
     await t.test('approved cancellation restores exact source buckets/expiry once and removes only that request from attendance',async()=>{
       const used=await db.leaveLedgerEntry.findMany({where:{kind:'USE',operation:{leaveRequestId:integrated.id}}});
       const cancelled=(await ok('/leave/requests/'+integrated.id+'/cancel',tt,{revision:integrated.revision,reason:'Công nhân rút đơn sau duyệt'})).item;
       assert.equal(cancelled.integration.status,'REVERSED');
       const refunds=await db.leaveLedgerEntry.findMany({where:{kind:'REFUND',operation:{leaveRequestId:integrated.id}},include:{operation:true}});
       assert.equal(refunds.length,used.length);
       for(const debit of used) {const refund=refunds.find(r=>r.operation.snapshot.sourceEntryId===debit.id);assert.equal(refund.days.toString(),debit.days.negated().toString());assert.equal(refund.bucket,debit.bucket);assert.equal(refund.expiresAt?.toISOString(),debit.expiresAt?.toISOString());}
       const row=await db.dailyAttendance.findUniqueOrThrow({where:{scheduleId:integrated.preview.lines[0].scheduleId}});
       assert.deepEqual(row.leave.sources,[]);assert.equal(Number(row.workUnits),0);
       assert.equal((await request('/leave/requests/'+integrated.id+'/cancel',tt,{revision:cancelled.revision,reason:'Gửi lại thao tác'})).status,409);
       assert.equal(await db.leaveLedgerEntry.count({where:{kind:'REFUND',operation:{leaveRequestId:integrated.id}}}),refunds.length);
     });
     await t.test('half-shift leave pairs the afternoon punches, keeps worked minutes separate and reverses to raw attendance',async()=>{
       const schedule=await scheduleDay('2026-12-14');
       const sent=await send({...base,leaveTypeId:annualType.id,dateFrom:'2026-12-14',dateTo:'2026-12-14',unit:'HALF',half:'FIRST'});
        const batch=await db.attendanceImport.create({data:{siteId:siteVersion.siteId,referencePeriodId:integrationPeriod.id,createdById:leader.id,fileName:'leave-afternoon.csv',fileHash:'d'.repeat(64),status:'ACCEPTED',totalRows:2,mapping:{},summary:{},errors:[]}});
       for(const [index,time,direction] of [[1,'13:00:00','IN'],[2,'17:00:00','OUT']]) await db.rawPunch.create({data:{batchId:batch.id,rowNumber:index,siteId:siteVersion.siteId,employeeId:person.id,punchedAt:new Date('2026-12-14T'+time+'+07:00'),direction,deviceCode:'LEAVE-TEST',source:[]}});
       const approved=(await ok('/leave/requests/'+sent.id+'/approve',tt,{revision:sent.revision})).item;
       const day=await db.dailyAttendance.findUniqueOrThrow({where:{scheduleId:schedule.id}});
       assert.equal(Number(day.workedMinutes),240);assert.equal(Number(day.workUnits),1);assert.equal(day.leave.minutes,240);assert.equal(day.leave.paidMinutes,240);assert.equal(day.lateMinutes,0);assert.equal(day.earlyMinutes,0);assert.deepEqual(day.flags,[]);
       await ok('/attendance/process',ad,{siteId:siteVersion.siteId,referencePeriodId:integrationPeriod.id});
       const rerun=await db.dailyAttendance.findUniqueOrThrow({where:{scheduleId:schedule.id}});assert.equal(Number(rerun.workUnits),1);assert.equal(Number(rerun.workedMinutes),240);assert.deepEqual(rerun.flags,[]);
       await ok('/leave/requests/'+approved.id+'/cancel',tt,{revision:approved.revision,reason:'Rút nửa ca nghỉ'});
       const raw=await db.dailyAttendance.findUniqueOrThrow({where:{scheduleId:schedule.id}});assert.deepEqual(raw.leave.sources,[]);assert.ok(raw.flags.includes('MISSING_IN'));assert.equal(Number(raw.workUnits),0);
     });
     await t.test('leave approved before a period exists is projected by processing and detail reflects current attendance',async()=>{
       const day='2026-01-19',schedule=await scheduleDay(day);
       const sent=await send({...base,dateFrom:day,dateTo:day});
       const approved=(await ok('/leave/requests/'+sent.id+'/approve',tt,{revision:sent.revision})).item;
       assert.equal(approved.integration.attendance[0].state,'WAITING_PERIOD');assert.equal(approved.integration.useOperationIds.length,0);
       assert.equal(await db.dailyAttendance.findUnique({where:{scheduleId:schedule.id}}),null);
       const period=await db.businessPeriod.create({data:{code:'LEAVE_WAITING_JAN',scopeOrgUnitId:siteUnit.id,dateFrom:date('2026-01-01'),dateTo:date('2026-01-31'),cutoffDay:cutoff.value,cutoffPolicyId:cutoff.id,status:'OPEN'}});
       await ok('/attendance/process',ad,{siteId:siteVersion.siteId,referencePeriodId:period.id});
       const row=await db.dailyAttendance.findUniqueOrThrow({where:{scheduleId:schedule.id}});
       assert.equal(row.leave.minutes,480);assert.equal(Number(row.workUnits),0);assert.equal(row.absent,false);assert.deepEqual(row.leave.symbols,['KL']);
       const detail=(await ok('/leave/requests/'+sent.id,tt)).item;
       assert.equal(detail.integration.attendance[0].state,'UPDATED');assert.equal(detail.integration.attendance[0].dayId,row.id);
       await ok('/leave/requests/'+approved.id+'/cancel',tt,{revision:approved.revision,reason:'Rút đơn đã đồng bộ sau mở kỳ'});
       assert.deepEqual((await db.dailyAttendance.findUniqueOrThrow({where:{scheduleId:schedule.id}})).leave.sources,[]);
     });
     await t.test('cancelling one of two adjacent half-shift leaves preserves the other source without manufacturing presence',async()=>{
       const day='2026-12-17',schedule=await scheduleDay(day);
       const first=await send({...base,leaveTypeId:annualType.id,dateFrom:day,dateTo:day,unit:'HALF',half:'FIRST'});
       const second=await send({...base,dateFrom:day,dateTo:day,unit:'HALF',half:'SECOND'});
       const approved=(await ok('/leave/requests/'+first.id+'/approve',tt,{revision:first.revision})).item;
       await ok('/leave/requests/'+second.id+'/approve',tt,{revision:second.revision});
       const full=await db.dailyAttendance.findUniqueOrThrow({where:{scheduleId:schedule.id}});
       assert.equal(full.leave.minutes,480);assert.equal(Number(full.workUnits),.5);assert.equal(Number(full.workedMinutes),0);assert.equal(full.absent,false);
       await ok('/leave/requests/'+approved.id+'/cancel',tt,{revision:approved.revision,reason:'Rút riêng nửa đầu ca'});
       const remaining=await db.dailyAttendance.findUniqueOrThrow({where:{scheduleId:schedule.id}});
       assert.deepEqual(remaining.leave.sources.map(s=>s.requestId),[second.id]);assert.equal(remaining.leave.minutes,240);assert.equal(Number(remaining.workUnits),0);assert.equal(Number(remaining.workedMinutes),0);
     });
     await t.test('competing annual approvals cannot overspend future debits and a closed period rolls back cancellation/refund',async()=>{
       const current=await db.leaveLedgerEntry.findMany({where:{balanceId:integrationFund.id}});
       const total=current.reduce((n,e)=>n+Number(e.days),0);
       await credit('ANNUAL',String(1-total));
       for(const day of ['2026-12-15','2026-12-16']) await scheduleDay(day);
       const pending=[];for(const day of ['2026-12-15','2026-12-16']) pending.push(await send({...base,leaveTypeId:annualType.id,dateFrom:day,dateTo:day}));
       const results=await Promise.all(pending.map(row=>request('/leave/requests/'+row.id+'/approve',tt,{revision:row.revision})));
       assert.deepEqual(results.map(r=>r.status).sort((a,b)=>a-b),[201,409]);
       const approved=results.find(r=>r.status===201).body.item;
       const before=await db.leaveLedgerEntry.count({where:{operation:{leaveRequestId:approved.id}}});
       await db.businessPeriod.update({where:{id:integrationPeriod.id},data:{status:'CLOSED'}});
       assert.equal((await request('/leave/requests/'+approved.id+'/cancel',tt,{revision:approved.revision,reason:'Kỳ đã chốt'})).status,409);
       assert.equal((await db.leaveRequest.findUniqueOrThrow({where:{id:approved.id}})).status,'APPROVED');assert.equal(await db.leaveLedgerEntry.count({where:{operation:{leaveRequestId:approved.id}}}),before);
     });
  } finally {
    if(server&&server.exitCode===null){server.kill();await new Promise(done=>server.once('exit',done));}
    if(db) await db.$disconnect();
    await admin.$executeRawUnsafe('DROP DATABASE IF EXISTS "'+name+'" WITH (FORCE)');
    await admin.$disconnect();rmSync(credentialsPath,{force:true});
  }
});
