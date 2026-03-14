/**
 * LocalStorage adapter
 * Implements sync read/write. Future adapters (e.g. remoteApiAdapter)
 * can implement the same interface with async methods.
 *
 * storageStatus: reactive error object imported by App.vue to show a global banner.
 * save() never throws — errors are captured into storageStatus.error instead.
 */
import { reactive } from 'vue'

/** 全局存储状态：任意 store 写入失败时设置 error，App.vue 显示 banner */
export const storageStatus = reactive({ error: '' })

export function getAll(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function save(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data))
  } catch (err) {
    const isQuota = err.name === 'QuotaExceededError' || err.code === 22
    storageStatus.error = isQuota
      ? '本地存储空间不足，当前操作未保存。请导出数据或删除旧记录后重试。'
      : `保存失败：${err.message || '未知错误'}`
  }
}

export function remove(key) {
  localStorage.removeItem(key)
}
