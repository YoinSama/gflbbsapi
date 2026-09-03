<script setup lang="ts">
import { ref, onMounted } from 'vue';
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
        尚未登录社区账号，登录后可查看「用户资料」演示。
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
</style>
