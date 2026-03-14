<script setup>
import { ref } from 'vue'
import { RouterLink, RouterView } from 'vue-router'
import { useTasksStore } from './stores/tasks.js'
import { useProjectsStore } from './stores/projects.js'
import { useMaterialsStore } from './stores/materials.js'
import FileUploader from './components/shared/FileUploader.vue'
import { organizeCapture } from './ai/organizeService.js'
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
  ]
  keys.forEach(k => localStorage.removeItem(k))
  window.location.reload()
}
const tasksStore = useTasksStore()
const projectsStore = useProjectsStore()
const materialsStore = useMaterialsStore()

const showQuickCapture = ref(false)
const captureText = ref('')
const captureType = ref('material')
const captureProject = ref('')
const captureLoading = ref(false)
const captureError = ref('')

function resetCapture() {
  captureText.value = ''
  captureType.value = 'material'
  captureProject.value = ''
  captureLoading.value = false
  captureError.value = ''
  showQuickCapture.value = false
}

function saveDirect() {
  if (!captureText.value.trim()) return
  const text = captureText.value.trim()

  if (captureType.value === 'progress') {
    const projectId = captureProject.value
      ? projectsStore.items.find(p => p.name === captureProject.value)?.id
      : projectsStore.items[0]?.id
    if (projectId) {
      projectsStore.addProjectUpdate(projectId, {
        title: text.slice(0, 30),
        content: text,
        tags: ['快速记录'],
      })
    }
  } else {
    materialsStore.add({
      title: text.slice(0, 30),
      type: captureType.value === 'idea' ? '想法记录' : '快速记录',
      raw_content: text,
      ai_summary: '',
      tags: captureType.value === 'idea' ? ['想法'] : ['快速记录'],
    })
  }
  resetCapture()
}

async function saveWithAI() {
  if (!captureText.value.trim()) return
  captureLoading.value = true
  captureError.value = ''

  const text = captureText.value.trim()
  const projectName = captureProject.value || projectsStore.items[0]?.name || ''

  try {
    const result = await organizeCapture(text, captureType.value, projectName)

    if (captureType.value === 'progress') {
      const projectId = captureProject.value
        ? projectsStore.items.find(p => p.name === captureProject.value)?.id
        : projectsStore.items[0]?.id
      if (projectId) {
        projectsStore.addProjectUpdate(projectId, {
          title: result.title,
          content: result.content || text,
          tags: result.suggestedTags || [],
        })
      }
    } else {
      materialsStore.add({
        title: result.title,
        type: captureType.value === 'idea' ? '想法记录' : '快速记录',
        raw_content: text,
        ai_summary: result.content || '',
        tags: result.suggestedTags || [],
      })
    }
    resetCapture()
  } catch (err) {
    captureError.value = err.message || 'AI 整理失败，请重试或使用普通保存'
    captureLoading.value = false
  }
}
</script>

<template>
  <nav v-if="authStore.user" class="nav">
    <span class="nav-brand">WorkOS</span>
    <RouterLink to="/tasks">任务</RouterLink>
    <RouterLink to="/projects">专项</RouterLink>
    <RouterLink to="/ai">AI</RouterLink>
    <span class="nav-spacer"></span>
    <button style="font-size:13px;padding:4px 10px" @click="clearLocalData">清空本地测试数据</button>
    <button style="font-size:13px;padding:4px 10px" @click="authStore.signOut()">退出</button>
  </nav>

  <!-- 云端同步失败 banner：本地已保存但 Supabase 写入失败时显示 -->
  <div
    v-if="syncStatus.error"
    style="background:#fff3e0;border-bottom:1px solid #f97316;padding:8px 16px;display:flex;align-items:center;justify-content:space-between;font-size:13px;color:#9a3412"
  >
    <span>{{ syncStatus.error }}</span>
    <button style="border:none;background:none;cursor:pointer;font-size:16px;color:#9a3412;line-height:1" @click="syncStatus.error = ''">×</button>
  </div>

  <!-- 全局存储错误 banner：localStorage 写入失败时显示 -->
  <div
    v-if="storageStatus.error"
    style="background:#fff0f0;border-bottom:1px solid var(--color-danger);padding:8px 16px;display:flex;align-items:center;justify-content:space-between;font-size:13px;color:var(--color-danger)"
  >
    <span>⚠ {{ storageStatus.error }}</span>
    <button style="border:none;background:none;cursor:pointer;font-size:16px;color:var(--color-danger);line-height:1" @click="storageStatus.error = ''">×</button>
  </div>

  <RouterView />

  <!-- Quick Capture Button -->
  <button v-if="authStore.user" class="quick-capture-btn" @click="showQuickCapture = true" title="快速记录">+</button>

  <!-- Quick Capture Modal -->
  <div class="modal-overlay" v-if="showQuickCapture" @click.self="resetCapture">
    <div class="modal" @dragover.prevent @drop.prevent>
      <h3>快速记录</h3>
      <div class="mb-12">
        <select v-model="captureType">
          <option value="progress">专项进展</option>
          <option value="material">材料记录</option>
          <option value="idea">想法碎片</option>
        </select>
      </div>
      <div v-if="captureType === 'progress'" class="mb-12">
        <label class="text-xs text-secondary">关联专项</label>
        <select v-model="captureProject">
          <option value="">默认第一个</option>
          <option v-for="p in projectsStore.names" :key="p" :value="p">{{ p }}</option>
        </select>
      </div>
      <div class="mb-12">
        <textarea v-model="captureText" placeholder="输入内容..." rows="4"></textarea>
      </div>
      <div class="mb-12">
        <FileUploader label="附件（图片/文件，支持拖拽）" />
      </div>
      <div v-if="captureError" class="text-xs mb-8" style="color:var(--color-danger)">{{ captureError }}</div>
      <div class="flex gap-8" style="justify-content:flex-end">
        <button @click="resetCapture" :disabled="captureLoading">取消</button>
        <button @click="saveDirect" :disabled="captureLoading">保存</button>
        <button class="primary" @click="saveWithAI" :disabled="captureLoading">
          {{ captureLoading ? 'AI 整理中...' : '保存并 AI 整理' }}
        </button>
      </div>
    </div>
  </div>
</template>
