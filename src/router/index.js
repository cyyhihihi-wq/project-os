import { createRouter, createWebHashHistory } from 'vue-router'
import TasksView from '../views/TasksView.vue'
import ProjectsView from '../views/ProjectsView.vue'
import AIView from '../views/AIView.vue'
import AuthView from '../views/AuthView.vue'
import { useAuthStore } from '../stores/auth.js'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/tasks' },
    { path: '/tasks', name: 'tasks', component: TasksView },
    { path: '/projects', name: 'projects', component: ProjectsView },
    { path: '/ai', name: 'ai', component: AIView },
    { path: '/auth', name: 'auth', component: AuthView },
  ],
})

router.beforeEach((to) => {
  const authStore = useAuthStore()

  // auth.initialize() 在 main.js 中 await 完成后才 mount，
  // 因此 beforeEach 触发时 appReady 一定为 true
  if (to.name !== 'auth' && !authStore.user) return { name: 'auth' }
  if (to.name === 'auth' && authStore.user) return { name: 'tasks' }
})

export default router
