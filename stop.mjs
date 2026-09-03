#!/usr/bin/env node
// GFL2 社区 API — 跨平台一键停止（Windows / Linux / macOS 通用）
// 停止策略：
//   1) 若服务由 pm2 守护（start.mjs 默认走 pm2），用 `pm2 delete` 移除并 `pm2 save`，
//      确保 dump 清空、重启/复活时不会自动回来；
//   2) 否则（start.mjs 的 node 直接启动回退）按命令行匹配杀掉 node server/dist/index.js 进程。
// 用法：
//   node stop.mjs            （任意平台）
//   ./stop.mjs              （需 chmod +x，Linux/macOS）
//   stop.bat                （Windows 双击，内部委托给本脚本）
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const APP_NAME = 'gfl2-community-api'; // 必须与 server/ecosystem.config.cjs 的 name 一致
const PORT = 8787;
const MARKER = 'server/dist/index.js'; // 回退启动时的进程命令行特征

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

function run(cmd, args) {
  return spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: true });
}

// 用 pm2 停止：delete 同时停止并从列表移除（应用不存在时返回非 0，可忽略）；
// 再 save 让 dump 清空，避免 pm2 startup / resurrect 时它又起来。
function stopByPm2(pm2) {
  console.log(`[stop] 使用 pm2 停止并移除应用 ${APP_NAME} …`);
  run(pm2, ['delete', APP_NAME]);
  run(pm2, ['save']);
  console.log(`[stop] 已移除 ${APP_NAME}（pm2 列表已清空该条目）。`);
}

// 回退：直接 node 启动的进程，按命令行匹配杀掉（跨平台）
function stopByKill() {
  console.log('[stop] 未检测到 pm2，按进程命令行停止 node server/dist/index.js …');
  if (process.platform === 'win32') {
    const ps = [
      "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\"",
      `| Where-Object { $_.CommandLine -like "*${MARKER}*" }`,
      '| ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }',
    ].join(' ');
    spawnSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });
  } else {
    const pr = spawnSync('pkill', ['-f', MARKER], { stdio: 'inherit' });
    if (pr.status !== 0) {
      // pkill 不可用则解析 ps 逐个 kill（跳过本脚本自身）
      const out = spawnSync('ps', ['-e', '-o', 'pid,args'], { encoding: 'utf8' }).stdout || '';
      out.split('\n').forEach((line) => {
        if (line.includes(MARKER) && !line.includes('stop.mjs')) {
          const pid = line.trim().split(/\s+/)[0];
          if (pid && /^\d+$/.test(pid)) spawnSync('kill', ['-TERM', pid]);
        }
      });
    }
  }
  console.log('[stop] 已发送停止信号。');
}

// 确认端口已无响应
function verifyDown() {
  try {
    const r = spawnSync('curl', ['-s', '-m', '3', '-o', '/dev/null', '-w', '%{http_code}', `http://localhost:${PORT}/`], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const code = (r.stdout || '').toString().trim();
    if (code && code !== '000') {
      console.log(`[stop] 注意：端口 ${PORT} 仍返回 HTTP ${code}，可能还有其它进程在监听（pm2 之外的实例）。`);
    } else {
      console.log(`[stop] 确认：端口 ${PORT} 已无响应，服务已停止。`);
    }
  } catch {
    console.log(`[stop] 确认：端口 ${PORT} 已无响应，服务已停止。`);
  }
}

const pm2 = findPm2();
if (pm2) {
  stopByPm2(pm2);
} else {
  stopByKill();
}
verifyDown();
console.log('[stop] 完成。如需重新启动：node start.mjs');
