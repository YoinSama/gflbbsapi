import { Hono } from 'hono';
import { callCommunity } from './proxy';
import { loadToken } from './store';

export const tasks = new Hono();

interface StepResult {
  name: string;
  ok: boolean;
  detail: string;
}

/** 解析社区接口返回的 JSON；非 JSON 时回退为 { raw, status } */
async function parseJson(res: Response): Promise<any> {
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    try {
      return await res.json();
    } catch {
      /* fallthrough */
    }
  }
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text, status: res.status };
  }
}

/** 从帖子列表响应里提取前 n 个帖子 id，兼容 topic_id / id 字段名 */
function pickTopicIds(data: any, n: number): number[] {
  const arr: any[] = Array.isArray(data) ? data : data?.list || data?.data || [];
  const ids: number[] = [];
  for (const t of arr) {
    const id = t?.topic_id ?? t?.id;
    if (id != null && !Number.isNaN(Number(id))) ids.push(Number(id));
    if (ids.length >= n) break;
  }
  return ids;
}

/**
 * 一键社区任务 + 自动兑换：
 *   1) 拉取最新帖子列表，取前 3 个 id
 *   2) 浏览 3 个不同帖子（GET /community/topic/{id}?id={id}）
 *   3) 点赞 3 个不同帖子（GET /community/topic/like/{id}?id={id}）
 *   4) 分享 1 个帖子（GET /community/topic/share/{id}?id={id}）
 *   5) 自动兑换：对 exchange_count < max_exchange_count 的物品，
 *      按 (max - count) 次调用 POST /community/item/exchange
 * 浏览/点赞/分享失败不影响自动兑换（二者相互独立）。每个步骤都记录成败明细。
 */
tasks.post('/run', async (c) => {
  const token = (await loadToken())?.token;
  if (!token) {
    return c.json(
      { ok: false, message: '尚未登录社区账号（无 token），请先在管理页登录社区账号' },
      400,
    );
  }

  const steps: StepResult[] = [];
  const log = (name: string, ok: boolean, detail: string) => steps.push({ name, ok, detail });

  // 0. 拉取最新帖子列表（供后续任务取 id）
  let topicIds: number[] = [];
  try {
    const r = await callCommunity('GET', '/community/topic/list', undefined, '?sort_type=2');
    const j = await parseJson(r);
    if (j.Code !== 0) throw new Error('topic/list Code=' + j.Code);
    topicIds = pickTopicIds(j.data, 3);
    log('获取最新帖子列表', true, `取到 ${topicIds.length} 个帖子 id: ${topicIds.join(', ') || '(空)'}`);
  } catch (e: any) {
    log('获取最新帖子列表', false, e?.message || String(e));
  }

  // 1. 浏览 3 个不同帖子
  for (const id of topicIds.slice(0, 3)) {
    try {
      const r = await callCommunity('GET', `/community/topic/${id}`, undefined, `?id=${id}`);
      const j = await parseJson(r);
      log(`浏览帖子 ${id}`, j.Code === 0, `Code=${j.Code}`);
    } catch (e: any) {
      log(`浏览帖子 ${id}`, false, e?.message || String(e));
    }
  }

  // 2. 点赞 3 个不同帖子
  for (const id of topicIds.slice(0, 3)) {
    try {
      const r = await callCommunity('GET', `/community/topic/like/${id}`, undefined, `?id=${id}`);
      const j = await parseJson(r);
      log(`点赞帖子 ${id}`, j.Code === 0, `Code=${j.Code}`);
    } catch (e: any) {
      log(`点赞帖子 ${id}`, false, e?.message || String(e));
    }
  }

  // 3. 分享 1 个帖子
  if (topicIds.length > 0) {
    const id = topicIds[0];
    try {
      const r = await callCommunity('GET', `/community/topic/share/${id}`, undefined, `?id=${id}`);
      const j = await parseJson(r);
      log(`分享帖子 ${id}`, j.Code === 0, `Code=${j.Code}`);
    } catch (e: any) {
      log(`分享帖子 ${id}`, false, e?.message || String(e));
    }
  } else {
    log('分享帖子', false, '无可用帖子 id，跳过');
  }

  // 4. 自动兑换（与浏览/点赞/分享相互独立，无论前置任务成败都执行）
  let exchangeResult: any = null;
  try {
    const r = await callCommunity('GET', '/community/item/exchange_list');
    const j = await parseJson(r);
    if (j.Code !== 0) throw new Error('exchange_list Code=' + j.Code);
    const list: any[] = j.data?.list || [];
    const eligible = list.filter((i) => i.exchange_count < i.max_exchange_count);
    let totalTimes = 0;
    let totalCost = 0;
    const details: any[] = [];
    for (const i of eligible) {
      const times = i.max_exchange_count - i.exchange_count;
      totalTimes += times;
      totalCost += (i.use_score || 0) * times;
      for (let k = 0; k < times; k++) {
        const ex = await callCommunity('POST', '/community/item/exchange', { exchange_id: i.exchange_id });
        const ej = await parseJson(ex);
        details.push({
          item: i.item_name,
          exchange_id: i.exchange_id,
          seq: `${k + 1}/${times}`,
          code: ej.Code,
          msg: ej.Message,
        });
        if (ej.Code !== 0) break; // 该物品失败则停止其剩余次数
      }
    }
    exchangeResult = { eligibleCount: eligible.length, totalTimes, totalCost, details };
    log(
      '自动兑换',
      true,
      `可兑换 ${eligible.length} 项，共 ${totalTimes} 次，预计消耗 ${totalCost} 积分`,
    );
  } catch (e: any) {
    log('自动兑换', false, e?.message || String(e));
  }

  const allOk = steps.every((s) => s.ok);
  return c.json({
    ok: allOk,
    message: allOk ? '全部任务完成' : '部分任务失败，详见 steps',
    steps,
    exchange: exchangeResult,
  });
});
