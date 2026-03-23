<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useProjectsStore } from '../stores/projects.js'
import { useTasksStore } from '../stores/tasks.js'
import { useMaterialsStore } from '../stores/materials.js'
import FileUploader from '../components/shared/FileUploader.vue'
import TagPicker from '../components/shared/TagPicker.vue'
import MarkdownContent from '../components/shared/MarkdownContent.vue'
import AutoTextarea from '../components/shared/AutoTextarea.vue'
import RichEditor from '../components/shared/RichEditor.vue'
import { organizeProgress } from '../ai/organizeService.js'
import { extractTextFromFile, textToPreviewHtml } from '../utils/fileExtractor.js'
import { useAuthStore } from '../stores/auth.js'

const projectsStore = useProjectsStore()
const tasksStore = useTasksStore()
const materialsStore = useMaterialsStore()
const authStore = useAuthStore()

// -- Project status config --
const projectStatusLabels = { active: '进行中', done: '已完成', paused: '暂停' }
const projectStatusColors = { active: 'var(--color-primary)', done: 'var(--color-success)', paused: 'var(--color-warning)' }

// -- Selection --
const selectedId = ref(projectsStore.items[0]?.id || null)
const current = computed(() => projectsStore.getById(selectedId.value))

// 若组件挂载时 items 为空（HMR 状态丢失或云端延迟），补救性重新拉取
onMounted(async () => {
  if (projectsStore.items.length === 0 && authStore.user) {
    await projectsStore.initFromCloud(authStore.user.id)
    if (!selectedId.value && projectsStore.items.length > 0) {
      selectedId.value = projectsStore.items[0].id
    }
  }
})

// items 变化时自动修正 selectedId（防止 HMR 后 selectedId 失效）
watch(() => projectsStore.items, (items) => {
  if (!selectedId.value && items.length > 0) {
    selectedId.value = items[0].id
  }
}, { immediate: false })

// -- Related tasks --
const relatedTasks = computed(() => {
  if (!current.value) return []
  return tasksStore.byProject(current.value.id, current.value.name)
})
const activeRelatedTasks = computed(() => relatedTasks.value.filter(t => t.status !== 'done'))
const doneRelatedTasks = computed(() => relatedTasks.value.filter(t => t.status === 'done'))

// -- Delete project --
const showProjectMenu   = ref(false)
const showDeleteConfirm = ref(false)

/**
 * 删除专项：
 * 1. 关联任务的 project 字段清空（保留任务本身）
 * 2. 资料库条目的 project 字段清空（保留资料本身）
 * 3. 删除专项（判断历史 + 进展时间线随之删除，存于专项内部）
 * 4. 自动切换到剩余第一个专项
 */
function deleteProject() {
  if (!current.value) return
  const projectName = current.value.name
  const projectId   = current.value.id

  // 解除关联任务
  for (const t of tasksStore.items) {
    if (t.project_id === projectId || (!t.project_id && t.project === projectName)) {
      tasksStore.update(t.id, { project: '', project_id: null })
    }
  }

  // 解除关联资料
  for (const m of materialsStore.items) {
    if (m.project_id === projectId || (!m.project_id && m.project === projectName)) {
      materialsStore.update(m.id, { project: '', project_id: null })
    }
  }

  // 删除专项本身（含 judgements / updates）
  projectsStore.remove(projectId)

  // 切到剩余第一个，没有则置 null
  showDeleteConfirm.value = false
  showProjectMenu.value   = false
  selectedId.value = projectsStore.items[0]?.id ?? null
}

// -- Create project --
const showNewProject = ref(false)
const newProjectName = ref('')

function createProject() {
  if (!newProjectName.value.trim()) return
  const p = projectsStore.add({ name: newProjectName.value.trim() })
  selectedId.value = p.id
  newProjectName.value = ''
  showNewProject.value = false
}

function updateProjectStatus(status) {
  projectsStore.update(selectedId.value, { status })
}

// -- Judgements --
const judgements = computed(() => projectsStore.getJudgements(selectedId.value))

const showJudgementHistory = ref(false)
const showDoneRelatedTasks = ref(false)

// Add new version
const editingJudgement = ref(false)
const judgementDraft = ref('')
const judgementDraftTime = ref('')

function startAddJudgement() {
  judgementDraft.value = ''
  judgementDraftTime.value = nowDatetimeLocal()
  editingJudgement.value = true
}

function saveJudgement() {
  const text = judgementDraft.value?.replace(/<[^>]+>/g, '').trim()
  if (!text) return
  const iso = judgementDraftTime.value ? new Date(judgementDraftTime.value).toISOString() : new Date().toISOString()
  projectsStore.addJudgement(selectedId.value, judgementDraft.value, iso)
  editingJudgement.value = false
}

// Edit existing judgement
const editingJudgementId = ref(null)
const judgementEditDraft = ref('')
const judgementEditDraftTime = ref('')

function startEditJudgementItem(j) {
  editingJudgementId.value = j.id
  judgementEditDraft.value = j.content
  judgementEditDraftTime.value = toDatetimeLocal(j.created_at)
}

function saveJudgementEdit(j) {
  const text = judgementEditDraft.value?.replace(/<[^>]+>/g, '').trim()
  if (!text) return
  const iso = judgementEditDraftTime.value ? new Date(judgementEditDraftTime.value).toISOString() : j.created_at
  projectsStore.updateJudgement(selectedId.value, j.id, judgementEditDraft.value, iso)
  editingJudgementId.value = null
}

function deleteJudgement(id) {
  projectsStore.removeJudgement(selectedId.value, id)
}

// -- Progress timeline --
const updates = computed(() => projectsStore.getUpdates(selectedId.value))

// Expand/collapse per entry; default first entry open
const expandedUpdateId = ref(null)
// ⋯ more menu per entry
const openMenuId = ref(null)

function toggleExpand(id) {
  expandedUpdateId.value = expandedUpdateId.value === id ? null : id
  openMenuId.value = null
}

// Add new progress
const showAddProgress = ref(false)
// progressDraft = 唯一正文状态源（手动输入 & 文件导入都写这里）
const progressTitle = ref('')
const progressDraft = ref('')
// progressImportedHtml = 仅用于 v-html 预览显示，与 progressDraft 同步
const progressImportedHtml = ref('')
const progressTags = ref([])
const progressHighlight = ref(false)
const progressDraftTime = ref('')
const aiProcessing = ref(false)
const aiResult = ref(null)
const progressAiError = ref('')

function startAddProgress() {
  progressDraftTime.value = nowDatetimeLocal()
  progressAiError.value = ''
  progressTitle.value = ''
  progressDraft.value = ''
  progressImportedHtml.value = ''
  progressHighlight.value = false
  showAddProgress.value = true
}

function saveProgressDirect() {
  const content = progressDraft.value
  if (!content.replace(/<[^>]+>/g, '').trim()) {
    progressAiError.value = '内容为空，无法保存'
    return
  }
  const iso = progressDraftTime.value ? new Date(progressDraftTime.value).toISOString() : new Date().toISOString()
  const titleVal = progressTitle.value.trim() || content.replace(/<[^>]+>/g, '').trim().slice(0, 30)
  projectsStore.addProjectUpdate(selectedId.value, {
    title: titleVal,
    content,
    tags: progressTags.value,
    highlight: progressHighlight.value,
    created_at: iso,
  })
  progressTitle.value = ''
  progressDraft.value = ''
  progressImportedHtml.value = ''
  progressTags.value = []
  progressHighlight.value = false
  showAddProgress.value = false
}

async function submitProgress() {
  const contentText = progressDraft.value.replace(/<[^>]+>/g, '').trim()
  if (!contentText) return
  aiProcessing.value = true
  progressAiError.value = ''
  const iso = progressDraftTime.value ? new Date(progressDraftTime.value).toISOString() : new Date().toISOString()
  try {
    const result = await organizeProgress(progressDraft.value, current.value?.name)
    aiResult.value = {
      title: progressTitle.value.trim() || result.title,
      content: result.content || progressDraft.value,
      tags: result.suggestedTags?.length > 0 ? result.suggestedTags : progressTags.value,
      highlight: progressHighlight.value,
      created_at: iso,
    }
  } catch (err) {
    progressAiError.value = err.message || 'AI 整理失败，请重试或使用普通保存'
  } finally {
    aiProcessing.value = false
  }
}

async function onProgressFiles(fileList) {
  progressAiError.value = ''
  for (const f of fileList) {
    const result = await extractTextFromFile(f)
    if (!result.success) {
      progressAiError.value = `导入失败：${result.error}`
      continue
    }
    const content = result.contentHtml || textToPreviewHtml(result.contentText || '')
    // 同步写入唯一正文源 progressDraft（保存/AI 都读这里）
    progressDraft.value = (progressDraft.value ? progressDraft.value + '\n' : '') + content
    // 同步写入预览变量（v-html 显示用）
    progressImportedHtml.value = progressDraft.value
  }
}

function confirmProgress() {
  if (!aiResult.value) return
  const iso = progressDraftTime.value ? new Date(progressDraftTime.value).toISOString() : new Date().toISOString()
  projectsStore.addProjectUpdate(selectedId.value, {
    title: aiResult.value.title,
    content: aiResult.value.content,
    tags: aiResult.value.tags,
    highlight: aiResult.value.highlight,
    created_at: iso,
  })
  progressTitle.value = ''
  progressDraft.value = ''
  progressImportedHtml.value = ''
  progressTags.value = []
  progressHighlight.value = false
  aiResult.value = null
  showAddProgress.value = false
}

// Edit existing timeline entry
const editingUpdateId = ref(null)
const updateEditDraft = ref({ title: '', content: '', tags: [], highlight: false })
const updateEditDraftTime = ref('')
const editUpdateLoading = ref(false)
const editUpdateError = ref('')

function startEditUpdate(u) {
  editingUpdateId.value = u.id
  updateEditDraft.value = {
    title: u.title,
    content: u.content,
    tags: [...(u.tags || [])],
    highlight: u.highlight || false,
  }
  updateEditDraftTime.value = toDatetimeLocal(u.created_at)
}

function saveUpdateEdit() {
  if (!updateEditDraft.value.title.trim()) return
  const iso = updateEditDraftTime.value ? new Date(updateEditDraftTime.value).toISOString() : undefined
  projectsStore.updateProjectUpdate(selectedId.value, editingUpdateId.value, {
    title: updateEditDraft.value.title.trim(),
    content: updateEditDraft.value.content.trim(),
    tags: updateEditDraft.value.tags,
    highlight: updateEditDraft.value.highlight,
    ...(iso ? { created_at: iso } : {}),
  })
  editingUpdateId.value = null
}

async function saveUpdateEditWithAI() {
  const contentText = updateEditDraft.value.content?.replace(/<[^>]+>/g, '').trim()
  if (!contentText) return
  editUpdateLoading.value = true
  editUpdateError.value = ''
  try {
    const result = await organizeProgress(updateEditDraft.value.content, current.value?.name)
    const iso = updateEditDraftTime.value ? new Date(updateEditDraftTime.value).toISOString() : undefined
    projectsStore.updateProjectUpdate(selectedId.value, editingUpdateId.value, {
      title: result.title,
      content: result.content || updateEditDraft.value.content.trim(),
      tags: result.suggestedTags?.length > 0 ? result.suggestedTags : updateEditDraft.value.tags,
      ...(iso ? { created_at: iso } : {}),
    })
    editingUpdateId.value = null
  } catch (err) {
    editUpdateError.value = err.message || 'AI 整理失败，请重试'
  } finally {
    editUpdateLoading.value = false
  }
}

function deleteUpdate(id) {
  projectsStore.removeProjectUpdate(selectedId.value, id)
  if (expandedUpdateId.value === id) expandedUpdateId.value = null
}

// When project switches: reset editing state, expand first update
watch(selectedId, () => {
  editingJudgement.value = false
  editingJudgementId.value = null
  editingUpdateId.value = null
  expandedUpdateId.value = updates.value[0]?.id ?? null
  showJudgementHistory.value = false
  showDoneRelatedTasks.value = false
  openMenuId.value = null
  progressTags.value = []
  showProjectMenu.value   = false
  showDeleteConfirm.value = false
}, { immediate: true })

// -- Add task from project --
const newTaskTitle = ref('')
function addTaskFromProject() {
  if (!newTaskTitle.value.trim() || !current.value) return
  tasksStore.add({
    title: newTaskTitle.value.trim(),
    project: current.value.name,
    project_id: current.value.id,
  })
  newTaskTitle.value = ''
}

// -- Format time --
function fmtTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function toDatetimeLocal(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0') + 'T' +
    String(d.getHours()).padStart(2, '0') + ':' +
    String(d.getMinutes()).padStart(2, '0')
}

function nowDatetimeLocal() {
  return toDatetimeLocal(new Date().toISOString())
}
</script>

<template>
  <div class="page-wide projects-layout" @click="showProjectMenu = false">
    <!-- Left: Project List -->
    <div class="projects-left">
      <div class="flex-between mb-12">
        <div class="card-title" style="margin:0">专项列表</div>
        <button class="small" @click="showNewProject = true">+ 新建</button>
      </div>

      <div v-if="showNewProject" class="card mb-8" style="background:var(--color-bg)">
        <input type="text" v-model="newProjectName" placeholder="输入专项名称" @keydown.enter="createProject" />
        <div class="flex gap-8 mt-8" style="justify-content:flex-end">
          <button class="small" @click="showNewProject = false; newProjectName = ''">取消</button>
          <button class="small primary" @click="createProject">创建</button>
        </div>
      </div>

      <div
        v-for="p in projectsStore.items"
        :key="p.id"
        class="card"
        :style="{
          cursor: 'pointer',
          borderColor: selectedId === p.id ? 'var(--color-primary)' : '',
          background: selectedId === p.id ? 'var(--color-primary-light)' : '',
        }"
        @click="selectedId = p.id"
      >
        <div class="flex-between">
          <span style="font-weight:600;font-size:15px">{{ p.name }}</span>
          <span class="tag" :style="{ color: projectStatusColors[p.status], borderColor: projectStatusColors[p.status] }">{{ projectStatusLabels[p.status] }}</span>
        </div>
        <div class="flex-between mt-8">
          <span class="text-xs text-secondary">{{ fmtTime(p.updated_at) }}</span>
          <span class="text-xs text-secondary">{{ tasksStore.byProject(p.id, p.name).length }} 个任务</span>
        </div>
      </div>
    </div>

    <!-- Right: Project Detail -->
    <div class="projects-right" v-if="current">
      <div class="flex-between" style="margin-bottom:20px">
        <h2 style="font-size:20px;margin:0">{{ current.name }}</h2>
        <div class="flex gap-8" style="align-items:center">
          <select :value="current.status" @change="updateProjectStatus($event.target.value)" style="width:auto;font-size:13px;padding:4px 10px">
            <option value="active">进行中</option>
            <option value="done">已完成</option>
            <option value="paused">暂停</option>
          </select>
          <!-- 更多操作菜单 -->
          <div style="position:relative">
            <button
              class="small"
              style="padding:2px 8px;font-size:15px;line-height:1.4"
              :style="{ background: showProjectMenu ? 'var(--color-border)' : '' }"
              @click.stop="showProjectMenu = !showProjectMenu"
              title="更多操作"
            >⋯</button>
            <div
              v-if="showProjectMenu"
              style="position:absolute;right:0;top:calc(100% + 4px);background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius);z-index:20;min-width:96px;padding:4px 0;box-shadow:0 2px 8px rgba(0,0,0,.1)"
              @click.stop
            >
              <button
                class="small"
                style="display:block;width:100%;text-align:left;padding:7px 14px;border:none;border-radius:0;background:transparent;color:var(--color-danger)"
                @click="showDeleteConfirm = true; showProjectMenu = false"
              >删除专项</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Current Judgement -->
      <div class="card section">
        <div class="flex-between">
          <div class="card-title" style="margin:0">当前判断</div>
          <button class="small" @click="startAddJudgement">+ 新增</button>
        </div>

        <!-- Add new version form -->
        <div v-if="editingJudgement" class="mt-12">
          <RichEditor v-model="judgementDraft" />
          <div class="flex gap-8 mt-8" style="align-items:center">
            <label class="text-xs text-secondary" style="flex-shrink:0">记录时间</label>
            <input type="datetime-local" v-model="judgementDraftTime" style="width:auto;flex:1;font-size:12px" />
            <button class="small" @click="editingJudgement = false">取消</button>
            <button class="small primary" @click="saveJudgement">保存</button>
          </div>
        </div>

        <!-- Latest judgement (always expanded) -->
        <div v-if="judgements[0]" class="mt-12">
          <div class="flex-between">
            <span class="text-xs text-secondary">最新 &middot; {{ fmtTime(judgements[0].created_at) }}</span>
            <div class="flex gap-8">
              <button class="small" @click="startEditJudgementItem(judgements[0])">编辑</button>
              <button class="small" style="color:var(--color-danger)" @click="deleteJudgement(judgements[0].id)">删除</button>
            </div>
          </div>
          <div v-if="editingJudgementId === judgements[0].id" class="mt-8">
            <RichEditor v-model="judgementEditDraft" />
            <div class="flex gap-8 mt-8" style="align-items:center">
              <label class="text-xs text-secondary" style="flex-shrink:0">记录时间</label>
              <input type="datetime-local" v-model="judgementEditDraftTime" style="width:auto;flex:1;font-size:12px" />
              <button class="small" @click="editingJudgementId = null">取消</button>
              <button class="small primary" @click="saveJudgementEdit(judgements[0])">保存</button>
            </div>
          </div>
          <div v-else class="mt-8 rich-content" v-html="judgements[0].content" />
        </div>

        <!-- History toggle -->
        <div v-if="judgements.length > 1" class="mt-12">
          <button class="small" @click="showJudgementHistory = !showJudgementHistory">
            {{ showJudgementHistory ? '收起历史' : `展开历史判断（${judgements.length - 1} 条）` }}
          </button>
        </div>

        <!-- Historical judgements (collapsed by default) -->
        <template v-if="showJudgementHistory">
          <div v-for="j in judgements.slice(1)" :key="j.id" class="mt-12" style="opacity:0.6">
            <div class="flex-between">
              <span class="text-xs text-secondary">历史 &middot; {{ fmtTime(j.created_at) }}</span>
              <div class="flex gap-8">
                <button class="small" @click="startEditJudgementItem(j)">编辑</button>
                <button class="small" style="color:var(--color-danger)" @click="deleteJudgement(j.id)">删除</button>
              </div>
            </div>
            <div v-if="editingJudgementId === j.id" class="mt-8">
              <RichEditor v-model="judgementEditDraft" />
              <div class="flex gap-8 mt-8" style="align-items:center">
                <label class="text-xs text-secondary" style="flex-shrink:0">记录时间</label>
                <input type="datetime-local" v-model="judgementEditDraftTime" style="width:auto;flex:1;font-size:12px" />
                <button class="small" @click="editingJudgementId = null">取消</button>
                <button class="small primary" @click="saveJudgementEdit(j)">保存</button>
              </div>
            </div>
            <div v-else class="mt-8 rich-content" v-html="j.content" />
          </div>
        </template>

        <div v-if="judgements.length === 0 && !editingJudgement" class="text-sm text-secondary mt-12">暂无判断记录</div>
      </div>

      <!-- Progress Timeline -->
      <div class="card section">
        <div class="flex-between">
          <div class="card-title" style="margin:0">进展时间线</div>
          <button class="small" @click="startAddProgress">+ 新增进展</button>
        </div>

        <!-- Add Progress Inline -->
        <div v-if="showAddProgress" class="mt-12" style="padding:12px;border-radius:var(--radius);background:var(--color-bg)" @dragover.prevent @drop.prevent>
          <div v-if="!aiResult">
            <div class="mb-8">
              <label class="text-xs text-secondary">标题</label>
              <input type="text" v-model="progressTitle" placeholder="进展标题（选填，留空自动从内容提取）" />
            </div>
            <!-- 文件导入后：HTML 完整预览，绕过 Tiptap（Tiptap 无表格支持） -->
            <div v-if="progressImportedHtml">
              <div class="flex-between mb-4">
                <label class="text-xs text-secondary">已导入内容预览</label>
                <button class="small" style="font-size:11px" @click="progressImportedHtml = ''; progressDraft = ''">清除导入</button>
              </div>
              <div class="rich-content" style="max-height:300px;overflow-y:auto;padding:12px;border:1px solid var(--color-border);border-radius:var(--radius);background:var(--color-surface)" v-html="progressImportedHtml" />
            </div>
            <!-- 无导入内容时：RichEditor 手动输入 -->
            <RichEditor v-else v-model="progressDraft" :enableImagePaste="true" />
            <div class="mt-8">
              <label class="text-xs text-secondary">标签</label>
              <TagPicker v-model="progressTags" scope-type="project" :scope-id="String(selectedId)" />
            </div>
            <div class="mt-8">
              <FileUploader label="导入文件（txt / md / docx / pdf，支持拖拽）" accept=".txt,.md,.docx,.pdf" @files-changed="onProgressFiles" />
            </div>
            <div class="flex-center gap-8 mt-8">
              <label class="flex-center gap-4" style="cursor:pointer;font-size:13px">
                <input type="checkbox" v-model="progressHighlight" style="cursor:pointer" />
                ⭐ 核心进展
              </label>
            </div>
            <div v-if="progressAiError" class="text-xs mt-8" style="color:var(--color-danger);background:#fff0f0;border:1px solid var(--color-danger);border-radius:4px;padding:6px 10px">{{ progressAiError }}</div>
            <div class="flex gap-8 mt-8" style="align-items:center">
              <label class="text-xs text-secondary" style="flex-shrink:0">记录时间</label>
              <input type="datetime-local" v-model="progressDraftTime" style="width:auto;flex:1;font-size:12px" />
              <button class="small" @click="showAddProgress = false; progressTitle = ''; progressDraft = ''; progressImportedHtml = ''; progressHighlight = false; progressAiError = ''" :disabled="aiProcessing">取消</button>
              <button class="small" @click="saveProgressDirect" :disabled="aiProcessing">保存</button>
              <button class="small primary" @click="submitProgress" :disabled="aiProcessing">
                {{ aiProcessing ? 'AI 整理中...' : '保存并 AI 整理' }}
              </button>
            </div>
          </div>
          <div v-else>
            <div class="text-xs text-secondary mb-8">AI 整理结果（可编辑）</div>
            <div class="mb-8">
              <label class="text-xs text-secondary">标题</label>
              <input type="text" v-model="aiResult.title" />
            </div>
            <div class="mb-8">
              <label class="text-xs text-secondary">内容</label>
              <RichEditor v-model="aiResult.content" />
            </div>
            <div class="mb-8">
              <label class="text-xs text-secondary">标签</label>
              <TagPicker v-model="aiResult.tags" scope-type="project" :scope-id="String(selectedId)" />
            </div>
            <div class="flex-center gap-8 mt-8">
              <label class="flex-center gap-4" style="cursor:pointer;font-size:13px">
                <input type="checkbox" v-model="aiResult.highlight" style="cursor:pointer" />
                ⭐ 核心进展
              </label>
            </div>
            <div class="flex gap-8 mt-8" style="align-items:center">
              <label class="text-xs text-secondary" style="flex-shrink:0">记录时间</label>
              <input type="datetime-local" v-model="progressDraftTime" style="width:auto;flex:1;font-size:12px" />
              <button class="small" @click="aiResult = null">重新编辑</button>
              <button class="small primary" @click="confirmProgress">确认保存</button>
            </div>
          </div>
        </div>

        <!-- Timeline entries -->
        <div
          v-for="u in updates" :key="u.id" class="mt-12 update-entry"
          :class="{ 'update-highlight': u.highlight }"
        >
          <!-- Edit mode -->
          <div v-if="editingUpdateId === u.id">
            <div class="mb-8">
              <label class="text-xs text-secondary">标题</label>
              <input type="text" v-model="updateEditDraft.title" />
            </div>
            <div class="mb-8">
              <label class="text-xs text-secondary">内容</label>
              <RichEditor v-model="updateEditDraft.content" :enableImagePaste="true" />
            </div>
            <div class="mb-8">
              <label class="text-xs text-secondary">标签</label>
              <TagPicker v-model="updateEditDraft.tags" scope-type="project" :scope-id="String(selectedId)" />
            </div>
            <div class="flex-center gap-8 mb-8">
              <label class="flex-center gap-4" style="cursor:pointer;font-size:13px">
                <input type="checkbox" v-model="updateEditDraft.highlight" style="cursor:pointer" />
                ⭐ 核心进展
              </label>
            </div>
            <div v-if="editUpdateError" class="text-xs mb-8" style="color:var(--color-danger)">{{ editUpdateError }}</div>
            <div class="flex gap-8" style="align-items:center">
              <label class="text-xs text-secondary" style="flex-shrink:0">记录时间</label>
              <input type="datetime-local" v-model="updateEditDraftTime" style="width:auto;flex:1;font-size:12px" />
              <button class="small" @click="editingUpdateId = null; editUpdateError = ''" :disabled="editUpdateLoading">取消</button>
              <button class="small" @click="saveUpdateEdit" :disabled="editUpdateLoading">保存</button>
              <button class="small primary" @click="saveUpdateEditWithAI" :disabled="editUpdateLoading">
                {{ editUpdateLoading ? 'AI 整理中...' : 'AI 整理后保存' }}
              </button>
            </div>
          </div>
          <!-- Read mode (collapsed/expanded) -->
          <div v-else>
            <div class="flex-between" style="cursor:pointer" @click="toggleExpand(u.id)">
              <div>
                <span v-if="u.highlight" style="margin-right:4px">⭐</span>
                <strong class="text-sm">{{ u.title }}</strong>
                <span class="text-xs text-secondary" style="margin-left:8px">{{ fmtTime(u.created_at) }}</span>
              </div>
              <div class="flex gap-8" style="align-items:center">
                <span v-for="tag in u.tags" :key="tag" class="tag">{{ tag }}</span>
                <!-- ⋯ more menu -->
                <div style="position:relative">
                  <button
                    class="small"
                    style="padding:2px 7px;font-size:15px;line-height:1"
                    @click.stop="openMenuId = openMenuId === u.id ? null : u.id"
                  >⋯</button>
                  <div
                    v-if="openMenuId === u.id"
                    style="position:absolute;right:0;top:calc(100% + 4px);background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius);z-index:10;min-width:80px;padding:4px 0;box-shadow:0 2px 8px rgba(0,0,0,.08)"
                  >
                    <button
                      class="small"
                      style="display:block;width:100%;text-align:left;padding:6px 14px;border:none;border-radius:0;background:transparent"
                      @click.stop="startEditUpdate(u); openMenuId = null"
                    >编辑</button>
                    <button
                      class="small"
                      style="display:block;width:100%;text-align:left;padding:6px 14px;border:none;border-radius:0;background:transparent;color:var(--color-danger)"
                      @click.stop="deleteUpdate(u.id); openMenuId = null"
                    >删除</button>
                  </div>
                </div>
              </div>
            </div>
            <div v-if="expandedUpdateId === u.id" class="mt-8 rich-content" v-html="u.content" />
          </div>
        </div>

        <div v-if="updates.length === 0" class="text-sm text-secondary mt-12">暂无进展记录</div>
      </div>

      <!-- Related Tasks -->
      <div class="card section">
        <div class="card-title">关联任务</div>

        <!-- Active tasks (todo + doing) -->
        <div v-for="t in activeRelatedTasks" :key="t.id" class="flex-between mb-8">
          <span class="text-sm">{{ t.title }}</span>
          <span class="tag" :class="{ primary: t.status === 'doing' }">
            {{ t.status === 'todo' ? '未开始' : '进行中' }}
          </span>
        </div>
        <div v-if="relatedTasks.length === 0" class="text-sm text-secondary">暂无关联任务</div>

        <!-- Done tasks toggle -->
        <div v-if="doneRelatedTasks.length > 0" class="mt-8">
          <button class="small" @click="showDoneRelatedTasks = !showDoneRelatedTasks">
            {{ showDoneRelatedTasks ? '收起已完成' : `已完成 (${doneRelatedTasks.length})` }}
          </button>
        </div>
        <template v-if="showDoneRelatedTasks">
          <div v-for="t in doneRelatedTasks" :key="t.id" class="flex-between mb-8 mt-8" style="opacity:0.5">
            <span class="text-sm" style="text-decoration:line-through">{{ t.title }}</span>
            <span class="tag">已完成</span>
          </div>
        </template>

        <div class="flex gap-8 mt-12">
          <input type="text" v-model="newTaskTitle" placeholder="+ 创建关联任务" @keydown.enter="addTaskFromProject" style="flex:1" />
          <button class="small primary" @click="addTaskFromProject">添加</button>
        </div>
      </div>
    </div>
  </div>

  <!-- 删除专项确认弹窗 -->
  <div
    v-if="showDeleteConfirm"
    style="position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:200"
    @click.self="showDeleteConfirm = false"
  >
    <div style="background:var(--color-surface);border-radius:var(--radius);padding:28px 24px;max-width:400px;width:90%;box-shadow:0 4px 24px rgba(0,0,0,.15)">
      <div style="font-weight:600;font-size:16px;margin-bottom:12px">删除专项「{{ current?.name }}」？</div>
      <p style="font-size:14px;color:var(--color-text-secondary,#666);line-height:1.6;margin-bottom:20px">
        该专项的判断历史和进展记录会被永久删除。<br>
        关联任务和资料库内容将保留，但会解除与该专项的关联。<br>
        <strong style="color:var(--color-danger)">此操作不可撤销。</strong>
      </p>
      <div class="flex gap-8" style="justify-content:flex-end">
        <button class="small" @click="showDeleteConfirm = false">取消</button>
        <button
          class="small"
          style="background:var(--color-danger,#e53935);color:#fff;border-color:var(--color-danger,#e53935)"
          @click="deleteProject"
        >确认删除</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.projects-layout {
  display: flex;
  gap: 20px;
  align-items: flex-start;
}
.projects-left {
  flex: 0 0 260px;
  min-width: 0;
}
.projects-right {
  flex: 1;
  min-width: 0;
}

.update-entry {
  padding-left: 16px;
  border-left: 2px solid var(--color-border);
}
.update-highlight {
  border-left-color: var(--color-primary);
  background: var(--color-primary-light, #e8f0fe);
  border-radius: 0 var(--radius) var(--radius) 0;
  padding: 8px 8px 8px 16px;
}
</style>
