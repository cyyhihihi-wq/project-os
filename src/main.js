import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { watch } from 'vue'
import App from './App.vue'
import router from './router'
import './style.css'

import { useAuthStore } from './stores/auth.js'
import { useTasksStore } from './stores/tasks.js'
import { useProjectsStore } from './stores/projects.js'
import { useMaterialsStore } from './stores/materials.js'
import { useStylesStore } from './stores/styles.js'
import { useTagsStore } from './stores/tags.js'
import { useAiDocumentsStore } from './stores/aiDocuments.js'
import { useDocsStore } from './stores/docs.js'

;(async () => {
  const app = createApp(App)
  const pinia = createPinia()
  app.use(pinia)
  app.use(router)

  // 先等待 session 检查完成，再 mount，避免闪烁和守卫误判
  const authStore = useAuthStore(pinia)
  await authStore.initialize()

  // 登出后主动跳回登录页（router guard 是被动的，需要此处主动触发）
  // 职责划分：auth store 维护状态，此处唯一负责 logout 导航，App.vue 只管 UI
  watch(
    () => authStore.user,
    (user) => { if (!user) router.push('/auth') }
  )

  // 业务 store 本地初始化（不变）
  const projectsStore = useProjectsStore(pinia)
  const tasksStore = useTasksStore(pinia)
  const materialsStore = useMaterialsStore(pinia)
  const stylesStore = useStylesStore(pinia)
  projectsStore.init()
  tasksStore.init()
  materialsStore.init()
  stylesStore.init()
  useTagsStore(pinia).init()
  useDocsStore(pinia).init()

  // 云端只读初始化：mount 前 await，首屏直接呈现云端数据，不产生闪烁
  // 失败时静默降级到本地数据，不阻断启动
  if (authStore.user) {
    const userId = authStore.user.id
    const aiDocumentsStore = useAiDocumentsStore(pinia)
    const docsStore = useDocsStore(pinia)
    try {
      await Promise.all([
        projectsStore.initFromCloud(userId),
        tasksStore.initFromCloud(userId),
        materialsStore.initFromCloud(userId),
        stylesStore.initFromCloud(userId),
        aiDocumentsStore.loadDocuments(userId),
        docsStore.initFromCloud(userId),
      ])
    } catch (err) {
      console.error('[cloud] init failed, using local data:', err)
    }
  }

  app.mount('#app')
})()
