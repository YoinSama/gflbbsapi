<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';

const router = useRouter();

// ---------- 管理员网关（项目入口） ----------
const admin = ref({ loggedIn: false, mustChange: false, username: '', initialized: false });
const adminUser = ref('');
const adminPass = ref('');
const adminMsg = ref('');
const adminOk = ref(false);
const adminLoading = ref(false);

const chg = ref({ oldPassword: '', newUsername: '', newPassword: '', confirm: '' });
const chgMsg = ref('');
const chgOk = ref(false);
const chgLoading = ref(false);

function maybeRedirect() {
  if (admin.value.loggedIn && !admin.value.mustChange) {
    router.replace('/admin');
  }
}

async function loadAdminStatus() {
  const r = await api.adminStatus();
  // initialized=true 表示已创建过管理员账户 → 不展示默认凭据提示（默认凭据也已失效）
  const initialized = !!r.data?.initialized;
  if (r.ok && r.data?.loggedIn) {
    admin.value = {
      loggedIn: true,
      mustChange: r.data.mustChange,
      username: r.data.username || '',
      initialized,
    };
  } else {
    admin.value = { loggedIn: false, mustChange: false, username: '', initialized };
  }
  maybeRedirect();
}

async function doAdminLogin() {
  adminLoading.value = true;
  adminMsg.value = '';
  adminOk.value = false;
  const r = await api.adminLogin(adminUser.value.trim(), adminPass.value);
  adminLoading.value = false;
  if (r.ok) {
    adminOk.value = true;
    adminMsg.value = '登录成功';
    await loadAdminStatus();
  } else {
    adminMsg.value = r.data?.message || '登录失败';
  }
}

async function doAdminChange() {
  chgLoading.value = true;
  chgMsg.value = '';
  chgOk.value = false;
  if (chg.value.newPassword !== chg.value.confirm) {
    chgLoading.value = false;
    chgMsg.value = '两次输入的新密码不一致';
    return;
  }
  const r = await api.adminChange(
    chg.value.oldPassword,
    chg.value.newUsername.trim(),
    chg.value.newPassword,
  );
  chgLoading.value = false;
  if (r.ok) {
    chgOk.value = true;
    chgMsg.value = '修改成功，正在进入…';
    await loadAdminStatus();
  } else {
    chgMsg.value = r.data?.message || '修改失败';
  }
}

onMounted(loadAdminStatus);
</script>

<template>
  <div class="container">
    <!-- 已登录且已改密：直接进入（避免闪烁，立即跳转） -->
    <div class="card" v-if="admin.loggedIn && !admin.mustChange">
      <p class="muted">已登录，正在进入管理页…</p>
    </div>

    <!-- 未登录：管理员登录 -->
    <div class="card" v-else-if="!admin.loggedIn">
      <h2 style="margin-top: 0">管理员登录</h2>
      <p class="muted">少前2 社区 API 管理后台需要管理员登录后才能进入。</p>
      <!-- 仅在「尚未创建管理员账户」时提示默认凭据；已初始化后默认凭据已失效，不再展示 -->
      <p class="muted" v-if="!admin.initialized">
        默认管理员账号 <code>admin</code>，密码 <code>123456</code>（首次登录后请立即修改）。
      </p>
      <div style="display: grid; gap: 10px; max-width: 320px">
        <input class="input" v-model="adminUser" placeholder="管理员账号" />
        <input class="input" type="password" v-model="adminPass" placeholder="密码" />
        <div class="row">
          <button class="btn primary" @click="doAdminLogin" :disabled="adminLoading">
            {{ adminLoading ? '登录中…' : '登录' }}
          </button>
          <span :class="adminOk ? 'tag' : 'muted'">{{ adminMsg }}</span>
        </div>
      </div>
    </div>

    <!-- 已登录但需改密：强制修改 -->
    <div class="card" v-else>
      <h2 style="margin-top: 0">请修改管理员账号和密码</h2>
      <p class="muted">检测到使用默认凭据，出于安全请先修改管理员账号与密码。</p>
      <div style="display: grid; gap: 10px; max-width: 360px">
        <input class="input" type="password" v-model="chg.oldPassword" placeholder="当前密码" />
        <input class="input" v-model="chg.newUsername" placeholder="新管理员账号" />
        <input class="input" type="password" v-model="chg.newPassword" placeholder="新密码（≥6 位）" />
        <input class="input" type="password" v-model="chg.confirm" placeholder="确认新密码" />
        <div class="row">
          <button class="btn primary" @click="doAdminChange" :disabled="chgLoading">
            {{ chgLoading ? '提交中…' : '确认修改' }}
          </button>
          <span :class="chgOk ? 'tag' : 'muted'">{{ chgMsg }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
