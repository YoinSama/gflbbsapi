import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const serverSrc = dirname(fileURLToPath(import.meta.url)); // .../server/src
const serverRoot = resolve(serverSrc, '..'); // .../server
const projectRoot = resolve(serverRoot, '..'); // .../<project>

// 极简 .env 加载：零依赖、可被 esbuild 安全打包（dotenv 是 CJS，打包进 ESM 会触发
// "Dynamic require of fs is not supported"）。仅当环境变量尚未设置时才填充，
// 真实环境变量 / systemd 变量优先。
function loadEnvFile(path: string): void {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return; // 文件不存在时忽略
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile(resolve(projectRoot, '.env'));

export const config = {
  // 社区 API 基础地址（登录与代理都走它）
  bbsApiBase: process.env.BBS_API_BASE || 'https://gf2-bbs-api.exiliumgf.com',
  // 登录加密密钥（来自官方社区前端脚本，AES-128-CBC 的 key 与 iv）
  encryptionKey: process.env.ENCRYPTION_KEY || 'a86a86^oH$04r6A1',
  port: Number(process.env.PORT || 8787),
  // 允许的跨域来源（逗号分隔）；默认仅同源（管理页）可用
  corsOrigins: process.env.CORS_ORIGINS || '',
  // 前端构建产物目录（后端会托管它）
  webDist: resolve(serverRoot, process.env.WEB_DIST || '../web/dist'),
  // 运行时数据目录（token 存这里）
  dataDir: resolve(serverRoot, process.env.DATA_DIR || './data'),
};
