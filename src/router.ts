import { createRouter, createWebHistory } from 'vue-router'
export default createRouter({ history: createWebHistory(), routes: [
  { path: '/', name: 'home', component: () => import('./views/HomeView.vue'), meta: { title: '今日计划' } },
  { path: '/initial', name: 'initial', component: () => import('./views/InitialView.vue'), meta: { title: '初记' } },
  { path: '/leisure', name: 'leisure', component: () => import('./views/LeisureView.vue'), meta: { title: '休闲记忆' } },
  { path: '/review', name: 'review', component: () => import('./views/ReviewView.vue'), meta: { title: '强化复习' } },
  { path: '/banks', name: 'banks', component: () => import('./views/BanksView.vue'), meta: { title: '句库中心' } },
  { path: '/banks/:bankId/browse', name: 'browse', component: () => import('./views/BrowseView.vue'), meta: { title: '浏览背诵' } },
  { path: '/banks/:bankId/test', name: 'test', component: () => import('./views/TestView.vue'), meta: { title: '测试中心' } },
  { path: '/wrong', name: 'wrong', component: () => import('./views/WrongView.vue'), meta: { title: '错句本' } },
  { path: '/stats', name: 'stats', component: () => import('./views/StatsView.vue'), meta: { title: '学习统计' } },
  { path: '/settings', name: 'settings', component: () => import('./views/SettingsView.vue'), meta: { title: '设置与备份' } },
] })
