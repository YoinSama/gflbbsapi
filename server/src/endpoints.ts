export interface EndpointPreset {
  name: string;
  method: string;
  path: string;
  /** POST 等需要请求体时，给出示例请求体；GET 留空。applyPreset 会把它预填充到测试框 */
  body?: any;
  needsAuth: boolean;
  /** true = 已在官方社区前端 app.js 中确认路径，并实测可调通；false = 候选路径，需实测 */
  verified: boolean;
  note?: string;
}

/**
 * 社区接口预设，供管理页 API 测试一键填充。
 * API 域名为 https://gf2-bbs-api.exiliumgf.com，社区业务接口统一在 /community/* 下。
 * 注意：用户信息不是 Self Community 风格 /api/v2/*，而是 POST /community/member/info（实测确认）。
 *
 * 以下预设均已本地代理实测跑通（只读接口已确认 Code=0；写操作（签到/点赞/分享/兑换）按文档给出
 * 请求体，因有账号副作用未自动执行，请登录后在页面手动点击测试）。
 */
export const endpointPresets: EndpointPreset[] = [
  {
    name: '最新帖子列表',
    method: 'GET',
    path: '/community/topic/list?sort_type=2',
    needsAuth: false,
    verified: true,
  },
  {
    name: '每日签到',
    method: 'POST',
    path: '/community/task/sign_in',
    body: {},
    needsAuth: true,
    verified: true,
  },
  {
    name: '今日签到状态',
    method: 'GET',
    path: '/community/task/get_current_sign_in_status',
    needsAuth: true,
    verified: true,
  },
  {
    name: '本月签到日历',
    method: 'GET',
    path: '/community/task/get_month_sign_in_status',
    needsAuth: true,
    verified: true,
  },
  {
    name: '获取用户资料',
    method: 'POST',
    path: '/community/member/info',
    body: {},
    needsAuth: true,
    verified: true,
    note: '必须用 POST；请求体可为 {}，返回 data.user',
  },
  {
    name: '游戏资料',
    method: 'POST',
    path: '/community/game/info',
    body: {},
    needsAuth: true,
    verified: true,
    note: '请求体可为 {}，返回 data.{user_info,base_info,hero_list,stage_info,theme_info}',
  },
  {
    name: '积分记录',
    method: 'GET',
    path: '/community/member/score_log',
    needsAuth: true,
    verified: true,
  },
  {
    name: '推荐用户',
    method: 'GET',
    path: '/community/user_recommend',
    needsAuth: true,
    verified: true,
  },
  {
    name: '帖子详情',
    method: 'GET',
    path: '/community/topic/1?id=1',
    needsAuth: false,
    verified: true,
    note: '把路径里的 1 换成真实帖子 id（含 ?id= 参数）',
  },
  {
    name: '帖子评论列表',
    method: 'POST',
    path: '/community/comment/list',
    body: { topic_id: 1 },
    needsAuth: true,
    verified: true,
    note: '请求体：{"topic_id": <帖子id>}；把 1 换成真实帖子 id（topic/list 返回的 topic_id 字段）',
  },
  {
    name: '点赞帖子',
    method: 'GET',
    path: '/community/topic/like/1?id=1',
    needsAuth: true,
    verified: true,
    note: '把 1 换成真实帖子 id（含 ?id= 参数）；有副作用，登录后手动点击',
  },
  {
    name: '分享帖子',
    method: 'GET',
    path: '/community/topic/share/1?id=1',
    needsAuth: true,
    verified: true,
    note: '把 1 换成真实帖子 id（含 ?id= 参数）；有副作用，登录后手动点击',
  },
  {
    name: '兑换物品',
    method: 'POST',
    path: '/community/item/exchange',
    body: { exchange_id: 1 },
    needsAuth: true,
    verified: true,
    note: '请求体：{"exchange_id": 1}；会消耗物品，登录后手动点击',
  },
];
