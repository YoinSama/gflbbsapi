import { Hono } from 'hono';
import { config } from './config';
import { loadToken } from './store';

export const proxy = new Hono();

/**
 * 通用代理：把 /api/community/* 转发到社区 API，并自动附加已保存的 token。
 * 这样前端（展示页 / 管理页的 API 测试）无需直接接触 token，也不受浏览器 CORS 限制。
 */
proxy.all('*', async (c) => {
  const u = new URL(c.req.url);
  const path = u.pathname.replace(/^\/api\/community\/?/, '');
  const target = `${config.bbsApiBase}/${path}${u.search}`;

  const token = (await loadToken())?.token;
  const headers = new Headers(c.req.raw.headers);
  if (token && !headers.has('authorization')) headers.set('authorization', token);
  headers.delete('host');
  headers.delete('content-length');

  let body: ArrayBuffer | undefined;
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    const buf = await c.req.arrayBuffer();
    if (buf.byteLength) body = buf;
  }

  try {
    const upstream = await fetch(target, { method: c.req.method, headers, body });
    const out = new Headers(upstream.headers);
    out.delete('content-encoding');
    out.delete('content-length');
    out.delete('transfer-encoding');
    return new Response(upstream.body, { status: upstream.status, headers: out });
  } catch (e: any) {
    return c.json({ ok: false, message: '代理请求失败: ' + (e?.message || e) }, 502);
  }
});
