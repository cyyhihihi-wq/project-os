import { defineStore } from 'pinia'
import { reactive } from 'vue'

export const useMigrationStore = defineStore('migration', () => {
  const status = reactive({
    hasPending: false,
    pendingModules: [], // 记录哪些模块有待迁移数据，Step 7 可用
  })

  function markPending(moduleName) {
    status.hasPending = true
    if (!status.pendingModules.includes(moduleName)) {
      status.pendingModules.push(moduleName)
    }
  }

  // Step 7 占位入口，不执行实际迁移逻辑
  function startMigration() {
    console.log('[Migration] startMigration() called — pending Step 7 implementation')
    console.log('[Migration] pendingModules:', status.pendingModules)
  }

  return { status, markPending, startMigration }
})
