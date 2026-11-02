#!/usr/bin/env node
// LOCAL DEMO ONLY — one command to turn a fresh `docker compose up` into a full demo on any machine:
//   1. seed the fictional company (idempotent)           4. load the payroll configuration examples
//   2. build the backend helpers used on the host         5. generate attendance history with the punch simulator
//   3. demo accounts + one shared password (DEMO_PASSWORD)
//   npm run demo:setup [-- --from 2026-07-26 --to 2026-11-01 --skip-history]
// Every step is idempotent and the simulator is deterministic, so two machines get the same punches and attendance.
const { spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '..');
if (existsSync(resolve(root, '.env'))) process.loadEnvFile(resolve(root, '.env'));
const args = process.argv.slice(2);
const option = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const apiPort = process.env.API_PORT || '3000';
const databaseUrl = `postgresql://hrtp_demo:${encodeURIComponent(process.env.POSTGRES_PASSWORD || '')}@127.0.0.1:${process.env.DB_PORT || 5434}/hrtp_demo?schema=public&connection_limit=5&connect_timeout=5&pool_timeout=30&socket_timeout=120`;
if (!process.env.POSTGRES_PASSWORD) { console.error('Thiếu POSTGRES_PASSWORD trong .env — dự án đã chạy bằng Docker chưa?'); process.exit(1); }
if (!process.env.DEMO_PASSWORD) { console.error('Đặt DEMO_PASSWORD trong .env (ví dụ DEMO_PASSWORD=Hrtp@Demo2026), rồi chạy lại.'); process.exit(1); }
// The Docker database is the demo database; host-side helpers reach it through the published port.
const env = { ...process.env, DATABASE_URL: databaseUrl, PORT: apiPort, HRTP_SIM_API: `http://127.0.0.1:${apiPort}/api`, HRTP_SIM_USER: 'admin', HRTP_SIM_PASSWORD: process.env.DEMO_PASSWORD };

function step(title, command, commandArgs) {
  console.log('\n▶ ' + title);
  const result = spawnSync(command, commandArgs, { cwd: root, env, stdio: 'inherit' });
  if (result.status !== 0) { console.error('✗ Dừng ở bước: ' + title); process.exit(result.status ?? 1); }
}

(async () => {
  const health = await fetch(`http://127.0.0.1:${apiPort}/api/health`).then(r => r.ok).catch(() => false);
  if (!health) { console.error(`API chưa chạy ở cổng ${apiPort}. Chạy: docker compose up -d --build --wait`); process.exit(1); }
  step('Seed dữ liệu doanh nghiệp mô phỏng', 'docker', ['compose', 'exec', '-T', 'backend', 'node', 'prisma/seed.cjs']);
  step('Build backend (hàm băm mật khẩu cho bước 3)', 'npm', ['run', 'build', '--workspace', 'backend']);
  step('Tài khoản demo và mật khẩu chung', process.execPath, ['scripts/demo-accounts.cjs']);
  step('Cấu hình lương mẫu (cấu phần, đơn giá, công thức)', process.execPath, ['scripts/seed-payroll-demo.cjs']);
  if (!args.includes('--skip-history')) {
    const range = [...(option('--from') ? ['--from', option('--from')] : []), ...(option('--to') ? ['--to', option('--to')] : [])];
    step('Sinh chấm công lịch sử (có thể mất vài chục phút)', process.execPath, ['tools/punch-simulator/history.cjs', ...range]);
  }
  console.log(`\n✓ Xong. Mở http://localhost:${process.env.WEB_PORT || 8080}, đăng nhập bằng kt.all / tt.bn / qd.bn / admin với mật khẩu ${process.env.DEMO_PASSWORD}.`);
  console.log('  Để form đăng nhập hiện mật khẩu dạng chữ thường: docker compose up -d --build frontend simulator');
})();
