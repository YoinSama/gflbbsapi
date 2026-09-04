import { Hono } from 'hono';
import { config } from './config';
import { loadToken } from './store';

export const proxy = new Hono();

/**
 * fetch 社区 API，并剥离压缩/长度/分块响应头，使响应能在代理中正确流式转发。
 * 同时被 /api/community 代理路由与 callCommunity（服务端脚本）复用。
 */
export async function fetchUpstream(target: string, init: RequestInit): Promise<Response> {
  const upstream = await fetch(target, init);
  const out = new Headers(upstream.headers);
  out.delete('content-encoding');
  out.delete('content-length');
  out.delete('transfer-encoding');
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

/**
 * 服务端直接调用社区接口（自动附加已保存 token），供自动任务等脚本复用。
 * - path 形如 /community/...（不含 /api/community 前缀），search 形如 ?x=1。
 * - 仅携带必要的 authorization / content-type / accept / user-agent，不做浏览器转发。
 */
export async function callCommunity(
  method: string,
  path: string,
  body?: unknown,
  search = '',
): Promise<Response> {
  const target = `${config.bbsApiBase}${path}${search}`;
  const token = (await loadToken())?.token;
  const headers = new Headers();
  if (token) headers.set('authorization', token);
  headers.set('accept', 'application/json');
  headers.set('user-agent', 'Mozilla/5.0 (compatible; gfl2-community-api)');
  let initBody: RequestInit['body'];
  if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
    initBody = typeof body === 'string' ? body : JSON.stringify(body);
    headers.set('content-type', 'application/json');
  }
  return fetchUpstream(target, { method, headers, body: initBody });
}

proxy.all('*', async (c) => {
  const u = new URL(c.req.url);
  // 剥掉 /api/community 前缀后，路径必须仍以 / 开头（否则与 base 拼接成
  // "...exiliumgf.comcommunity/..." 粘连 → DNS ENOTFOUND → 502 fetch failed）
  const path =
    '/' + u.pathname.replace(/^\/api\/community\/?/, '').replace(/^\/+/, '');
  const target = `${config.bbsApiBase}${path}${u.search}`;

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
    return await fetchUpstream(target, { method: c.req.method, headers, body });
  } catch (e: any) {
    return c.json({ ok: false, message: '代理请求失败: ' + (e?.message || e) }, 502);
  }
});
