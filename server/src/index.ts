import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { config } from './config';
import { auth } from './auth';
import { proxy } from './proxy';
import { admin } from './admin';
import { endpointPresets } from './endpoints';

const app = new Hono();

app.get('/api/health', (c) => c.json({ ok: true, ts: Date.now() }));
app.get('/api/endpoints', (c) => c.json(endpointPresets));
app.route('/api/auth', auth);
app.route('/api/admin', admin);
app.route('/api/community', proxy);

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
