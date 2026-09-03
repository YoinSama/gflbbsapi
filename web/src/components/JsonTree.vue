<script setup lang="ts">
import { ref, computed } from 'vue';

const props = defineProps<{
  data: any;
  name?: string | number;
  depth?: number;
}>();

// 顶层默认展开，深层默认收起，避免大体积响应刷屏
const expanded = ref((props.depth ?? 0) < 1);

const isObject = computed(() => props.data !== null && typeof props.data === 'object');
const isArray = computed(() => Array.isArray(props.data));

const entries = computed<[string | number, any][]>(() => {
  if (isArray.value) return (props.data as any[]).map((v, i) => [i, v]);
  return Object.entries(props.data as Record<string, any>);
});

const countLabel = computed(() =>
  isArray.value ? `${(props.data as any[]).length} 项` : `${entries.value.length} 字段`,
);

const display = computed(() => {
  const d = props.data;
  if (d === null) return 'null';
  if (d === undefined) return 'undefined';
  if (typeof d === 'string') return `"${d}"`;
  return String(d);
});

const valueClass = computed(() => {
  const d = props.data;
  if (d === null || d === undefined) return 'jt-null';
  return 'jt-' + typeof d;
});
</script>

<template>
  <div class="jt">
    <div v-if="isObject" class="jt-row">
      <span class="jt-toggle" @click="expanded = !expanded">{{ expanded ? '▾' : '▸' }}</span>
      <span v-if="name !== undefined" class="jt-key">{{ name }}:</span>
      <span class="jt-bracket">{{ isArray ? '[' : '{' }}</span>
      <span v-if="!expanded" class="jt-count">{{ countLabel }}</span>
      <span v-if="!expanded" class="jt-bracket">{{ isArray ? ']' : '}' }}</span>
    </div>
    <div v-else class="jt-row">
      <span v-if="name !== undefined" class="jt-key">{{ name }}:</span>
      <span :class="['jt-val', valueClass]">{{ display }}</span>
    </div>

    <div v-if="isObject && expanded" class="jt-children">
      <JsonTree
        v-for="([k, v], i) in entries"
        :key="i"
        :data="v"
        :name="isArray ? i : k"
        :depth="(depth ?? 0) + 1"
      />
      <div class="jt-row jt-close">
        <span v-if="name !== undefined" class="jt-key-spacer"></span>
        <span class="jt-bracket">{{ isArray ? ']' : '}' }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.jt-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  line-height: 1.65;
}
.jt-children {
  padding-left: 16px;
  border-left: 1px solid var(--border);
  margin-left: 5px;
}
.jt-toggle {
  cursor: pointer;
  color: var(--text-2);
  width: 12px;
  display: inline-block;
  user-select: none;
  flex-shrink: 0;
}
.jt-key {
  color: var(--text-2);
}
.jt-key-spacer {
  display: inline-block;
  width: 0;
}
.jt-bracket {
  color: var(--text-2);
}
.jt-count {
  color: var(--text-2);
  font-style: italic;
}
.jt-val {
  color: var(--text);
  word-break: break-all;
}
.jt-string {
  color: #2f9e6b;
}
.jt-number {
  color: #c2772e;
}
.jt-boolean {
  color: #7b5cd6;
}
.jt-null {
  color: var(--text-2);
}
</style>
