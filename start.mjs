#!/usr/bin/env node
// GFL2 社区 API — 跨平台一键启动（Windows / Linux / macOS 通用）
// 启动策略：
//   1) 若本机可用 pm2（推荐：进程守护 + 崩溃自愈 + 可开机自启），用 pm2 拉起；
//   2) 否则退回直接 `node server/dist/index.js`。
// 用法：
//   node start.mjs           （任意平台）
//   ./start.mjs             （需 chmod +x，Linux/macOS）
//   start.bat               （Windows 双击，内部委托给本脚本）
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const distIndex = resolve(root, 'server/dist/index.js');

function build() {
  console.log('[start] 未检测到构建产物 server/dist/index.js，开始构建…');
  const pm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const r = spawnSync(pm, ['-r', 'build'], { cwd: root, stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.error('[start] 构建失败，请先手动运行 `pnpm -r build`。');
    process.exit(1);
  }
}

if (!existsSync(distIndex)) {
  build();
  if (!existsSync(distIndex)) {
    console.error('[start] 构建后仍缺少 server/dist/index.js，退出。');
    process.exit(1);
  }
}

// 探测 pm2 可执行文件：优先本地 bin，其次全局 PATH
function findPm2() {
  const localRel = process.platform === 'win32' ? 'node_modules/.bin/pm2.cmd' : 'node_modules/.bin/pm2';
  const local = resolve(root, localRel);
  if (existsSync(local)) return local;
  const g = spawnSync(process.platform === 'win32' ? 'pm2.cmd' : 'pm2', ['--version'], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  return g.status === 0 ? (process.platform === 'win32' ? 'pm2.cmd' : 'pm2') : null;
}

const pm2 = findPm2();
if (pm2) {
  console.log('[start] 使用 pm2 守护进程启动（崩溃自愈 / 可 `pm2 startup` 开机自启）');
  const r = spawnSync(pm2, ['start', 'server/ecosystem.config.cjs', '--update-env'], {
    cwd: root,
    stdio: 'inherit',
    shell: true,
  });
  if (r.status !== 0) {
    console.error('[start] pm2 启动失败（端口可能被其它进程占用？），回退到直接 node 启动。');
  } else {
    spawnSync(pm2, ['save'], { cwd: root, stdio: 'inherit', shell: true });
    console.log('[start] 已通过 pm2 启动。常用命令：');
    console.log('         pm2 status | pm2 logs gfl2-community-api | pm2 restart gfl2-community-api');
    console.log('         pm2 startup   # 仅首次需按提示执行生成的命令，配置开机自启');
    process.exit(0);
  }
}

console.log('[start] 未检测到 pm2，退回直接启动: node server/dist/index.js  (http://localhost:8787)');
const child = spawn('node', [distIndex], { cwd: root, stdio: 'inherit', env: process.env });
const shutdown = (sig) => {
  if (child.exitCode === null) child.kill(sig);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
child.on('exit', (code) => process.exit(code ?? 0));
