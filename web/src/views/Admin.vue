<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';
import JsonTree from '../components/JsonTree.vue';

const router = useRouter();

// ---------- 管理员登录守卫 ----------
const admin = ref({ loggedIn: false, mustChange: false, username: '' });

async function loadAdminStatus() {
  const r = await api.adminStatus();
  if (r.ok && r.data?.loggedIn) {
    admin.value = { loggedIn: true, mustChange: r.data.mustChange, username: r.data.username || '' };
  } else {
    admin.value = { loggedIn: false, mustChange: false, username: '' };
  }
  // 管理页仅对已完成登录的管理员开放；否则回到登录入口
  if (!admin.value.loggedIn) router.replace('/');
}
async function doAdminLogout() {
  await api.adminLogout();
  router.replace('/');
}

// ---------- 社区 token 登录 + 状态 ----------
const account = ref('');
const password = ref('');
const loginMsg = ref('');
const loginOk = ref(false);
const status = ref<any>(null);

async function doLogin() {
  loginMsg.value = '登录中…';
  loginOk.value = false;
  const r = await api.login(account.value, password.value);
  loginOk.value = r.ok;
  loginMsg.value = r.ok ? '登录成功' : r.data?.message || '登录失败';
  if (r.ok) await loadStatus();
}
async function loadStatus() {
  const r = await api.status();
  status.value = r.data;
}
async function doLogout() {
  await api.logout();
  status.value = { loggedIn: false };
  loginMsg.value = '已退出社区账号';
}

// ---------- API 测试（代理） ----------
const methods = ['GET', 'POST', 'PUT', 'DELETE'];
const mMethod = ref('GET');
const mPath = ref('/community/topic/list?sort_type=2');
const mBody = ref('');
const mResult = ref<any>(null);
const mErr = ref('');
const mLoading = ref(false);
const mStatus = ref<number | null>(null);

async function sendProxy() {
  mLoading.value = true;
  mErr.value = '';
  mResult.value = null;
  let body: any = undefined;
  if (mMethod.value !== 'GET' && mBody.value.trim()) {
    try {
      body = JSON.parse(mBody.value);
    } catch {
      mErr.value = '请求体不是合法 JSON';
      mLoading.value = false;
      return;
    }
  }
  const r = await api.proxy(mMethod.value, mPath.value, body);
  mStatus.value = r.status;
  mLoading.value = false;
  if (r.ok) mResult.value = r.data;
  else mErr.value = r.data;
}

const presets = ref<any[]>([]);
async function loadPresets() {
  try {
    presets.value = await fetch('/api/endpoints').then((r) => r.json());
  } catch {
    presets.value = [];
  }
}
function applyPreset(p: any) {
  mMethod.value = p.method;
  mPath.value = p.path;
}

// ---------- 接口演示（融合原展示页） ----------
const topics = ref<any>(null);
const topicsErr = ref('');
const topicsLoading = ref(false);
async function loadTopics() {
  topicsLoading.value = true;
  topicsErr.value = '';
  topics.value = null;
  const r = await api.proxy('GET', '/community/topic/list?sort_type=2');
  topicsLoading.value = false;
  if (r.ok) topics.value = r.data;
  else topicsErr.value = r.data;
}

const userInfo = ref<any>(null);
const userErr = ref('');
const userLoading = ref(false);
async function loadUser() {
  userLoading.value = true;
  userErr.value = '';
  userInfo.value = null;
  // 真实用户资料接口是 POST /community/member/info（官方前端 app.js 确认，实测可调通）
  const r = await api.proxy('POST', '/community/member/info', {});
  userLoading.value = false;
  if (r.ok) userInfo.value = r.data?.data?.user ?? r.data;
  else userErr.value = r.data;
}

// ---------- 游戏资料（POST /community/game/info，移动端 /m/userData 同源） ----------
const gameInfo = ref<any>(null);
const gameErr = ref('');
const gameLoading = ref(false);
async function loadGame() {
  if (!status.value?.loggedIn) {
    gameErr.value = '请先登录社区账号';
    return;
  }
  gameLoading.value = true;
  gameErr.value = '';
  gameInfo.value = null;
  const r = await api.proxy('POST', '/community/game/info', {});
  gameLoading.value = false;
  if (r.ok) gameInfo.value = r.data?.data ?? r.data;
  else gameErr.value = r.data;
}

/** 展平 stage_info（键值可能为对象或数组），带原键名便于特判 */
function flattenStages(stageInfo: any): { key: string; item: any }[] {
  const out: { key: string; item: any }[] = [];
  for (const [k, v] of Object.entries(stageInfo || {})) {
    if (Array.isArray(v)) for (const it of v) out.push({ key: k, item: it });
    else if (v && typeof v === 'object') out.push({ key: k, item: v });
  }
  return out;
}

/** 单条战绩 → [(指标名, 值)] 行；stage_name 缺失时按字段猜指标名 */
function stageLines(item: any): [string, string][] {
  const has = (x: any) => x !== null && x !== undefined && x !== '';
  const n = (x: any) => String(x);
  if (has(item.stage_name)) {
    let val = '';
    if (has(item.complete_percent)) val = n(item.complete_percent);
    else if (has(item.max_score)) val = n(item.max_score);
    else if (has(item.stay_stage)) val = '停留 ' + n(item.stay_stage);
    return val ? [[item.stage_name, val]] : [];
  }
  const lines: [string, string][] = [];
  if (has(item.max_score)) lines.push(['最高积分', n(item.max_score)]);
  if (has(item.stage_rank)) lines.push(['段位', n(item.stage_rank)]);
  if (has(item.complete_percent)) lines.push(['完成度', n(item.complete_percent) + '%']);
  if (has(item.stay_stage)) lines.push(['停留关卡', n(item.stay_stage)]);
  return lines;
}

const gameHeroes = computed(() => (gameInfo.value?.hero_list || []).slice(0, 8));

/** 战绩分组：week_special（周常歧路，多条）→ 横向滚动；其余玩法 → 网格 */
const gameStageGroups = computed(() => {
  const all = flattenStages(gameInfo.value?.stage_info);
  const week = all.filter((s) => s.key === 'week_special');
  const rest = all.filter((s) => s.key !== 'week_special');
  const groups: { label: string; items: { key: string; item: any }[]; scroll: boolean }[] = [];
  if (week.length) groups.push({ label: `周常歧路 · ${week.length}`, items: week, scroll: true });
  if (rest.length) groups.push({ label: `玩法战绩 · ${rest.length}`, items: rest, scroll: false });
  return groups;
});
const stageTotal = computed(() => gameStageGroups.value.reduce((n, g) => n + g.items.length, 0));

/** 战绩第二行说明文字：把 stageLines 拼成「指标 数值 · …」，无指标时退回关卡代码 */
function stageCaption(s: { key: string; item: any }): string {
  const pairs = stageLines(s.item);
  if (!pairs.length) return s.item.stage_code || '';
  return pairs.map(([k, v]) => (v ? `${k} ${v}` : k)).join(' · ');
}
const gameBase = computed(() => gameInfo.value?.base_info || {});
const gameUser = computed(() => gameInfo.value?.user_info || {});
const gameThemes = computed(() => (gameInfo.value?.theme_info || []).slice(0, 12));

// ---------- 社区每日签到 ----------
const signState = ref<'idle' | 'loading' | 'done'>('idle');
const signMsg = ref('');
const signOk = ref(false);
const signResult = ref<any>(null);
const signDetailOpen = ref(false);
async function doSignIn() {
  if (!status.value?.loggedIn) {
    signMsg.value = '请先登录社区账号';
    return;
  }
  signState.value = 'loading';
  signMsg.value = '';
  signResult.value = null;
  // 先查今日是否已签
  const st = await api.proxy('GET', '/community/task/get_current_sign_in_status');
  if (!st.ok) {
    signState.value = 'done';
    signOk.value = false;
    signMsg.value = '查询签到状态失败';
    signResult.value = st.data ?? { status: st.status };
    return;
  }
  if (st.data?.data?.has_sign_in) {
    signState.value = 'done';
    signOk.value = true;
    signMsg.value = '今日已签到 ✅';
    signResult.value = st.data;
    return;
  }
  // 未签 → 执行签到
  const r = await api.proxy('POST', '/community/task/sign_in', {});
  signState.value = 'done';
  signResult.value = r.data ?? { status: r.status };
  if (r.ok && r.data?.Code === 0) {
    signOk.value = true;
    signMsg.value = '签到成功 🎉';
  } else {
    signOk.value = false;
    signMsg.value = '签到失败：' + (r.data?.Message || 'HTTP ' + r.status);
  }
}

// ---------- 本月签到日历 ----------
const calState = ref<'idle' | 'loading' | 'done'>('idle');
const calErr = ref('');
const calData = ref<any>(null);
const calCells = ref<any[]>([]);
const calMeta = ref<{ signInDays?: number; totalDays?: number; todaySigned?: boolean }>({});

function buildCalendar(month: any, todaySigned: boolean) {
  const start = new Date(month.start_date + 'T00:00:00');
  const year = start.getFullYear();
  const monthIdx = start.getMonth();
  const firstWeekday = start.getDay(); // 0=Sun..6=Sat
  const totalDays = month.list.length;
  const lead = (firstWeekday + 6) % 7; // 周一为第一列
  const now = new Date();
  const isSameMonth = now.getFullYear() === year && now.getMonth() === monthIdx;
  const todayDate = now.getDate();
  const cells: any[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= totalDays; d++) {
    const reward = month.list[d - 1];
    const isToday = isSameMonth && d === todayDate;
    cells.push({ day: d, reward, isToday, signedToday: isToday && todaySigned });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return { cells, signInDays: month.sign_in_days, totalDays };
}

async function loadMonthCalendar() {
  if (!status.value?.loggedIn) {
    calErr.value = '请先登录社区账号';
    return;
  }
  calState.value = 'loading';
  calErr.value = '';
  calData.value = null;
  const [m, c] = await Promise.all([
    api.proxy('GET', '/community/task/get_month_sign_in_status'),
    api.proxy('GET', '/community/task/get_current_sign_in_status'),
  ]);
  if (!m.ok) {
    calState.value = 'done';
    calErr.value = (m.data && m.data.Message) || 'HTTP ' + m.status;
    return;
  }
  const todaySigned = !!(c.data && c.data.data && c.data.data.has_sign_in);
  const built = buildCalendar(m.data.data, todaySigned);
  calMeta.value = { signInDays: built.signInDays, totalDays: built.totalDays, todaySigned };
  calCells.value = built.cells;
  calData.value = m.data.data;
  calState.value = 'done';
}

onMounted(async () => {
  await loadAdminStatus();
  if (!admin.value.loggedIn) return;
  await loadStatus();
  await loadPresets();
});
</script>

<template>
  <div class="container" v-if="admin.loggedIn">
    <div class="card">
      <div class="row" style="justify-content: space-between">
        <h2 style="margin-top: 0">API 管理</h2>
        <button class="btn" @click="doAdminLogout">退出管理员登录</button>
      </div>
      <p class="muted">当前管理员：{{ admin.username }}</p>
    </div>

    <!-- 社区账号：未登录显示登录模块；登录后隐藏并改为已登录状态 + 登出 -->
    <div class="card">
      <template v-if="!status?.loggedIn">
        <h3 style="margin-top: 0">登录社区</h3>
        <p class="muted">登录后 token 由后端持久化，代理调用社区接口时自动附加。</p>
        <div style="display: grid; gap: 10px; max-width: 360px">
          <input class="input" v-model="account" placeholder="散爆账号（手机 / 邮箱）" />
          <input class="input" type="password" v-model="password" placeholder="密码" />
          <div class="row">
            <button class="btn primary" @click="doLogin">登录</button>
            <span :class="loginOk ? 'tag' : 'muted'">{{ loginMsg }}</span>
          </div>
        </div>
      </template>
      <template v-else>
        <h3 style="margin-top: 0">当前登录社区账号</h3>
        <p class="muted">登录时间：{{ status.loggedInAt }}</p>
        <p class="muted">Token（脱敏）：{{ status.tokenMasked }}</p>
        <div class="row">
          <button class="btn danger" @click="doLogout">登出社区账号</button>
        </div>
      </template>
    </div>

    <!-- 社区签到：每日签到 + 本月日历（仅社区已登录时显示） -->
    <div class="card" v-if="status?.loggedIn">
      <h3 style="margin-top: 0">社区签到</h3>
      <div class="sign-grid">
        <!-- 左：每日签到 -->
        <div class="sign-left">
          <h4>每日签到</h4>
          <p class="muted" style="margin-top: 0">
            调用 <code>POST /community/task/sign_in</code>：先查今日是否已签，未签则自动签到。
          </p>
          <div class="row" style="margin-bottom: 8px">
            <button class="btn primary" @click="doSignIn" :disabled="signState === 'loading'">
              {{ signState === 'loading' ? '处理中…' : '一键签到' }}
            </button>
            <span :class="signOk ? 'tag' : 'muted'">{{ signMsg }}</span>
          </div>
          <div v-if="signResult" class="sign-detail">
            <button class="btn link" type="button" @click="signDetailOpen = !signDetailOpen">
              {{ signDetailOpen ? '收起详情 ▲' : '展开详情 ▼' }}
            </button>
            <div v-show="signDetailOpen" class="json-box" :class="{ err: !signOk }">
              <JsonTree :data="signResult" />
            </div>
          </div>
        </div>

        <!-- 右：本月签到日历（小） -->
        <div class="sign-right">
          <div class="row" style="justify-content: space-between; margin-bottom: 6px">
            <h4>本月签到日历</h4>
            <button
              class="btn primary"
              style="font-size: 12px; padding: 4px 10px"
              @click="loadMonthCalendar"
              :disabled="calState === 'loading'"
            >{{ calState === 'loading' ? '加载中…' : (calData ? '刷新' : '加载') }}</button>
          </div>
          <p v-if="calMeta.totalDays !== undefined" class="muted" style="margin: 0 0 6px; font-size: 12px">
            本月已签 {{ calMeta.signInDays }} 天 · 共 {{ calMeta.totalDays }} 天
          </p>
          <div v-if="calErr" class="muted" style="color: var(--danger); font-size: 12px">{{ calErr }}</div>

          <div v-if="calCells.length" class="cal cal-sm">
            <div class="cal-dow" v-for="d in ['一', '二', '三', '四', '五', '六', '日']" :key="d">{{ d }}</div>
            <template v-for="(cell, i) in calCells" :key="i">
              <div v-if="!cell" class="cal-cell empty"></div>
              <div
                v-else
                class="cal-cell"
                :class="{ today: cell.isToday, signed: cell.signedToday }"
                :title="cell.reward.item_name + ' ×' + cell.reward.item_count"
              >
                <span class="cal-day">{{ cell.day }}</span>
                <img v-if="cell.reward.item_pic" :src="cell.reward.item_pic" class="cal-img" alt="" referrerpolicy="no-referrer" />
                <span v-else class="cal-img cal-img-text">{{ cell.reward.item_name }}</span>
                <span class="cal-count">×{{ cell.reward.item_count }}</span>
                <span v-if="cell.signedToday" class="cal-check">✓</span>
                <span v-if="cell.isToday && !cell.signedToday" class="cal-today-tag">今天</span>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- API 测试 + 接口演示（融合原展示页） -->
    <div class="card">
      <h3 style="margin-top: 0">API 测试</h3>
      <p class="muted">
        通过后端代理直接调用社区接口，token 由后端自动附加。<span style="opacity: 0.7">点击预设可快速填充，带 * 为待验证接口。</span>
      </p>
      <div class="row" style="margin-bottom: 10px; gap: 6px; flex-wrap: wrap">
        <button
          v-for="p in presets"
          :key="p.method + p.path"
          class="btn"
          style="font-size: 12px; padding: 4px 10px"
          :title="p.note || p.path"
          @click="applyPreset(p)"
        >{{ p.name }}<span v-if="!p.verified" style="opacity: 0.6"> *</span></button>
      </div>
      <div class="row" style="margin-bottom: 10px">
        <select class="input" style="width: 120px" v-model="mMethod">
          <option v-for="m in methods" :key="m" :value="m">{{ m }}</option>
        </select>
        <input class="input" style="flex: 1" v-model="mPath" placeholder="/community/..." />
        <button class="btn primary" @click="sendProxy" :disabled="mLoading">
          {{ mLoading ? '发送中…' : '发送' }}
        </button>
      </div>
      <textarea
        class="input"
        rows="4"
        v-model="mBody"
        placeholder='POST 请求体 JSON，例如 {"exchange_id": 1}'
        v-if="mMethod !== 'GET'"
      ></textarea>
      <div v-if="mResult || mErr" class="json-box" :class="{ err: mErr }">
        <div class="row" style="margin-bottom: 8px">
          <span class="tag" :style="mErr ? 'background:var(--danger);color:#fff' : ''">
            {{ mErr ? '失败' : '成功' }} · HTTP {{ mStatus }}
          </span>
          <span class="muted">{{ mErr ? '返回内容如下' : '返回内容（点击 ▸ 可展开/收起）' }}</span>
        </div>
        <JsonTree v-if="mResult" :data="mResult" />
        <JsonTree v-else :data="mErr" />
      </div>

      <h3 style="margin-top: 22px">接口演示</h3>
      <p class="muted">下面是从社区 API 拉取的真实数据演示（需先登录社区账号）。</p>
      <div class="row" style="margin-bottom: 10px">
        <button class="btn primary" @click="loadTopics" :disabled="topicsLoading">
          {{ topicsLoading ? '请求中…' : (topics ? '刷新最新帖子列表' : '获取最新帖子列表') }}
        </button>
        <button class="btn primary" v-if="status?.loggedIn" @click="loadUser" :disabled="userLoading">
          {{ userLoading ? '请求中…' : (userInfo ? '刷新用户资料' : '获取用户资料') }}
        </button>
        <button class="btn primary" v-if="status?.loggedIn" @click="loadGame" :disabled="gameLoading">
          {{ gameLoading ? '请求中…' : (gameInfo ? '刷新游戏资料' : '获取游戏资料') }}
        </button>
      </div>

      <div v-if="topics" class="json-box">
        <div class="row" style="margin-bottom: 8px">
          <span class="tag">最新帖子列表</span>
        </div>
        <JsonTree :data="topics" />
      </div>
      <div v-if="topicsErr" class="json-box err">
        <div class="row" style="margin-bottom: 8px">
          <span class="tag" style="background:var(--danger);color:#fff">失败</span>
        </div>
        <JsonTree :data="topicsErr" />
      </div>

      <div v-if="!status?.loggedIn" class="muted" style="margin-top: 10px">
        尚未登录社区账号，登录后可查看「用户资料」「游戏资料」演示。
      </div>

      <div v-if="userInfo" class="profile">
        <h4 style="margin-top: 18px">当前用户资料</h4>
        <div class="profile-head">
          <img v-if="userInfo.avatar" :src="userInfo.avatar" class="avatar" alt="头像" referrerpolicy="no-referrer" />
          <div>
            <div class="name">{{ userInfo.nick_name || '未知用户' }} <span class="muted">#{{ userInfo.uid }}</span></div>
            <div class="muted" v-if="userInfo.signature">{{ userInfo.signature }}</div>
            <div class="muted" v-if="userInfo.ip_location">地区：{{ userInfo.ip_location }}</div>
            <div class="muted" v-if="userInfo.vip">VIP：{{ userInfo.vip }}</div>
          </div>
        </div>

        <div class="stats">
          <div class="stat"><span class="stat-val">{{ userInfo.level }}</span><span class="stat-label">等级</span></div>
          <div class="stat"><span class="stat-val">{{ userInfo.exp }} / {{ userInfo.next_lv_exp }}</span><span class="stat-label">经验</span></div>
          <div class="stat"><span class="stat-val">{{ userInfo.score }}</span><span class="stat-label">积分</span></div>
          <div class="stat"><span class="stat-val">{{ userInfo.fans }}</span><span class="stat-label">粉丝</span></div>
          <div class="stat"><span class="stat-val">{{ userInfo.follows }}</span><span class="stat-label">关注</span></div>
          <div class="stat"><span class="stat-val">{{ userInfo.favors }}</span><span class="stat-label">收藏</span></div>
          <div class="stat"><span class="stat-val">{{ userInfo.likes }}</span><span class="stat-label">获赞</span></div>
        </div>

        <div class="game" v-if="userInfo.game_uid || userInfo.game_nick_name || userInfo.game_commander_level">
          <h4>游戏信息</h4>
          <div class="stats">
            <div class="stat"><span class="stat-val">{{ userInfo.game_nick_name || '—' }}</span><span class="stat-label">游戏昵称</span></div>
            <div class="stat"><span class="stat-val">{{ userInfo.game_uid || '—' }}</span><span class="stat-label">游戏 UID</span></div>
            <div class="stat"><span class="stat-val">{{ userInfo.game_commander_level }}</span><span class="stat-label">指挥等级</span></div>
            <div class="stat"><span class="stat-val">{{ userInfo.endless_floor }}</span><span class="stat-label">无尽层数</span></div>
            <div class="stat"><span class="stat-val">{{ userInfo.endless_rank }}</span><span class="stat-label">无尽排名</span></div>
          </div>
        </div>

        <details style="margin-top: 10px">
          <summary class="muted" style="cursor: pointer">查看原始 JSON</summary>
          <pre>{{ JSON.stringify(userInfo, null, 2) }}</pre>
        </details>
      </div>

      <!-- 游戏资料（基础资料 + 人形前8 + 战绩） -->
      <div v-if="gameInfo" class="profile">
        <h4 style="margin-top: 18px">
          游戏资料
          <span class="muted" style="font-weight: 400; font-size: 12px">POST /community/game/info</span>
        </h4>

        <!-- 基础资料 -->
        <div class="profile-head">
          <img v-if="gameUser.avatar" :src="gameUser.avatar" class="avatar" alt="头像" referrerpolicy="no-referrer" />
          <div>
            <div class="name">{{ gameUser.nick_name || '未知用户' }} <span class="muted">#{{ gameUser.game_uid }}</span></div>
            <div class="muted" v-if="gameUser.guild_name">公会：{{ gameUser.guild_name }}</div>
            <div class="muted" v-if="gameUser.level">指挥等级：{{ gameUser.level }}</div>
          </div>
        </div>
        <div class="stats" v-if="Object.keys(gameBase).length">
          <div class="stat" v-if="gameBase.main_stage">
            <span class="stat-val">{{ gameBase.main_stage }}</span><span class="stat-label">主线进度</span>
          </div>
          <div class="stat" v-if="gameBase.hero_count != null">
            <span class="stat-val">{{ gameBase.hero_count }}</span><span class="stat-label">人形</span>
          </div>
          <div class="stat" v-if="gameBase.active_days != null">
            <span class="stat-val">{{ gameBase.active_days }}</span><span class="stat-label">活跃天数</span>
          </div>
          <div class="stat" v-if="gameBase.skin_count != null">
            <span class="stat-val">{{ gameBase.skin_count }}</span><span class="stat-label">皮肤</span>
          </div>
          <div class="stat" v-if="gameBase.weapon_count != null">
            <span class="stat-val">{{ gameBase.weapon_count }}</span><span class="stat-label">武器</span>
          </div>
          <div class="stat" v-if="gameBase.achievement_count != null">
            <span class="stat-val">{{ gameBase.achievement_count }}</span><span class="stat-label">成就</span>
          </div>
        </div>

        <!-- 人形展示（前 8，官方社区样式：立绘 + 叠加文字/椎体徽章） -->
        <h4 style="margin-top: 18px">
          人形展示
          <span class="muted" style="font-weight: 400; font-size: 12px">公开的前 {{ gameHeroes.length }} 名</span>
        </h4>
        <div class="dolls" v-if="gameHeroes.length">
          <div
            class="doll"
            v-for="h in gameHeroes"
            :key="h.id"
            :title="`${h.name} · lv.${h.lv}` + (h.grade !== null && h.grade !== undefined && h.grade !== '' ? ' · 椎体 ' + h.grade : '')"
          >
            <img :src="h.skin || h.show_pic" :alt="h.name" loading="lazy" referrerpolicy="no-referrer" />
            <!-- 椎体徽章：装饰底 + svg 数字叠加（同官方 grade_text_svg 手法） -->
            <span
              class="grade"
              v-if="h.grade !== null && h.grade !== undefined && h.grade !== ''"
            >
              <svg class="grade_text_svg" viewBox="0 0 34 34" aria-hidden="true">
                <text x="17" y="17" text-anchor="middle" dominant-baseline="central">{{ h.grade }}</text>
              </svg>
            </span>
            <p class="doll-lv">lv.{{ h.lv }}</p>
          </div>
        </div>
        <p v-else class="muted">未公开人形或暂无数据。</p>

        <!-- 游戏战绩（官方社区样式：整幅横条图 + 右侧叠加文字；周常歧路横向滚动） -->
        <h4 style="margin-top: 18px">
          游戏战绩
          <span class="muted" style="font-weight: 400; font-size: 12px">共 {{ stageTotal }} 项</span>
        </h4>
        <template v-if="gameStageGroups.length">
          <div v-for="(g, gi) in gameStageGroups" :key="gi" class="stage-block">
            <div class="stage-group-label">{{ g.label }}</div>
            <div :class="g.scroll ? 'stage-scroll' : 'stage-list'">
              <div
                class="stage-card"
                v-for="(s, i) in g.items"
                :key="gi + '-' + i"
                :title="`${s.item.name || s.key}` + (stageCaption(s) ? ' · ' + stageCaption(s) : '')"
              >
                <img :src="s.item.show_pic" alt="" loading="lazy" referrerpolicy="no-referrer" />
                <div class="stage-cap">
                  <p class="stage-name">{{ s.item.name || s.key }}</p>
                  <div class="stage-metric">
                    <span v-if="s.item.stage_code" class="stage-chip">{{ s.item.stage_code }}</span>
                    <span v-if="stageCaption(s)" class="stage-caption">{{ stageCaption(s) }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>
        <p v-else class="muted">未公开战绩或暂无数据。</p>

        <!-- 主题档案 -->
        <details v-if="gameThemes.length" style="margin-top: 14px">
          <summary class="muted" style="cursor: pointer">主题档案 · {{ gameThemes.length }} 项（点击展开）</summary>
          <div class="theme-grid">
            <div class="theme-item" v-for="(t, i) in gameThemes" :key="i">
              <img :src="t.show_pic" alt="" loading="lazy" referrerpolicy="no-referrer" />
              <span class="theme-pct">{{ t.complete_percent }}%</span>
            </div>
          </div>
        </details>

        <details style="margin-top: 10px">
          <summary class="muted" style="cursor: pointer">查看原始 JSON</summary>
          <pre>{{ JSON.stringify(gameInfo, null, 2) }}</pre>
        </details>
      </div>

      <pre v-if="gameErr" style="color: var(--danger)">{{ JSON.stringify(gameErr, null, 2) }}</pre>

      <pre v-if="userErr" style="color: var(--danger)">{{ JSON.stringify(userErr, null, 2) }}</pre>
    </div>
  </div>
</template>

<style scoped>
.json-box {
  margin-top: 10px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px;
  max-height: 440px;
  overflow: auto;
  font-size: 13px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.json-box.err {
  border-color: var(--danger);
}
.profile-head {
  display: flex;
  gap: 14px;
  align-items: center;
  margin: 8px 0 14px;
}
.avatar {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  object-fit: cover;
  background: var(--surface-2);
  border: 1px solid var(--border);
  flex-shrink: 0;
}
.name {
  font-size: 17px;
  font-weight: 600;
  color: var(--text);
}
.stats {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
  gap: 8px;
  margin-top: 6px;
}
.stat {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px 8px;
  text-align: center;
}
.stat-val {
  display: block;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  word-break: break-all;
}
.stat-label {
  display: block;
  font-size: 12px;
  color: var(--text-2);
  margin-top: 3px;
}
.game {
  margin-top: 14px;
  padding: 14px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  border-radius: var(--radius);
}
.game h4 {
  margin: 0 0 6px;
  color: var(--primary);
}
.cal {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 8px;
  margin-top: 6px;
}
.cal-dow {
  text-align: center;
  font-size: 12px;
  color: var(--text-2);
  padding-bottom: 2px;
}
.cal-cell {
  position: relative;
  aspect-ratio: 1 / 1;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 4px;
  overflow: hidden;
}
.cal-cell.empty {
  background: transparent;
  border: none;
}
.cal-cell.today {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px var(--primary) inset;
}
.cal-cell.signed {
  background: color-mix(in srgb, var(--primary) 14%, var(--surface-2));
}
.cal-day {
  position: absolute;
  top: 3px;
  left: 5px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
}
.cal-img {
  width: 34px;
  height: 34px;
  object-fit: contain;
}
.cal-img-text {
  font-size: 11px;
  color: var(--text);
  text-align: center;
  line-height: 1.2;
}
.cal-count {
  font-size: 11px;
  color: var(--text);
}
.cal-check {
  position: absolute;
  top: 2px;
  right: 5px;
  color: var(--primary);
  font-weight: 700;
  font-size: 13px;
}
.cal-today-tag {
  position: absolute;
  bottom: 3px;
  right: 4px;
  font-size: 10px;
  color: var(--primary);
}
.sign-grid {
  display: flex;
  gap: 18px;
  flex-wrap: wrap;
  align-items: flex-start;
}
.sign-left {
  flex: 1 1 280px;
  min-width: 0;
}
.sign-right {
  flex: 1 1 280px;
  min-width: 0;
}
.sign-left h4,
.sign-right h4 {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  margin: 0 0 6px;
}
.sign-detail {
  margin-top: 4px;
}
.btn.link {
  background: transparent;
  border: none;
  color: var(--primary);
  padding: 4px 0;
  font-size: 13px;
  box-shadow: none;
}
.btn.link:hover {
  text-decoration: underline;
  background: transparent;
}
.btn.link:disabled {
  color: var(--text-2);
  opacity: 1;
}
.cal-sm {
  gap: 5px;
  margin-top: 4px;
}
.cal-sm .cal-cell {
  padding: 2px;
  border-radius: 8px;
}
.cal-sm .cal-img {
  width: 24px;
  height: 24px;
}
.cal-sm .cal-day {
  font-size: 10px;
  top: 2px;
  left: 3px;
}
.cal-sm .cal-count {
  font-size: 9px;
}
.cal-sm .cal-check {
  font-size: 11px;
  top: 1px;
  right: 3px;
}
.cal-sm .cal-today-tag {
  font-size: 8px;
  bottom: 1px;
  right: 2px;
}
/* ---------- 游戏资料（官方社区样式：文字/徽章叠在图上） ---------- */
/* 人形展示：横向滚动立绘条 */
.dolls {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 4px 2px 10px;
  scroll-snap-type: x proximity;
}
.dolls::-webkit-scrollbar {
  height: 6px;
}
.doll {
  position: relative;
  flex: 0 0 auto;
  width: 92px;
  height: 138px;
  border-radius: 10px;
  overflow: hidden;
  background: var(--surface-2);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18);
  scroll-snap-align: start;
}
.doll img {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: top center;
  display: block;
}
.doll::after {
  /* 底部渐变，让叠加文字可读 */
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 36%;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.72));
  pointer-events: none;
}
.doll-lv {
  position: absolute;
  left: 0;
  bottom: 4px;
  text-align: center;
  font-size: 12px;
  width: 100%;
  color: #f26c1c;
}
/* 椎体徽章：装饰圆底 + svg 叠数字（svg 铺满徽章，text 居中） */
.doll .grade {
  position: absolute;
  top: 5px;
  right: 6px;
  z-index: 2;
  width: 22px;
  height: 22px;
  box-sizing: border-box;
  border-radius: 50%;
  background: url(data:image/png;base64,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) no-repeat;
  background-size: 100% 100%
}
.doll .grade .grade_text_svg {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
}
.doll .grade .grade_text_svg text {
  fill: #fff;
  font-family: Arial, Helvetica, sans-serif;
  font-size: 20px;
  font-weight: 700;
}
/* 游戏战绩：整幅横条图 + 右侧叠加文字 */
.stage-block + .stage-block {
  margin-top: 6px;
}
.stage-group-label {
  font-size: 12px;
  color: var(--text-2);
  margin: 2px 0 8px;
}
.stage-list {
  margin-top: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 10px;
}
.stage-scroll {
  display: flex;
  overflow-x: auto;
  overflow-y: hidden;
  gap: 10px;
  padding: 2px 2px 8px;
  scroll-snap-type: x proximity;
}
.stage-scroll::-webkit-scrollbar {
  height: 6px;
}
.stage-scroll .stage-card {
  flex: 0 0 auto;
  width: min(420px, 84%);
  margin-bottom: 0;
  scroll-snap-align: start;
}
.stage-list .stage-card {
  margin-bottom: 0;
}
.stage-card {
  position: relative;
  width: 100%;
  aspect-ratio: 3.64 / 1;
  border-radius: 10px;
  overflow: hidden;
  background: var(--surface-2);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
}
.stage-card img {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.stage-card::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, rgba(8, 8, 10, 0.3), rgba(8, 8, 10, 0.18) 60%, rgba(8, 8, 10, 0.32));
  pointer-events: none;
}
.stage-cap {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 1;
  max-width: 72%;
  text-align: right;
}
.stage-name {
  margin: 0 0 3px;
  font-size: 17px;
  font-weight: 700;
  color: #fff;
  line-height: 1.25;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.7);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.stage-metric {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 5px;
  flex-wrap: wrap;
  font-size: 12px;
  color: #ffe3a8;
  line-height: 1.5;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.75);
}
.stage-chip {
  background: rgba(235, 235, 238, 0.92);
  color: #1a1a1a;
  border-radius: 4px;
  padding: 0 5px;
  line-height: 15px;
  font-weight: 600;
  text-shadow: none;
}
.stage-caption {
  text-align: right;
}
.theme-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
  gap: 8px;
  margin-top: 8px;
}
.theme-item {
  position: relative;
  border-radius: 8px;
  overflow: hidden;
  background: var(--surface-2);
  border: 1px solid var(--border);
}
.theme-item img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  display: block;
}
.theme-pct {
  position: absolute;
  right: 3px;
  bottom: 3px;
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  background: rgba(0, 0, 0, 0.6);
  border-radius: 6px;
  padding: 0 5px;
  line-height: 1.5;
}
</style>
