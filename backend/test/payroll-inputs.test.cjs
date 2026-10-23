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
const day = 86400000, date = value => new Date(value + 'T00:00:00Z');
const text = value => value.toISOString().slice(0, 10), today = text(businessDate());
const after = days => text(new Date(date(today).getTime() + days * day));

test('Payroll inputs: immutable source acceptance and real HTTP/PostgreSQL', { timeout: 240000 }, async t => {
  const name = 'hrtp_payroll_inputs_' + randomUUID().replaceAll('-', '');
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
    const credentials = JSON.parse(readFileSync(credentialsPath, 'utf8')).accounts;
    const listener = net.createServer(); await new Promise(done => listener.listen(0, '127.0.0.1', done));
    const port = listener.address().port; await new Promise(done => listener.close(done));
    server = spawn(process.execPath, ['dist/main.js'], { cwd: backend, env: { ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stdout.on('data', value => { logs += value; }); server.stderr.on('data', value => { logs += value; });
    await new Promise((ready, reject) => {
      let finished = false;
      const timeout = setTimeout(() => { finished = true; reject(new Error(logs)); }, 20000);
      server.once('exit', code => { if (!finished) { finished = true; clearTimeout(timeout); reject(new Error('API exited ' + code + '\n' + logs)); } });
      const poll = async () => { if (finished) return; try { if ((await fetch('http://127.0.0.1:' + port + '/api/health')).ok) { finished = true; clearTimeout(timeout); ready(); return; } } catch {} if (!finished) setTimeout(poll, 100); }; poll();
    });
    async function request(path, cookie, body) {
      const form = body instanceof FormData;
      const response = await fetch('http://127.0.0.1:' + port + '/api' + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(cookie ? { cookie } : {}), ...(body === undefined || form ? {} : { 'Content-Type': 'application/json' }) }, body: form ? body : body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
    }
    async function ok(path, cookie, body) { const response = await request(path, cookie, body); assert.ok(response.status >= 200 && response.status < 300, JSON.stringify(response) + (response.status >= 500 ? '\n' + logs : '')); return response.body; }
    async function login(username) { const account = credentials.find(row => row.username === username); return (await request('/auth/login', null, { username, password: account.password })).cookie; }
    const [kt, local, tt, qd, ad] = await Promise.all(['kt.all', 'kt.bn', 'tt.bn', 'qd.bn', 'ad.demo'].map(login));
    const [company, site, remote, localTeam, remoteTeam] = await Promise.all(['COMPANY', 'NM-BN', 'NM-NA', 'NM-BN-D1-T1', 'NM-NA-D1-T1'].map(code => db.orgUnit.findUniqueOrThrow({ where: { code } })));
    const employees = await db.employee.findMany({ where: { code: { startsWith: 'NM-BN-' } }, orderBy: { code: 'asc' } });
    const remoteEmployee = await db.employee.findFirstOrThrow({ where: { code: { startsWith: 'NM-NA-' } } });
    const path = '/payroll-inputs';
    const baseFields = { active: true, status: 'SIMULATION', decisionReference: 'MP-QD-INPUT', reason: 'Nguồn kiểm chứng đầu vào lương', effectiveFrom: after(-10) };
    const components = {};
    for (const [key, componentType] of [['PRODUCT','EARNING'],['PIECEWORK','EARNING'],['COMMISSION','EARNING'],['THREE_P','EARNING'],['TIME','EARNING'],['ALLOWANCE','EARNING'],['BONUS','EARNING'],['DEDUCTION','DEDUCTION'],['EMPLOYER_COST','EMPLOYER_COST'],['NA','EARNING']]) {
      components[key] = (await ok('/salary-components', kt, { ...baseFields, orgUnitId: company.id, code: 'IN_' + key, name: 'Cấu phần ' + key, componentType, isInsurable: false, taxClassification: 'TAXABLE', isOtBase: false, isProrated: false, displayOrder: 10, classificationBasis: 'Chỉ mô phỏng, không phải chính sách thực tế' })).item;
    }
    const prices = {};
    for (const [code, priceType, amount, unit, extra] of [['PRODUCT','PRODUCT','2000','VND/sản phẩm',{productCode:'PCB_A1'}],['PIECEWORK','PIECEWORK','4000000','VND/lô',{operationCode:'HAN_LO'}],['COMMISSION','COMMISSION','2','%',{}],['P1','P1','8000000','VND',{}],['P2','P2','2000000','VND',{}],['P3','P3','3000000','VND',{}],['TIME','MONTHLY','13000000','VND/tháng',{}]]) {
      prices[code] = (await ok('/payroll-configuration', kt, { ...baseFields, orgUnitId: company.id, kind:'PRICE', code:'IN_PRICE_' + code, name: 'Giá ' + code, priceType, amount, unit, ...extra })).item;
    }
    const input = (code, unit, min='0', max='1000000000000') => ({symbol:code,source:'INPUT',reference:code,unit,min,max});
    const price = (symbol, key, unit) => ({symbol,source:'PRICE',reference:prices[key].code,unit});
    const formulaDefinitions = {
      PRODUCT:['Q * P',[input('Q','sản phẩm','0','100000'),price('P','PRODUCT','VND/sản phẩm')]],
      PIECEWORK:['Q * P',[input('Q','lô','0','100'),price('P','PIECEWORK','VND/lô')]],
      COMMISSION:['REVENUE * RATE / 100',[input('REVENUE','VND'),price('RATE','COMMISSION','%')]],
      THREE_P:['P1 + P2 + P3 * KPI / 100',[price('P1','P1','VND'),price('P2','P2','VND'),price('P3','P3','VND'),input('KPI','%','0','150')]],
      TIME:['SALARY * DAYS / STANDARD',[price('SALARY','TIME','VND/tháng'),input('DAYS','ngày','0','31'),input('STANDARD','ngày','1','31')]],
      ALLOWANCE:['VALUE',[input('VALUE','VND')]], BONUS:['VALUE',[input('VALUE','VND')]], DEDUCTION:['VALUE',[input('VALUE','VND')]], EMPLOYER_COST:['VALUE',[input('VALUE','VND')]],
    };
    const formulas = {};
    for (const [key,[expression,variables]] of Object.entries(formulaDefinitions)) formulas[key] = (await ok('/payroll-configuration',kt,{...baseFields,orgUnitId:company.id,kind:'FORMULA',code:'IN_FORMULA_'+key,name:'Công thức '+key,componentId:components[key].id,unit:'VND',expression,variables,roundingMode:'HALF_UP',roundingScale:0})).item;
    for (const [index, key] of ['PRODUCT','PRODUCT','PIECEWORK','COMMISSION','THREE_P','TIME','PRODUCT','PRODUCT'].entries()) {
      const team = index >= 6;
      const baseLine = {componentId:components[key].id,role:'BASE',sourceType:key,formulaCode:formulas[key].code,sourceReference:'QD-BASE-'+index,allocation:team?'CONFIRMED_TEAM_ALLOCATION':'INDIVIDUAL',...(team?{allocationReference:'QD-TEAM'}:{})};
      const additional = ['ALLOWANCE','BONUS','DEDUCTION','EMPLOYER_COST'].map(type=>({componentId:components[type].id,role:'ADDITIONAL',sourceType:type,formulaCode:formulas[type].code,sourceReference:'QD-'+type,allocation:'INDIVIDUAL',...(type==='BONUS'?{separateDecisionReference:'QD-BONUS-INDEPENDENT'}:{})}));
      await ok('/employee-pay-plans',kt,{employeeId:employees[index].id,name:'Phương án tiếp nhận '+index,payMode:key==='TIME'?'MONTHLY':key,status:'SIMULATION',decisionReference:'QD-PLAN-'+index,reason:'Căn cứ kiểm chứng nguồn',effectiveFrom:after(-10),lines:[baseLine,...additional,{componentId:components.NA.id,role:'NOT_APPLICABLE',sourceType:'ALLOWANCE',sourceReference:'Không hưởng khoản này',allocation:'INDIVIDUAL'}]});
    }
    const period = (await ok(path+'/periods',local,{code:'INPUT-PERIOD',siteOrgUnitId:site.id,dateFrom:after(-10),dateTo:after(10),expectedPaymentDate:after(15)})).period;
    let sequence = 0;
    const line = (extra={}) => ({sourceLineId:'LINE-1',employeeId:employees[0].id,componentId:components.PRODUCT.id,inputType:'PRODUCT',workFrom:today,workTo:today,valueState:'PRESENT',calculationMode:'FORMULA',formulaCode:formulas.PRODUCT.code,inputs:[{code:'Q',unit:'sản phẩm',value:'500'}],businessReference:'NGHIEM-THU-'+(++sequence),...extra});
    const batch = (extra={}) => ({payrollPeriodId:period.id,sourceSystem:'MP_PRODUCTION',sourceDocumentNo:'BB-NT-'+(++sequence),sourceVersion:'V1',mappingVersion:'PAYROLL-INPUT-V1',provenance:'SIMULATION',preparedBy:'Trần Văn Minh - người lập mô phỏng',sourceApprovedBy:'Nguyễn Thu Hà - người xác nhận mô phỏng',sourceApprovedAt:today,sourceApprovalReference:'BB-NGHIEM-THU-MP-001',reason:'Đối chiếu số đã nghiệm thu, không phải lương thực trả',lines:[line()],...extra});
    const get = async id => (await ok(path+'/'+id,kt)).item;
    const create = async body => (await ok(path,kt,body)).item;
    const validate = async item => (await ok(path+'/'+item.id+'/validate',kt,{revision:item.revision,reason:'Đối chiếu phương án và nguồn'})).item;
    const confirm = async item => (await ok(path+'/'+item.id+'/confirm',kt,{revision:item.revision,reason:'KT xác nhận tiếp nhận nguồn'})).item;
    const confirmed = async () => (await ok(path+'/confirmed?payrollPeriodId='+period.id,kt)).items;
    async function accepted(body) {const item=await validate(await create(body)); assert.equal(item.status,'VALIDATED',JSON.stringify(item.validation)); return confirm(item);}
    async function invalid(body, expectedCode) {
      const created=await request(path,kt,body);
      if (created.status===400) return;
      assert.equal(created.status,201,JSON.stringify(created));
      const checked=await validate(created.body.item);
      assert.notEqual(checked.status,'VALIDATED');
      assert.ok(checked.validation.issues.length>0);
      if(expectedCode) assert.equal(checked.validation.issues.some(issue=>issue.code===expectedCode),true,JSON.stringify(checked.validation));
      const rejected=await request(path+'/'+checked.id+'/confirm',kt,{revision:checked.revision,reason:'Không được xác nhận nguồn lỗi'});
      assert.ok(rejected.status>=400,JSON.stringify(rejected));
      assert.equal((await confirmed()).some(row=>row.batchId===checked.id),false);
    }
    let original;

    await t.test('new payroll periods are distinct from attendance and KT-only creation is scoped',async()=>{
      for(const cookie of [tt,qd,ad]) {assert.equal((await request(path+'/context',cookie)).status,403); assert.equal((await request(path+'/periods',cookie,{code:'BAD-PERIOD',siteOrgUnitId:site.id,dateFrom:today,dateTo:after(5)})).status,403);}
      assert.equal((await request(path+'/context')).status,401);
      assert.equal((await request(path+'/periods',local,{code:'REMOTE-PERIOD',siteOrgUnitId:remote.id,dateFrom:today,dateTo:after(5)})).status,404);
      assert.equal((await request(path+'/periods',kt,{code:'OVERLAP-PERIOD',siteOrgUnitId:site.id,dateFrom:today,dateTo:after(5)})).status,409);
      assert.equal((await request(path+'/periods',kt,{code:'BAD-DATE',siteOrgUnitId:site.id,dateFrom:'2026-02-30',dateTo:after(5)})).status,400);
      assert.equal((await ok('/periods',kt)).items.some(row=>row.id===period.id),false);
      const before=(await ok(path+'/periods',local)).items;
      assert.equal(before.some(row=>row.id===period.id && row.dateFrom===after(-10) && row.expectedPaymentDate===after(15)),true);
    });

    await t.test('source key idempotency survives JSON order and conflicting content never overwrites',async()=>{
      const body=batch(); const first=await ok(path,kt,body); const replay=await ok(path,local,{...body,lines:body.lines.map(row=>({...row,inputs:[...row.inputs].reverse()}))});
      assert.equal(replay.duplicate,true); assert.equal(replay.item.id,first.item.id);
      assert.equal(replay.item.history.length,first.item.history.length);
      const conflict=await request(path,kt,{...body,lines:[{...body.lines[0],inputs:[{code:'Q',unit:'sản phẩm',value:'501'}]}]});
      assert.equal(conflict.status,409); assert.equal(conflict.body.code,'PAYROLL_INPUT_CONFLICT');
      assert.equal((await get(first.item.id)).lines[0].inputs[0].value,'500');
    });

    await t.test('MISSING never becomes zero, explicit zero can confirm, NA must follow the plan',async()=>{
      await invalid(batch({lines:[line({valueState:'MISSING',inputs:[]})]}),'PAYROLL_INPUT_MISSING');
      const zero=await accepted(batch({lines:[line({employeeId:employees[1].id,valueState:'CONFIRMED_ZERO',inputs:[{code:'Q',unit:'sản phẩm',value:'0'}]})]}));
      assert.equal(zero.provenance,'SIMULATION'); assert.equal(zero.lines[0].valueState,'CONFIRMED_ZERO');
      const zeroKpi=await accepted(batch({lines:[line({employeeId:employees[4].id,componentId:components.THREE_P.id,inputType:'THREE_P',formulaCode:formulas.THREE_P.code,valueState:'CONFIRMED_ZERO',inputs:[{code:'KPI',unit:'%',value:'0'}]})]}));
      const zeroKpiResult=zeroKpi.lines[0].bindingSnapshot.results.find(row=>row.code===formulas.THREE_P.code).value;
      assert.equal(new (require('decimal.js'))(zeroKpiResult).eq('10000000'),true,'KPI 0 does not erase fixed P1/P2');
      const na=await accepted(batch({lines:[line({componentId:components.NA.id,inputType:'ALLOWANCE',valueState:'NOT_APPLICABLE',formulaCode:undefined,inputs:[],businessReference:undefined})]}));
      assert.equal(na.lines[0].valueState,'NOT_APPLICABLE');
      await invalid(batch({lines:[line({valueState:'NOT_APPLICABLE',formulaCode:undefined,inputs:[]})]}));
      await invalid(batch({lines:[line({valueState:'CONFIRMED_ZERO',inputs:[{code:'Q',unit:'sản phẩm',value:'1'}]})]}));
    });

    await t.test('source acceptance requires identified approver, valid date, documentary basis and appropriate provenance',async()=>{
      for(const extra of [{sourceApprovedBy:undefined},{sourceApprovedAt:undefined},{sourceApprovalReference:undefined},{sourceApprovedAt:after(1)},{provenance:'BUSINESS_CONFIRMED'}]) await invalid(batch(extra));
    });

    await t.test('confirmation exposes only active confirmed immutable sources and pins actual source versions',async()=>{
      const received=await create(batch({lines:[line({inputs:[{code:'Q',unit:'sản phẩm',value:'500.123456'}]})]}));
      assert.equal((await confirmed()).some(row=>row.batchId===received.id),false);
      const checked=await validate(received); assert.equal(checked.status,'VALIDATED',JSON.stringify(checked.validation));
      assert.equal((await confirmed()).some(row=>row.batchId===received.id),false);
      original=await confirm(checked); assert.equal(original.status,'CONFIRMED');
      const rows=(await confirmed()).filter(row=>row.batchId===original.id);
      assert.equal(rows.length,1); assert.ok(rows[0].bindingSnapshot); assert.ok(rows[0].contentHash);
      const snapshot=JSON.stringify(rows[0].bindingSnapshot);
      assert.equal(snapshot.includes(formulas.PRODUCT.activeVersion.id),true);
      assert.equal(snapshot.includes(prices.PRODUCT.activeVersion.id),true);
      assert.equal(JSON.stringify(rows[0]).includes('500.123456'),true);
      const raw=await db.$queryRawUnsafe('SELECT to_jsonb(l)::text AS raw FROM payroll_input_line l WHERE id = $1::uuid',original.lines[0].id);
      assert.equal(raw[0].raw.includes('500.123456'),false,'financial payload is encrypted at rest');
      assert.equal((await request(path+'/'+original.id+'/confirm',kt,{revision:checked.revision,reason:'Gửi lại quyết định cũ'})).status,409);
    });

    await t.test('units, exact decimals, formula bounds, mismatched components and duplicate inputs cannot confirm',async()=>{
      for(const row of [line({inputs:[{code:'Q',unit:'giờ',value:'500'}]}),line({inputs:[]}),line({inputs:[{code:'Q',unit:'sản phẩm',value:'100001'}]}),line({inputs:[{code:'Q',unit:'sản phẩm',value:'-1'}]}),line({inputs:[{code:'Q',unit:'sản phẩm',value:'1e3'}]}),line({componentId:components.BONUS.id}),line({inputs:[{code:'Q',unit:'sản phẩm',value:'1'},{code:'Q',unit:'sản phẩm',value:'2'}]})]) await invalid(batch({lines:[row]}));
      await invalid(batch({lines:[line({employeeId:employees[5].id,componentId:components.TIME.id,inputType:'TIME',formulaCode:formulas.TIME.code,inputs:[{code:'DAYS',unit:'ngày',value:'24'},{code:'STANDARD',unit:'ngày',value:'26'}]})]}));
    });

    await t.test('piecework, commissions, 3P and independent monetary sources retain exact accepted values',async()=>{
      for(const [key,index,inputs] of [['PIECEWORK',2,[{code:'Q',unit:'lô',value:'2'}]],['COMMISSION',3,[{code:'REVENUE',unit:'VND',value:'125000000'}]],['THREE_P',4,[{code:'KPI',unit:'%',value:'110'}]],...['ALLOWANCE','BONUS','DEDUCTION','EMPLOYER_COST'].map(key=>[key,0,[{code:'VALUE',unit:'VND',value:'300000'}]])]) {
        const item=await accepted(batch({lines:[line({employeeId:employees[index].id,componentId:components[key].id,inputType:key,formulaCode:formulas[key].code,inputs})]}));
        assert.equal(item.lines[0].inputType,key);assert.deepEqual(item.lines[0].inputs,inputs);
        assert.equal((await confirmed()).some(row=>row.id===item.lines[0].id),true);
      }
    });

    await t.test('TIME inputs pin an actual HTTP-locked attendance source, never an OPEN period',async()=>{
      const workDate=after(-1), employee=employees[5];
      const assignment=await db.orgAssignment.findFirstOrThrow({where:{employeeId:employee.id,isPrimary:true}});
      const team=await db.orgUnitVersion.findFirstOrThrow({where:{orgUnitId:assignment.orgUnitId}});
      for(const [username,roleCode,scopeOrgUnitId] of [['tt.bn','TT',team.orgUnitId],['qd.bn','QD',team.parentId]]) {
        const account=await db.userAccount.findUniqueOrThrow({where:{username}});
        await db.roleAssignment.create({data:{userAccountId:account.id,roleCode,scopeOrgUnitId,effectiveFrom:date(after(-20))}});
      }
      const ttActor=await db.userAccount.findUniqueOrThrow({where:{username:'tt.bn'}});
      const shift=await db.shiftDefinition.create({data:{orgUnitId:company.id,code:'INPUT-DAY',name:'Ca kiểm chứng nguồn thời gian',kind:'DAY',startTime:'08:00',endTime:'16:00',crossesMidnight:false,breakStartOffset:240,breakMinutes:0,paidBreak:false,workMinutes:480,isNightShift:false}});
      const plan=await db.shiftPlan.create({data:{teamOrgUnitId:team.orgUnitId,title:'Lịch đã duyệt nguồn thời gian',status:'APPROVED',createdById:ttActor.id}});
      await db.shiftSchedule.create({data:{planId:plan.id,employeeId:employee.id,workDate:date(workDate),shiftId:shift.id,startAt:new Date(workDate+'T08:00:00+07:00'),endAt:new Date(workDate+'T16:00:00+07:00'),workMinutes:480}});
      const attendance=await db.businessPeriod.create({data:{code:'INPUT-TIME-ATTENDANCE',scopeOrgUnitId:site.id,periodType:'ATTENDANCE',dateFrom:date(workDate),dateTo:date(workDate),cutoffDay:25,cutoffPolicyId:(await db.sitePolicy.findFirstOrThrow({where:{orgUnitId:site.id,policyKey:'CUTOFF_DAY'}})).id,status:'OPEN'}});
      const source=batch({attendancePeriodIds:[attendance.id],lines:[line({employeeId:employee.id,componentId:components.TIME.id,inputType:'TIME',workFrom:workDate,workTo:workDate,formulaCode:formulas.TIME.code,inputs:[{code:'DAYS',unit:'ngày',value:'1'},{code:'STANDARD',unit:'ngày',value:'26'}]})]});
      await invalid(source);
      const punches=[[employee.code,workDate,'08:00:00','INPUT-DEVICE','IN'].join(','),[employee.code,workDate,'16:00:00','INPUT-DEVICE','OUT'].join(',')].join('\n');
      const data=new FormData();data.set('file',new Blob([punches],{type:'text/csv'}),'time.csv');data.set('siteId',team.siteId);data.set('referencePeriodId',attendance.id);
      await ok('/attendance/imports',ad,data);await ok('/attendance/process',ad,{siteId:team.siteId,referencePeriodId:attendance.id});
      let review=await ok('/attendance/team-confirmations/review?periodId='+attendance.id+'&teamOrgUnitId='+team.orgUnitId,tt);
      await ok('/attendance/team-confirmations/coverage',ad,{periodId:attendance.id,teamOrgUnitId:team.orgUnitId,revision:review.coverage?.revision??0,sourceHash:review.collection.sourceHash,coveredFrom:review.collection.from,coveredUntil:review.collection.until,batchIds:review.collection.requiredBatchIds,reference:'BB-DU-NGUON-TIME',reason:'Đối chiếu nguồn thật cho đầu vào thời gian'});
      review=await ok('/attendance/team-confirmations/review?periodId='+attendance.id+'&teamOrgUnitId='+team.orgUnitId,tt);
      await ok('/attendance/team-confirmations',tt,{periodId:attendance.id,teamOrgUnitId:team.orgUnitId,revision:review.revision,sourceHash:review.sourceHash,reviewed:true,acknowledgeWarnings:true,note:'Xác nhận nguồn công'});
      const workshop=await ok('/attendance/workshop-closures/review?periodId='+attendance.id+'&workshopOrgUnitId='+team.parentId,qd);
      await ok('/attendance/workshop-closures',qd,{periodId:attendance.id,workshopOrgUnitId:team.parentId,revision:workshop.revision,sourceHash:workshop.sourceHash,reviewed:true,acknowledgeWarnings:true,note:'Chốt công cho nguồn thời gian'});
      const lock=await ok('/attendance/period-locks/review?periodId='+attendance.id,kt);
      await ok('/attendance/period-locks',kt,{periodId:attendance.id,revision:lock.revision,sourceHash:lock.sourceHash,reviewed:true,acknowledgeWarnings:true,note:'Khóa nguồn để đối chiếu đầu vào lương'});
      const received=(await ok(path+'?search='+source.sourceDocumentNo,kt)).items[0];
      const checked=await validate(received);assert.equal(checked.status,'VALIDATED',JSON.stringify(checked.validation));
      const item=await confirm(checked);const pinned=item.lines[0].bindingSnapshot.attendance;
      assert.equal(pinned[0].periodId,attendance.id);assert.equal(pinned[0].sourceHash,lock.sourceHash);
      assert.equal(item.payrollPeriod.status,'OPEN');
    });

    await t.test('mixed employee scope, dated exclusions and own salary writes reject the whole batch',async()=>{
      const mixed=batch({lines:[line(),line({sourceLineId:'REMOTE',employeeId:remoteEmployee.id})]});
      assert.equal((await request(path,local,mixed)).status,404);
      const actor=await db.userAccount.findUniqueOrThrow({where:{username:'kt.bn'}});
      const exclusion=await db.employeeExclusion.create({data:{userAccountId:actor.id,employeeId:employees[0].id,effectiveFrom:date(after(-1))}});
      try {assert.equal((await request(path+'/'+original.id,local)).status,404);assert.equal((await request(path,local,batch())).status,404);} finally {await db.employeeExclusion.delete({where:{id:exclusion.id}});}
      const own=await request(path,local,batch({lines:[line({employeeId:actor.employeeId})]})); assert.ok([403,404].includes(own.status));
    });

    await t.test('protected evidence invalidates validation and downloads require complete batch scope',async()=>{
      let item=await validate(await create(batch())); assert.equal(item.status,'VALIDATED');
      const form=new FormData(); form.set('file',new Blob(['Chứng từ nghiệm thu riêng tư 123456789'],{type:'text/plain'}),'nghiem-thu.txt');
      const upload=await fetch('http://127.0.0.1:'+port+'/api'+path+'/'+item.id+'/evidence',{method:'POST',headers:{cookie:kt},body:form}); assert.equal(upload.status,201);
      item=(await upload.json()).item; assert.equal(item.status,'DRAFT'); assert.ok(item.evidence[0].sha256);
      const filePath=path+'/'+item.id+'/evidence/'+item.evidence[0].id;
      const file=await fetch('http://127.0.0.1:'+port+'/api'+filePath,{headers:{cookie:local}}); assert.equal(file.status,200); assert.equal(await file.text(),'Chứng từ nghiệm thu riêng tư 123456789');
      const denied=await fetch('http://127.0.0.1:'+port+'/api'+filePath,{headers:{cookie:tt}}); assert.equal(denied.status,403);
      const confirmedItem=await confirm(await validate(item));
      const form2=new FormData();form2.set('file',new Blob(['Không được thay đổi sau xác nhận']), 'khac.txt');
      assert.equal((await fetch('http://127.0.0.1:'+port+'/api'+path+'/'+confirmedItem.id+'/evidence',{method:'POST',headers:{cookie:kt},body:form2})).status,409);
    });

    await t.test('team allocations require explicit balanced totals and do not duplicate whole group amount',async()=>{
      const group={key:'GROUP-1',teamOrgUnitId:(await db.orgAssignment.findFirstOrThrow({where:{employeeId:employees[6].id,isPrimary:true}})).orgUnitId,acceptedAmount:'4000000',reference:'BB-PHAN-BO-TO'};
      const teamLines=[line({employeeId:employees[6].id,teamAllocationKey:group.key,allocatedAmount:'2500000'}),line({sourceLineId:'LINE-2',employeeId:employees[7].id,teamAllocationKey:group.key,allocatedAmount:'1500000'})];
      await invalid(batch({lines:teamLines}));
      await invalid(batch({lines:teamLines.map(row=>({...row,allocatedAmount:'4000000'})),teamAllocations:[group]}));
      const valid=await accepted(batch({lines:teamLines,teamAllocations:[group]}));
      assert.deepEqual(valid.lines.map(row=>row.allocatedAmount).sort(),['1500000','2500000']);
      assert.equal(valid.teamAllocations[0].acceptedAmount,'4000000');
    });

    await t.test('only an explicitly linked replacement displaces a confirmed source, atomically',async()=>{
      const previous=await get(original.id);
      const body=batch({sourceSystem:previous.sourceSystem,sourceDocumentNo:previous.sourceDocumentNo,sourceVersion:'V2',supersedesBatchId:previous.id,lines:previous.lines.map(row=>({sourceLineId:row.sourceLineId,employeeId:row.employeeId,componentId:row.componentId,inputType:row.inputType,workFrom:row.workFrom,workTo:row.workTo,valueState:row.valueState,calculationMode:row.calculationMode,formulaCode:row.formulaCode,inputs:[{code:'Q',unit:'sản phẩm',value:'450'}],businessReference:row.businessReference,supersedesLineId:row.id}))});
      const draft=await create(body); assert.equal((await confirmed()).some(row=>row.batchId===previous.id),true);
      const checked=await validate(draft); assert.equal(checked.status,'VALIDATED',JSON.stringify(checked.validation));
      const result=await confirm(checked);
      assert.equal((await get(previous.id)).status,'SUPERSEDED');
      const rows=await confirmed();assert.equal(rows.some(row=>row.batchId===previous.id),false);assert.equal(rows.filter(row=>row.batchId===result.id).length,1);
      assert.equal(result.lines[0].supersedesLineId,previous.lines[0].id);
      assert.equal((await get(previous.id)).lines[0].inputs[0].value,'500.123456');
      original=result;
    });

    await t.test('changing document keys does not repay the same business milestone',async()=>{
      const prior=(await get(original.id)).lines[0];
      const copied=line({employeeId:prior.employeeId,componentId:prior.componentId,workFrom:prior.workFrom,workTo:prior.workTo,businessReference:prior.businessReference});
      await invalid(batch({lines:[copied]}));
    });

    await t.test('concurrent confirm produces one transition and one stale conflict',async()=>{
      const checked=await validate(await create(batch()));assert.equal(checked.status,'VALIDATED');
      const results=await Promise.all([1,2].map(()=>request(path+'/'+checked.id+'/confirm',kt,{revision:checked.revision,reason:'Cạnh tranh xác nhận'})));
      assert.deepEqual(results.map(row=>row.status).sort(),[201,409]);
      const final=await get(checked.id);assert.equal(final.history.filter(row=>row.action==='CONFIRM').length,1);
      assert.equal((await confirmed()).filter(row=>row.batchId===checked.id).length,1);
    });

    await t.test('return revokes the source from the confirmed reader without changing its accepted data',async()=>{
      const prior=await accepted(batch());
      const returned=(await ok(path+'/'+prior.id+'/return',kt,{revision:prior.revision,reason:'Chứng từ nghiệm thu cần đối chiếu lại'})).item;
      assert.equal(returned.status,'RETURNED');assert.deepEqual(returned.lines,prior.lines);
      assert.equal((await confirmed()).some(row=>row.batchId===prior.id),false);
      assert.equal(returned.history.at(-1).reason,'Chứng từ nghiệm thu cần đối chiếu lại');
    });

    await t.test('CSV import groups stable source ids, supports quoting, and rejects partial/conflicting imports',async()=>{
      const template=await fetch('http://127.0.0.1:'+port+'/api'+path+'/template',{headers:{cookie:kt}});assert.equal(template.status,200);const header=(await template.text()).replace(/^\uFEFF/,'').split(/\r?\n/)[0];
      const columns=header.split(',').map(value=>value.replace(/^"|"$/g,''));assert.ok(columns.includes('sourceLineId'));assert.ok(columns.includes('inputCode'));
      const value={sourceLineId:'CSV-STABLE-1',employeeCode:employees[0].code,componentCode:components.PRODUCT.code,inputType:'PRODUCT',workFrom:today,workTo:today,valueState:'PRESENT',calculationMode:'FORMULA',formulaCode:formulas.PRODUCT.code,inputCode:'Q',inputUnit:'sản phẩm',inputValue:'17',businessReference:'Mốc CSV, có dấu phẩy'};
      const csv='\uFEFF'+header+'\r\n'+columns.map(key=>'"'+String(value[key]??'').replaceAll('"','""')+'"').join(',')+'\r\n';
      const metadata=batch(); delete metadata.lines;
      async function importCsv(content, meta=metadata) {const data=new FormData();data.set('metadata',JSON.stringify(meta));data.set('file',new Blob([content],{type:'text/csv'}),'nguon.csv'); const response=await fetch('http://127.0.0.1:'+port+'/api'+path+'/import',{method:'POST',headers:{cookie:kt},body:data});return {status:response.status,body:await response.json()};}
      const first=await importCsv(csv); assert.equal(first.status,201,JSON.stringify(first));
      const second=await importCsv(csv);assert.equal(second.body.duplicate,true);assert.equal(second.body.item.id,first.body.item.id);
      assert.equal(first.body.item.lines[0].sourceLineId,value.sourceLineId);
      assert.equal(first.body.item.lines[0].inputs[0].value,'17');assert.ok(first.body.item.fileHash);
      const bad=await importCsv(csv+'"unterminated', {...metadata,sourceDocumentNo:'INVALID-CSV'});assert.equal(bad.status,400);
      assert.equal((await ok(path+'?search=INVALID-CSV',kt)).items.length,0);
    });

    await t.test('finite/date-changed sources require splitting and confirm rechecks pinned dependencies',async()=>{
      const changeAt=after(2);
      const priceVersion=prices.PRODUCT.versions[0];const {id,createdAt,createdBy,...fields}=priceVersion;
      let item=await validate(await create(batch({lines:[line({workFrom:changeAt,workTo:changeAt})]})));assert.equal(item.status,'VALIDATED',JSON.stringify(item.validation));
      await ok('/payroll-configuration/'+prices.PRODUCT.id+'/versions',kt,{...fields,effectiveTo:undefined,revision:prices.PRODUCT.revision,effectiveFrom:changeAt,amount:'2500'});
      const stale=await request(path+'/'+item.id+'/confirm',kt,{revision:item.revision,reason:'Không dùng giá cũ đã đổi'});assert.equal(stale.status,409);
      await invalid(batch({lines:[line({workFrom:today,workTo:after(3)})]}));
      item=await validate(await get(item.id));assert.equal(item.status,'VALIDATED',JSON.stringify(item.validation));const good=await confirm(item);assert.equal(good.status,'CONFIRMED');
    });

    await t.test('direct amounts require a basis and negative adjustments must link their original source',async()=>{
      const raw=line({componentId:components.ALLOWANCE.id,inputType:'ALLOWANCE',calculationMode:'AMOUNT',formulaCode:undefined,inputs:[],amount:'1234567.123456',unit:'VND',amountBasis:'QD-PHU-CAP-TRUC-TIEP',businessReference:'QD-PC-123'});
      const paid=await accepted(batch({lines:[raw]}));assert.equal(paid.lines[0].amount,'1234567.123456');
      await invalid(batch({lines:[{...raw,businessReference:'QD-PC-BAD',amountBasis:undefined}]}));
      await invalid(batch({lines:[{...raw,businessReference:'QD-PC-NEGATIVE',amount:'-1000'}]}));
      const adjusted=await accepted(batch({lines:[{...raw,sourceLineId:'ADJUSTMENT-1',inputType:'ADJUSTMENT',businessReference:'DC-PC-123',amount:'-1000',adjustmentOfLineId:paid.lines[0].id,amountBasis:'Biên bản điều chỉnh nguồn gốc'}]}));
      assert.equal(adjusted.lines[0].adjustmentOfLineId,paid.lines[0].id);assert.equal((await get(paid.id)).status,'CONFIRMED');
      await invalid(batch({lines:[{...raw,sourceLineId:'ADJUSTMENT-REPLAY',inputType:'ADJUSTMENT',businessReference:'DC-PC-123',amount:'-1000',adjustmentOfLineId:paid.lines[0].id,amountBasis:'Biên bản điều chỉnh nguồn gốc'}]}),'PAYROLL_BUSINESS_DUPLICATE');
    });

    await t.test('read-only KT can inspect accepted sources but cannot change decisions',async()=>{
      const role=await db.role.findUniqueOrThrow({where:{code:'KT'}});
      try {await db.role.update({where:{code:'KT'},data:{permissions:role.permissions.filter(p=>p!=='payroll.inputs.manage')}});const cookie=await login('kt.bn');const context=await ok(path+'/context',cookie);assert.deepEqual(context.managementUnits,[]);assert.equal((await request(path+'/'+original.id,cookie)).status,200);assert.equal((await request(path,cookie,batch())).status,403);}finally{await db.role.update({where:{code:'KT'},data:{permissions:role.permissions}});}
    });

    await t.test('SQL immutability, encrypted audit and payroll lock guard preserve accepted sources',async()=>{
      const acceptedLine=original.lines[0];
      await assert.rejects(db.$executeRawUnsafe('UPDATE payroll_input_line SET input_hash = $1 WHERE id = $2::uuid','f'.repeat(64),acceptedLine.id), error => error.meta?.code === 'P0001');
      await assert.rejects(db.$executeRawUnsafe('DELETE FROM payroll_input_line WHERE id = $1::uuid',acceptedLine.id));
      await assert.rejects(db.$executeRawUnsafe('TRUNCATE payroll_input_line CASCADE'));
      const audit=await db.auditLog.findMany({where:{entityId:original.id},select:{action:true,oldValue:true,newValue:true}});assert.ok(audit.some(row=>row.action==='CONFIRM'));
      assert.equal(JSON.stringify(audit).includes('500.123456'),false);
      await db.payrollPeriod.update({where:{id:period.id},data:{status:'LOCKED'}});
      const blocked=await request(path,kt,batch());assert.equal(blocked.status,409);
      const before=await get(original.id);const returned=await request(path+'/'+before.id+'/return',kt,{revision:before.revision,reason:'Không được thay nguồn kỳ khóa'});assert.equal(returned.status,409);
      assert.deepEqual((await get(before.id)).lines,before.lines);
      const nextPeriod=(await ok(path+'/periods',kt,{code:'INPUT-ADJUSTMENT',siteOrgUnitId:site.id,dateFrom:after(11),dateTo:after(20)})).period;
      const linked=await accepted(batch({payrollPeriodId:nextPeriod.id,lines:[line({inputType:'ADJUSTMENT',workFrom:after(11),workTo:after(11),calculationMode:'AMOUNT',formulaCode:undefined,inputs:[],amount:'-1000',unit:'VND',amountBasis:'Điều chỉnh chênh lệch nguồn kỳ đã khóa',adjustmentOfLineId:acceptedLine.id})]}));
      assert.equal(linked.status,'CONFIRMED');assert.equal(linked.lines[0].adjustmentOfLineId,acceptedLine.id);
      assert.equal((await get(original.id)).status,'CONFIRMED');assert.deepEqual((await get(original.id)).lines,before.lines);
    });
  } finally {
    if (server) { server.kill(); await new Promise(done => server.exitCode !== null ? done() : server.once('exit', done)); }
    if (db) await db.$disconnect();
    await admin.$executeRawUnsafe('DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)');
    await admin.$disconnect(); rmSync(credentialsPath, { force: true });
  }
});
