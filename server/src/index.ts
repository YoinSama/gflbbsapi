import { serve } from '@hono/node-server';
import { Hono, type Context, type Next } from 'hono';
import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { config } from './config';
import { auth } from './auth';
import { proxy } from './proxy';
import { admin } from './admin';
import { endpointPresets } from './endpoints';
import { tasks } from './tasks';

const app = new Hono();

// ---------- CORS（仅允许同源与配置的来源跨域调用）----------
const corsOrigins = config.corsOrigins
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use('/api/*', async (c: Context, next: Next) => {
  const origin = c.req.header('Origin');
  const reqHost = new URL(c.req.url).host;
  let allow: string | null = null;
  if (!origin) {
    allow = '*'; // 同源 / 非浏览器调用
  } else {
    let oHost = '';
    try {
      oHost = new URL(origin).host;
    } catch {
      /* ignore */
    }
    if (corsOrigins.includes(origin) || oHost === reqHost) allow = origin;
  }
  if (allow) {
    c.header('Access-Control-Allow-Origin', allow);
    c.header('Access-Control-Allow-Headers', 'content-type, x-api-key');
    c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    c.header('Access-Control-Max-Age', '86400');
  }
  if (c.req.method === 'OPTIONS') return new Response(null, { status: 204 });
  await next();
});

// ---------- API Key 守卫（跨域调用代理/任务接口必须带 x-api-key）----------
app.use('/api/community/*', apiKeyGuard);
app.use('/api/tasks/*', apiKeyGuard);

async function apiKeyGuard(c: Context, next: Next) {
  if (c.req.method === 'OPTIONS') return next();
  const cfgKey = config.apiKey;
  if (!cfgKey) return next(); // 未配置 API_KEY 时向后兼容，不校验
  const origin = c.req.header('Origin');
  const reqHost = new URL(c.req.url).host;
  if (origin) {
    let oHost = '';
    try {
      oHost = new URL(origin).host;
    } catch {
      /* ignore */
    }
    if (oHost === reqHost) return next(); // 同源（管理页）放行
  } else {
    return next(); // 无 Origin 的服务端调用放行
  }
  const provided = c.req.header('x-api-key') || c.req.query('api_key') || '';
  if (provided === cfgKey) return next();
  return c.json({ ok: false, message: '未授权：缺少或错误的 API Key' }, 403);
}

app.get('/api/health', (c) => c.json({ ok: true, ts: Date.now() }));
app.get('/api/endpoints', (c) => c.json(endpointPresets));
app.route('/api/auth', auth);
app.route('/api/admin', admin);
app.route('/api/community', proxy);
app.route('/api/tasks', tasks);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// 生产环境下托管前端构建产物（SPA：未知路径回退 index.html）
app.get('*', async (c) => {
  if (!existsSync(config.webDist)) {
    return c.json({ ok: false, message: '前端未构建，请先 pnpm --prefix web build' }, 404);
  }
  const root = resolve(config.webDist);
  const urlPath = decodeURIComponent(new URL(c.req.url).pathname);
  const filePath = join(config.webDist, urlPath === '/' ? 'index.html' : urlPath);
  const safe = resolve(filePath);
  if (safe.startsWith(root)) {
    try {
      const data = await fs.readFile(safe);
      const type = MIME[extname(safe)] || 'application/octet-stream';
      return new Response(data, { headers: { 'content-type': type } });
    } catch {
      /* 落到下面的 SPA 回退 */
    }
  }
  try {
    const data = await fs.readFile(join(config.webDist, 'index.html'));
    return new Response(data, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  } catch {
    return c.json({ ok: false, message: '前端资源缺失' }, 404);
  }
});

serve({ port: config.port, fetch: app.fetch }, (info) => {
  console.log(`[gfl2-community-api] 运行中: http://localhost:${info.port}`);
  console.log(`[gfl2-community-api] 社区 API 基础地址: ${config.bbsApiBase}`);
});
