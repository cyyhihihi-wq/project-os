import { reactive } from 'vue'

/**
 * 全局云端同步状态
 * 任何 store 的 Supabase 写入失败时设置 error，App.vue 显示 banner。
 * 与 localStorageAdapter.js 的 storageStatus 模式一致。
 */
export const syncStatus = reactive({ error: '' })
