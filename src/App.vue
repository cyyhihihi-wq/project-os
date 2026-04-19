<script setup>
import { ref } from 'vue'
import { RouterLink, RouterView } from 'vue-router'
import ExportModal from './components/shared/ExportModal.vue'
import { storageStatus } from './data/adapters/localStorageAdapter.js'
import { syncStatus } from './lib/syncStatus.js'
import { useAuthStore } from './stores/auth.js'

const authStore = useAuthStore()

function clearLocalData() {
  if (!window.confirm('确定清空本地测试数据？此操作不影响云端数据，页面将自动刷新。')) return
  const keys = [
    'work_projects',
    'work_tasks',
    'work_week_reviews',
    'work_materials',
    'work_styles',
    'work_tags',
    'work_docs',
  ]
  keys.forEach(k => localStorage.removeItem(k))
  window.location.reload()
}

const showExport = ref(false)
const showMobileMenu = ref(false)
</script>

<template>
  <nav v-if="authStore.user" class="nav" @click="showMobileMenu = false">
    <span class="nav-brand">WorkOS</span>
    <RouterLink to="/tasks">任务</RouterLink>
    <RouterLink to="/projects">专项</RouterLink>
    <RouterLink to="/docs">文档</RouterLink>
    <RouterLink to="/ai">AI</RouterLink>
    <span class="nav-spacer"></span>
    <!-- 桌面端按钮 -->
    <button class="nav-desktop-only" style="font-size:13px;padding:4px 10px" @click="clearLocalData">清空本地测试数据</button>
    <button class="nav-desktop-only" style="font-size:13px;padding:4px 10px" @click="authStore.signOut()">退出</button>
    <!-- 手机端折叠菜单 -->
    <div class="nav-mobile-only" style="position:relative" @click.stop>
      <button
        style="font-size:18px;padding:2px 8px;line-height:1.4;border-color:transparent;background:transparent"
        @click="showMobileMenu = !showMobileMenu"
      >⋮</button>
      <div
        v-if="showMobileMenu"
        style="position:absolute;right:0;top:calc(100% + 4px);background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius);z-index:200;min-width:130px;padding:4px 0;box-shadow:0 4px 16px rgba(0,0,0,.12)"
      >
        <button
          style="display:block;width:100%;text-align:left;padding:9px 16px;border:none;border-radius:0;background:transparent;font-size:13px;color:var(--color-text)"
          @click="clearLocalData; showMobileMenu = false"
        >清空本地数据</button>
        <button
          style="display:block;width:100%;text-align:left;padding:9px 16px;border:none;border-radius:0;background:transparent;font-size:13px;color:var(--color-danger)"
          @click="authStore.signOut()"
        >退出登录</button>
      </div>
    </div>
  </nav>

  <!-- 云端同步失败 banner -->
  <div
    v-if="syncStatus.error"
    style="background:#fff3e0;border-bottom:1px solid #f97316;padding:8px 16px;display:flex;align-items:center;justify-content:space-between;font-size:13px;color:#9a3412"
  >
    <span>{{ syncStatus.error }}</span>
    <button style="border:none;background:none;cursor:pointer;font-size:16px;color:#9a3412;line-height:1" @click="syncStatus.error = ''">×</button>
  </div>

  <!-- 全局存储错误 banner -->
  <div
    v-if="storageStatus.error"
    style="background:#fff0f0;border-bottom:1px solid var(--color-danger);padding:8px 16px;display:flex;align-items:center;justify-content:space-between;font-size:13px;color:var(--color-danger)"
  >
    <span>⚠ {{ storageStatus.error }}</span>
    <button style="border:none;background:none;cursor:pointer;font-size:16px;color:var(--color-danger);line-height:1" @click="storageStatus.error = ''">×</button>
  </div>

  <RouterView />

  <!-- 导出浮动按钮 -->
  <button
    v-if="authStore.user"
    class="quick-capture-btn"
    title="导出工作内容"
    style="font-size:13px;font-weight:600;letter-spacing:0.02em"
    @click="showExport = true"
  >导出</button>

  <!-- 导出弹窗 -->
  <ExportModal v-if="showExport" @close="showExport = false" />
</template>
