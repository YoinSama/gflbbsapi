import { createRouter, createWebHistory } from 'vue-router';
import Login from './views/Login.vue';
import Admin from './views/Admin.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'login', component: Login },
    { path: '/admin', name: 'admin', component: Admin },
  ],
});

export default router;
