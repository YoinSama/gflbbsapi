export interface EndpointPreset {
  name: string;
  method: string;
  path: string;
  needsAuth: boolean;
  /** true = 已在官方社区前端 app.js 中确认路径，并实测可调通；false = 候选路径，需实测 */
  verified: boolean;
  note?: string;
}

/**
 * 社区接口预设，供管理页 API 测试一键填充。
 * API 域名为 https://gf2-bbs-api.exiliumgf.com，社区业务接口统一在 /community/* 下。
 * 注意：用户信息不是 Self Community 风格 /api/v2/*，而是 POST /community/member/info（实测确认）。
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
    needsAuth: true,
    verified: true,
    note: '必须用 POST；请求体可为 {}，返回 data.user',
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
    note: '把 1 换成真实帖子 id',
  },
  {
    name: '点赞帖子',
    method: 'GET',
    path: '/community/topic/like/1?id=1',
    needsAuth: true,
    verified: true,
    note: '把 1 换成真实帖子 id',
  },
  {
    name: '分享帖子',
    method: 'GET',
    path: '/community/topic/share/1?id=1',
    needsAuth: true,
    verified: true,
    note: '把 1 换成真实帖子 id',
  },
  {
    name: '兑换物品',
    method: 'POST',
    path: '/community/item/exchange',
    needsAuth: true,
    verified: true,
    note: '请求体：{"exchange_id": 1}',
  },
];
