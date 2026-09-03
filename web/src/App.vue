<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router';
import { onMounted, ref } from 'vue';

const theme = ref(localStorage.getItem('theme') || 'light');

function applyTheme(t: string) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('theme', t);
}

onMounted(() => applyTheme(theme.value));

function toggleTheme() {
  theme.value = theme.value === 'light' ? 'dark' : 'light';
  applyTheme(theme.value);
}
</script>

<template>
  <div class="topnav">
    <span class="links">
      <RouterLink to="/admin">少前2 社区 API</RouterLink>
    </span>
    <button class="btn" @click="toggleTheme">
      {{ theme === 'light' ? '深色模式' : '浅色模式' }}
    </button>
  </div>
  <RouterView />
</template>
