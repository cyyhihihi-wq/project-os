<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { useTasksStore } from '../stores/tasks.js'
import { useProjectsStore } from '../stores/projects.js'
import RichEditor from '../components/shared/RichEditor.vue'
import { generateWeekSummary } from '../ai/organizeService.js'

const tasksStore = useTasksStore()
const projectsStore = useProjectsStore()

// ── 周导航 ──
const currentWeekOffset = ref(0)

function getWeekInfo(offset) {
  const now = new Date()
  const target = new Date(now)
  target.setDate(target.getDate() + offset * 7)
  const day = target.getDay()
  const diff = target.getDate() - day + (day === 0 ? -6 : 1)
  const monday = new Date(target.setDate(diff))
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const yearStart = new Date(monday.getFullYear(), 0, 1)
  const weekNo = Math.ceil(((monday - yearStart) / 86400000 + yearStart.getDay() + 1) / 7)
  const fmt = d => `${d.getMonth() + 1}/${d.getDate()}`
  return { weekNo, range: `${fmt(monday)}-${fmt(sunday)}`, monday, sunday }
}

const weekInfo = computed(() => getWeekInfo(currentWeekOffset.value))
const weekKey = computed(() => {
  const w = weekInfo.value
  return `${w.monday.getFullYear()}-W${String(w.weekNo).padStart(2, '0')}`
})

const todayStr = computed(() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})

// ── 周统计 ──
const weekDoneCount = computed(() => {
  const { monday, sunday } = weekInfo.value
  const end = new Date(sunday); end.setHours(23, 59, 59, 999)
  return tasksStore.items.filter(t => {
    if (t.status !== 'done' || !t.completed_at) return false
    const d = new Date(t.completed_at)
    return d >= monday && d <= end
  }).length
})

const weekProjectUpdates = computed(() => {
  const { monday, sunday } = weekInfo.value
  const end = new Date(sunday); end.setHours(23, 59, 59, 999)
  let count = 0
  for (const p of projectsStore.items) {
    for (const u of (p.updates || [])) {
      const d = new Date(u.created_at)
      if (d >= monday && d <= end) count++
    }
  }
  return count
})

// ── Capture 区 ──
const captureText = ref('')
const captureRef = ref(null)
const captureExpanded = ref(false)

function expandCapture() {
  captureExpanded.value = true
  nextTick(() => captureRef.value?.focus())
}

function submitCapture() {
  const lines = captureText.value.split('\n')
  const weekNo = weekInfo.value.weekNo
  tasksStore.batchCreate(lines, { week: weekNo })
  captureText.value = ''
  captureExpanded.value = false
}

function onCaptureKeydown(e) {
  // Ctrl+Enter / Cmd+Enter 提交
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    submitCapture()
  }
  // Escape 收起
  if (e.key === 'Escape') {
    captureExpanded.value = false
  }
}

// ── Organize 面板 ──
const showOrganize = ref(false)
const inboxTasks = computed(() => tasksStore.inboxTasks)

function assignToZone(taskId, mode) {
  tasksStore.update(taskId, { mode })
}

function markDone(taskId) {
  tasksStore.update(taskId, { status: 'done' })
}

// ── 展开/折叠任务详情 ──
const expandedId = ref(null)

function toggleExpand(id) {
  expandedId.value = expandedId.value === id ? null : id
}

function updateTask(task, field, value) {
  tasksStore.update(task.id, { [field]: value })
}

function removeTask(id) {
  tasksStore.remove(id)
  if (expandedId.value === id) expandedId.value = null
}

// ── 快速添加任务 ──
const quickAddMode = ref(null) // 'focus' | 'quick' | 'collab' | null
const quickAddTitle = ref('')

function startQuickAdd(mode) {
  quickAddMode.value = mode
  quickAddTitle.value = ''
  nextTick(() => document.getElementById('quick-add-input')?.focus())
}

function submitQuickAdd() {
  if (!quickAddTitle.value.trim()) {
    quickAddMode.value = null
    return
  }
  const weekNo = weekInfo.value.weekNo
  tasksStore.add({ title: quickAddTitle.value.trim(), mode: quickAddMode.value, week: weekNo })
  quickAddTitle.value = ''
  quickAddMode.value = null
}

// ── Focus 子任务 ──
const focusSubtaskInputId = ref(null)
const focusSubtaskText = ref('')

function startSubtaskInput(taskId) {
  focusSubtaskInputId.value = taskId
  focusSubtaskText.value = ''
}

function submitSubtask(taskId) {
  if (!focusSubtaskText.value.trim()) {
    focusSubtaskInputId.value = null
    return
  }
  tasksStore.addFocusSubtask(taskId, focusSubtaskText.value)
  focusSubtaskText.value = ''
  focusSubtaskInputId.value = null
}

// ── 格式化 ──
function fmtDate(isoStr) {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function fmtDue(dateStr) {
  if (!dateStr) return ''
  const [, m, d] = dateStr.split('-')
  return `${+m}/${+d}`
}

// ── 完成统计（沉浸区子任务进度） ──
function subtaskProgress(task) {
  const subs = task.focus_subtasks || []
  if (!subs.length) return null
  const done = subs.filter(s => s.done).length
  return { done, total: subs.length }
}

// ── 周总结 ──
const weekSummary = ref({ work: '', feeling: '', status: 'draft' })
const summaryWorkRef = ref(null)
const summaryFeelingRef = ref(null)

watch(weekKey, (key) => {
  weekSummary.value = tasksStore.getWeekReview(key)
  nextTick(() => {
    resizeSummaryTextarea(summaryWorkRef.value)
    resizeSummaryTextarea(summaryFeelingRef.value)
  })
}, { immediate: true })

function resizeSummaryTextarea(el) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = el.scrollHeight + 'px'
}

function saveWeekSummary() {
  tasksStore.saveWeekReview(weekKey.value, { ...weekSummary.value })
}
function onSummaryWorkInput(e) {
  resizeSummaryTextarea(e.target)
  weekSummary.value = { ...weekSummary.value, work: e.target.value }
  saveWeekSummary()
}
function onSummaryFeelingInput(e) {
  resizeSummaryTextarea(e.target)
  weekSummary.value = { ...weekSummary.value, feeling: e.target.value }
  saveWeekSummary()
}
function completeWeekSummary() {
  weekSummary.value = { ...weekSummary.value, status: 'completed' }
  saveWeekSummary()
}
function reopenWeekSummary() {
  weekSummary.value = { ...weekSummary.value, status: 'draft' }
  saveWeekSummary()
}

const summaryLoading = ref(false)
const summaryError = ref('')

async function genWeekSummary() {
  summaryLoading.value = true
  summaryError.value = ''
  try {
    const { monday, sunday } = weekInfo.value
    const endOfSunday = new Date(sunday); endOfSunday.setHours(23, 59, 59, 999)
    const projectUpdates = []
    for (const p of projectsStore.items) {
      for (const u of (p.updates || [])) {
        const d = new Date(u.created_at)
        if (d >= monday && d <= endOfSunday) projectUpdates.push({ ...u, projectName: p.name })
      }
    }
    const completedTasks = tasksStore.items.filter(t => {
      if (t.status !== 'done' || !t.completed_at) return false
      const d = new Date(t.completed_at)
      return d >= monday && d <= endOfSunday
    })
    const workText = await generateWeekSummary({ projectUpdates, completedTasks })
    weekSummary.value = { ...weekSummary.value, work: workText }
    saveWeekSummary()
    nextTick(() => resizeSummaryTextarea(summaryWorkRef.value))
  } catch (err) {
    summaryError.value = err.message || 'AI 生成失败，请重试'
  } finally {
    summaryLoading.value = false
  }
}

// ── 本周完成任务列表（折叠展示） ──
const showWeekDone = ref(false)
const weekDoneTasks = computed(() => {
  const { monday, sunday } = weekInfo.value
  const end = new Date(sunday); end.setHours(23, 59, 59, 999)
  return tasksStore.items.filter(t => {
    if (t.status !== 'done' || !t.completed_at) return false
    const d = new Date(t.completed_at)
    return d >= monday && d <= end
  }).sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at))
})
</script>

<template>
  <div class="page">

    <!-- ══ 周导航 ══ -->
    <div class="card section week-header-card">
      <div class="flex-between mb-10">
        <div class="flex-center gap-12">
          <button class="small" @click="currentWeekOffset--">&lt;</button>
          <div>
            <strong>Week {{ weekInfo.weekNo }}</strong>
            <span class="text-sm text-secondary" style="margin-left:10px">{{ weekInfo.range }}</span>
            <span v-if="currentWeekOffset === 0" class="badge-today-week">本周</span>
          </div>
          <button class="small" @click="currentWeekOffset++">&gt;</button>
        </div>
        <div class="week-stats-right">
          <span>本周完成 <strong>{{ weekDoneCount }}</strong> 件</span>
          <span class="sep">·</span>
          <span>项目推进 <strong>{{ weekProjectUpdates }}</strong> 条</span>
        </div>
      </div>
    </div>

    <!-- ══ Capture 收集区 ══ -->
    <div class="card section capture-card">
      <div v-if="!captureExpanded" class="capture-placeholder" @click="expandCapture">
        <span class="capture-plus">+</span>
        <span class="text-secondary">快速记录想做的事...</span>
      </div>
      <template v-else>
        <textarea
          ref="captureRef"
          v-model="captureText"
          class="capture-textarea"
          placeholder="每行一条任务&#10;全部加入收件箱&#10;Ctrl+Enter 提交"
          rows="4"
          @keydown="onCaptureKeydown"
        ></textarea>
        <div class="flex gap-8 mt-8">
          <button class="primary" style="flex:1" @click="submitCapture">
            加入收件箱
            <span v-if="captureText.trim()" class="badge-count">
              {{ captureText.split('\n').filter(l => l.trim()).length }}
            </span>
          </button>
          <button @click="captureExpanded = false; captureText = ''">取消</button>
        </div>
      </template>
    </div>

    <!-- ══ Organize 整理入口 ══ -->
    <div v-if="inboxTasks.length > 0" class="section">
      <button
        class="organize-trigger-btn"
        :class="{ active: showOrganize }"
        @click="showOrganize = !showOrganize"
      >
        <span class="organize-icon">{{ showOrganize ? '▼' : '▶' }}</span>
        整理收件箱
        <span class="badge-inbox-count">{{ inboxTasks.length }}</span>
      </button>
    </div>

    <!-- ══ Organize 面板 ══ -->
    <div v-if="showOrganize && inboxTasks.length > 0" class="card section organize-panel">
      <div class="organize-header">
        <span class="text-sm" style="font-weight:600">选择每条任务的工作方式</span>
        <button class="small" @click="showOrganize = false">收起</button>
      </div>
      <div class="zone-legend">
        <span class="zone-badge zone-focus-badge">🧠 沉浸</span>
        <span class="zone-badge zone-quick-badge">⚡ 快速</span>
        <span class="zone-badge zone-collab-badge">🤝 协作</span>
      </div>
      <div class="organize-list">
        <div
          v-for="task in inboxTasks"
          :key="task.id"
          class="organize-item"
        >
          <span class="organize-item-title">{{ task.title }}</span>
          <div class="organize-actions">
            <button class="zone-btn zone-btn-focus" @click="assignToZone(task.id, 'focus')" title="沉浸工作">🧠</button>
            <button class="zone-btn zone-btn-quick" @click="assignToZone(task.id, 'quick')" title="快速处理">⚡</button>
            <button class="zone-btn zone-btn-collab" @click="assignToZone(task.id, 'collab')" title="协作跟进">🤝</button>
            <button class="zone-btn zone-btn-done" @click="markDone(task.id)" title="直接完成">✓</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ══ 🧠 沉浸工作 ══ -->
    <div class="section zone-section">
      <div class="zone-title zone-title-focus">
        <span>🧠 沉浸工作</span>
        <span class="zone-count">{{ tasksStore.focusTasks.length }}</span>
      </div>

      <div v-if="tasksStore.focusTasks.length === 0 && quickAddMode !== 'focus'" class="zone-empty">
        无沉浸任务 — 整理收件箱时选择「🧠 沉浸」
      </div>

      <div
        v-for="task in tasksStore.focusTasks"
        :key="task.id"
        class="card task-card focus-task-card"
        :class="{ expanded: expandedId === task.id }"
      >
        <!-- 行头 -->
        <div class="task-row" @click="toggleExpand(task.id)">
          <button
            class="task-circle circle-focus"
            @click.stop="markDone(task.id)"
            title="完成"
          ></button>
          <div class="task-main">
            <span class="task-title">{{ task.title }}</span>
            <span v-if="task.focus_time_start" class="task-meta">
              {{ task.focus_time_start }}<span v-if="task.focus_time_end"> – {{ task.focus_time_end }}</span>
            </span>
            <span v-if="task.focus_goal" class="task-goal-preview">{{ task.focus_goal }}</span>
          </div>
          <div class="task-right">
            <span v-if="subtaskProgress(task)" class="subtask-progress">
              {{ subtaskProgress(task).done }}/{{ subtaskProgress(task).total }}
            </span>
            <span v-if="task.project" class="badge-project">{{ task.project }}</span>
          </div>
        </div>

        <!-- 展开详情 -->
        <div v-if="expandedId === task.id" class="task-detail">
          <div class="detail-row">
            <label>标题</label>
            <input type="text" :value="task.title" @change="updateTask(task, 'title', $event.target.value)" />
          </div>
          <div class="detail-row detail-row-2col">
            <div>
              <label>开始时间</label>
              <input type="time" :value="task.focus_time_start" @change="updateTask(task, 'focus_time_start', $event.target.value)" />
            </div>
            <div>
              <label>结束时间</label>
              <input type="time" :value="task.focus_time_end" @change="updateTask(task, 'focus_time_end', $event.target.value)" />
            </div>
          </div>
          <div class="detail-row">
            <label>本次目标</label>
            <input type="text" :value="task.focus_goal" placeholder="这段时间要完成什么？" @change="updateTask(task, 'focus_goal', $event.target.value)" />
          </div>

          <!-- 子任务 checkboxes -->
          <div class="detail-row">
            <label>子步骤</label>
            <div class="subtask-list">
              <div
                v-for="sub in (task.focus_subtasks || [])"
                :key="sub.id"
                class="subtask-item"
                :class="{ 'subtask-done': sub.done }"
              >
                <input
                  type="checkbox"
                  :checked="sub.done"
                  @change="tasksStore.toggleFocusSubtask(task.id, sub.id)"
                />
                <span>{{ sub.text }}</span>
                <button class="subtask-del" @click="tasksStore.removeFocusSubtask(task.id, sub.id)">×</button>
              </div>

              <!-- 新增子任务输入 -->
              <div v-if="focusSubtaskInputId === task.id" class="subtask-input-row">
                <input
                  type="text"
                  v-model="focusSubtaskText"
                  placeholder="子步骤内容..."
                  @keydown.enter="submitSubtask(task.id)"
                  @keydown.escape="focusSubtaskInputId = null"
                  autofocus
                />
                <button class="small primary" @click="submitSubtask(task.id)">添加</button>
              </div>
              <button
                v-else
                class="subtask-add-btn"
                @click.stop="startSubtaskInput(task.id)"
              >+ 添加步骤</button>
            </div>
          </div>

          <div class="detail-row">
            <label>备注</label>
            <RichEditor :modelValue="task.note" @update:modelValue="updateTask(task, 'note', $event)" />
          </div>
          <div class="detail-row">
            <label>所属专项</label>
            <select :value="task.project_id || ''" @change="(e) => { const p = projectsStore.getById(e.target.value); updateTask(task, 'project_id', e.target.value || null); updateTask(task, 'project', p?.name || '') }">
              <option value="">无</option>
              <option v-for="p in projectsStore.items" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </div>
          <div class="detail-footer">
            <button class="small" @click="assignToZone(task.id, 'inbox')">← 退回收件箱</button>
            <button class="small danger" @click="removeTask(task.id)">删除</button>
          </div>
        </div>
      </div>

      <!-- 快速添加 -->
      <div v-if="quickAddMode === 'focus'" class="quick-add-row">
        <input
          id="quick-add-input"
          type="text"
          v-model="quickAddTitle"
          placeholder="沉浸任务名称..."
          @keydown.enter="submitQuickAdd"
          @keydown.escape="quickAddMode = null"
        />
        <button class="small primary" @click="submitQuickAdd">确定</button>
        <button class="small" @click="quickAddMode = null">取消</button>
      </div>
      <button v-else class="add-zone-btn" @click="startQuickAdd('focus')">+ 添加沉浸块</button>
    </div>

    <!-- ══ ⚡ 快速处理 ══ -->
    <div class="section zone-section">
      <div class="zone-title zone-title-quick">
        <span>⚡ 快速处理</span>
        <span class="zone-count">{{ tasksStore.quickTasks.length }}</span>
      </div>

      <div v-if="tasksStore.quickTasks.length === 0 && quickAddMode !== 'quick'" class="zone-empty">
        无快速任务
      </div>

      <div
        v-for="task in tasksStore.quickTasks"
        :key="task.id"
        class="card task-card quick-task-card"
      >
        <div class="task-row" @click="toggleExpand(task.id)">
          <button
            class="task-circle circle-quick"
            @click.stop="markDone(task.id)"
            title="完成"
          ></button>
          <span class="task-title" style="flex:1">{{ task.title }}</span>
          <div class="task-right">
            <span v-if="task.due" class="task-meta">{{ fmtDue(task.due) }}</span>
            <span v-if="task.project" class="badge-project">{{ task.project }}</span>
          </div>
        </div>
        <div v-if="expandedId === task.id" class="task-detail">
          <div class="detail-row">
            <label>标题</label>
            <input type="text" :value="task.title" @change="updateTask(task, 'title', $event.target.value)" />
          </div>
          <div class="detail-row">
            <label>截止时间</label>
            <input type="date" :value="task.due" @change="updateTask(task, 'due', $event.target.value)" />
          </div>
          <div class="detail-row">
            <label>备注</label>
            <textarea :value="task.note" @change="updateTask(task, 'note', $event.target.value)" rows="2" placeholder="备注..."></textarea>
          </div>
          <div class="detail-footer">
            <button class="small" @click="assignToZone(task.id, 'inbox')">← 退回收件箱</button>
            <button class="small danger" @click="removeTask(task.id)">删除</button>
          </div>
        </div>
      </div>

      <div v-if="quickAddMode === 'quick'" class="quick-add-row">
        <input
          id="quick-add-input"
          type="text"
          v-model="quickAddTitle"
          placeholder="快速任务名称..."
          @keydown.enter="submitQuickAdd"
          @keydown.escape="quickAddMode = null"
        />
        <button class="small primary" @click="submitQuickAdd">确定</button>
        <button class="small" @click="quickAddMode = null">取消</button>
      </div>
      <button v-else class="add-zone-btn" @click="startQuickAdd('quick')">+ 添加快速任务</button>
    </div>

    <!-- ══ 🤝 协作跟进 ══ -->
    <div class="section zone-section">
      <div class="zone-title zone-title-collab">
        <span>🤝 协作跟进</span>
        <span class="zone-count">{{ tasksStore.collabTasks.length }}</span>
      </div>

      <div v-if="tasksStore.collabTasks.length === 0 && quickAddMode !== 'collab'" class="zone-empty">
        无协作任务
      </div>

      <div
        v-for="task in tasksStore.collabTasks"
        :key="task.id"
        class="card task-card collab-task-card"
      >
        <div class="task-row" @click="toggleExpand(task.id)">
          <button
            class="task-circle circle-collab"
            @click.stop="markDone(task.id)"
            title="完成"
          ></button>
          <div class="task-main">
            <span class="task-title">{{ task.title }}</span>
            <span v-if="task.collab_owner" class="task-meta">→ {{ task.collab_owner }}</span>
          </div>
          <div class="task-right">
            <span v-if="task.collab_status" class="collab-status-badge">{{ task.collab_status }}</span>
            <span v-if="task.collab_next_check" class="task-meta">查 {{ fmtDue(task.collab_next_check) }}</span>
            <span v-if="task.project" class="badge-project">{{ task.project }}</span>
          </div>
        </div>
        <div v-if="expandedId === task.id" class="task-detail">
          <div class="detail-row">
            <label>标题</label>
            <input type="text" :value="task.title" @change="updateTask(task, 'title', $event.target.value)" />
          </div>
          <div class="detail-row detail-row-2col">
            <div>
              <label>负责人</label>
              <input type="text" :value="task.collab_owner" placeholder="负责人姓名" @change="updateTask(task, 'collab_owner', $event.target.value)" />
            </div>
            <div>
              <label>状态</label>
              <input type="text" :value="task.collab_status" placeholder="进行中 / 待开始..." @change="updateTask(task, 'collab_status', $event.target.value)" />
            </div>
          </div>
          <div class="detail-row">
            <label>下次跟进</label>
            <input type="date" :value="task.collab_next_check" @change="updateTask(task, 'collab_next_check', $event.target.value)" />
          </div>
          <div class="detail-row">
            <label>备注</label>
            <RichEditor :modelValue="task.note" @update:modelValue="updateTask(task, 'note', $event)" />
          </div>
          <div class="detail-footer">
            <button class="small" @click="assignToZone(task.id, 'inbox')">← 退回收件箱</button>
            <button class="small danger" @click="removeTask(task.id)">删除</button>
          </div>
        </div>
      </div>

      <div v-if="quickAddMode === 'collab'" class="quick-add-row">
        <input
          id="quick-add-input"
          type="text"
          v-model="quickAddTitle"
          placeholder="协作任务名称..."
          @keydown.enter="submitQuickAdd"
          @keydown.escape="quickAddMode = null"
        />
        <button class="small primary" @click="submitQuickAdd">确定</button>
        <button class="small" @click="quickAddMode = null">取消</button>
      </div>
      <button v-else class="add-zone-btn" @click="startQuickAdd('collab')">+ 添加协作任务</button>
    </div>

    <!-- ══ 📥 收件箱 ══ -->
    <div class="section zone-section">
      <div class="zone-title zone-title-inbox">
        <span>📥 收件箱</span>
        <span class="zone-count">{{ inboxTasks.length }}</span>
      </div>

      <div v-if="inboxTasks.length === 0" class="zone-empty">
        收件箱是空的，专注工作中
      </div>

      <div
        v-for="task in inboxTasks"
        :key="task.id"
        class="card task-card inbox-task-card"
      >
        <div class="task-row">
          <div class="task-main" @click="toggleExpand(task.id)" style="cursor:pointer">
            <span class="task-title">{{ task.title }}</span>
            <span v-if="task.project" class="badge-project">{{ task.project }}</span>
          </div>
          <div class="inbox-zone-btns">
            <button class="zone-btn zone-btn-focus" @click="assignToZone(task.id, 'focus')" title="沉浸工作">🧠</button>
            <button class="zone-btn zone-btn-quick" @click="assignToZone(task.id, 'quick')" title="快速处理">⚡</button>
            <button class="zone-btn zone-btn-collab" @click="assignToZone(task.id, 'collab')" title="协作跟进">🤝</button>
            <button class="zone-btn zone-btn-done" @click="markDone(task.id)" title="完成">✓</button>
          </div>
        </div>
        <div v-if="expandedId === task.id" class="task-detail">
          <div class="detail-row">
            <label>标题</label>
            <input type="text" :value="task.title" @change="updateTask(task, 'title', $event.target.value)" />
          </div>
          <div class="detail-row">
            <label>所属专项</label>
            <select :value="task.project_id || ''" @change="(e) => { const p = projectsStore.getById(e.target.value); updateTask(task, 'project_id', e.target.value || null); updateTask(task, 'project', p?.name || '') }">
              <option value="">无</option>
              <option v-for="p in projectsStore.items" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </div>
          <div class="detail-row">
            <label>备注</label>
            <textarea :value="task.note" @change="updateTask(task, 'note', $event.target.value)" rows="2" placeholder="备注..."></textarea>
          </div>
          <div class="detail-footer">
            <button class="small danger" @click="removeTask(task.id)">删除</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ══ 本周已完成 ══ -->
    <div v-if="weekDoneTasks.length > 0" class="section">
      <button class="done-toggle-btn" @click="showWeekDone = !showWeekDone">
        {{ showWeekDone ? '▼' : '▶' }} 本周已完成（{{ weekDoneTasks.length }}）
      </button>
      <div v-if="showWeekDone" class="done-list">
        <div
          v-for="task in weekDoneTasks"
          :key="task.id"
          class="card task-card done-task-card"
        >
          <div class="task-row">
            <button
              class="task-circle circle-done"
              @click="updateTask(task, 'status', 'doing')"
              title="恢复未完成"
            ></button>
            <span class="task-title task-title-done">{{ task.title }}</span>
            <div class="task-right">
              <span v-if="task.project" class="badge-project">{{ task.project }}</span>
              <span v-if="task.completed_at" class="task-meta">{{ fmtDate(task.completed_at) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ══ 本周工作总结 ══ -->
    <div class="card section summary-card">
      <div class="summary-header">
        <span class="summary-title">Week {{ weekInfo.weekNo }} 工作总结</span>
        <div class="flex gap-8">
          <button
            v-if="weekSummary.status !== 'completed'"
            class="small"
            :disabled="summaryLoading"
            @click="genWeekSummary"
          >
            {{ summaryLoading ? '生成中…' : 'AI 生成' }}
          </button>
          <button
            v-if="weekSummary.status !== 'completed'"
            class="small primary"
            @click="completeWeekSummary"
          >封存</button>
          <button v-else class="small" @click="reopenWeekSummary">重开</button>
        </div>
      </div>
      <div v-if="summaryError" class="text-xs" style="color:var(--color-danger);margin-bottom:6px">{{ summaryError }}</div>
      <div v-if="weekSummary.status === 'completed'" class="summary-completed">
        <div v-if="weekSummary.work" class="summary-completed-block">
          <div class="summary-label">工作内容</div>
          <div style="white-space:pre-wrap;font-size:13px;line-height:1.7">{{ weekSummary.work }}</div>
        </div>
        <div v-if="weekSummary.feeling" class="summary-completed-block">
          <div class="summary-label">感受</div>
          <div style="white-space:pre-wrap;font-size:13px;line-height:1.7">{{ weekSummary.feeling }}</div>
        </div>
      </div>
      <template v-else>
        <div class="mb-8">
          <div class="summary-label">工作内容</div>
          <textarea
            ref="summaryWorkRef"
            :value="weekSummary.work"
            @input="onSummaryWorkInput"
            placeholder="本周做了什么..."
            style="min-height:80px;resize:none"
          ></textarea>
        </div>
        <div>
          <div class="summary-label">感受</div>
          <textarea
            ref="summaryFeelingRef"
            :value="weekSummary.feeling"
            @input="onSummaryFeelingInput"
            placeholder="本周感受..."
            style="min-height:60px;resize:none"
          ></textarea>
        </div>
      </template>
    </div>

  </div>
</template>

<style scoped>
/* ── 周头部 ── */
.week-header-card { padding-bottom: 10px; }
.badge-today-week {
  display: inline-block;
  background: var(--color-primary);
  color: #fff;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 10px;
  margin-left: 6px;
  vertical-align: middle;
}
.week-stats-right {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--color-secondary);
}
.sep { opacity: 0.4; }

/* ── Capture ── */
.capture-card { cursor: default; }
.capture-placeholder {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 4px;
  cursor: pointer;
  color: #aaa;
  user-select: none;
}
.capture-placeholder:hover { color: var(--color-text); }
.capture-plus {
  font-size: 20px;
  line-height: 1;
  color: var(--color-primary);
  font-weight: 300;
}
.capture-textarea {
  width: 100%;
  box-sizing: border-box;
  font-size: 14px;
  line-height: 1.6;
  resize: vertical;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 8px 10px;
  font-family: inherit;
  background: var(--color-bg);
  color: var(--color-text);
}
.capture-textarea:focus { outline: none; border-color: var(--color-primary); }
.badge-count {
  display: inline-block;
  background: rgba(255,255,255,0.3);
  font-size: 11px;
  padding: 0 5px;
  border-radius: 8px;
  margin-left: 6px;
}

/* ── Organize 入口 ── */
.organize-trigger-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  background: #fff7ed;
  border: 1.5px dashed #fb923c;
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 600;
  color: #ea580c;
  cursor: pointer;
  transition: background 0.15s;
}
.organize-trigger-btn.active,
.organize-trigger-btn:hover { background: #ffedd5; }
.organize-icon { font-size: 10px; }
.badge-inbox-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  background: #ea580c;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  border-radius: 10px;
  padding: 0 5px;
  margin-left: 2px;
}

/* ── Organize 面板 ── */
.organize-panel { padding: 14px 16px; }
.organize-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.zone-legend {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.zone-badge {
  font-size: 12px;
  padding: 3px 8px;
  border-radius: 12px;
  font-weight: 500;
}
.zone-focus-badge { background: #ede9fe; color: #7c3aed; }
.zone-quick-badge { background: #fef3c7; color: #d97706; }
.zone-collab-badge { background: #d1fae5; color: #059669; }

.organize-list { display: flex; flex-direction: column; gap: 8px; }
.organize-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: var(--color-bg-secondary, #f9fafb);
  border-radius: 8px;
  border: 1px solid var(--color-border);
}
.organize-item-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}
.organize-actions { display: flex; gap: 6px; flex-shrink: 0; }

/* ── Zone 按钮 ── */
.zone-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: none;
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.1s, opacity 0.1s;
}
.zone-btn:hover { transform: scale(1.1); }
.zone-btn:active { transform: scale(0.95); }
.zone-btn-focus { background: #ede9fe; }
.zone-btn-quick { background: #fef3c7; }
.zone-btn-collab { background: #d1fae5; }
.zone-btn-done { background: #f0fdf4; color: #16a34a; font-size: 14px; font-weight: 700; }

/* ── Zone 区段 ── */
.zone-section { padding-top: 6px; }
.zone-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 700;
  padding: 6px 2px;
  margin-bottom: 8px;
}
.zone-count {
  font-size: 11px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 10px;
  background: rgba(0,0,0,0.07);
  color: inherit;
  opacity: 0.8;
}
.zone-title-focus { color: #7c3aed; }
.zone-title-quick { color: #d97706; }
.zone-title-collab { color: #059669; }
.zone-title-inbox { color: #4b5563; }
.zone-empty {
  font-size: 12px;
  color: #9ca3af;
  padding: 8px 4px;
  margin-bottom: 4px;
}
.add-zone-btn {
  background: none;
  border: none;
  padding: 6px 4px;
  font-size: 13px;
  color: var(--color-secondary);
  cursor: pointer;
  margin-top: 4px;
}
.add-zone-btn:hover { color: var(--color-text); }

/* ── Task Card ── */
.task-card { padding: 10px 14px; }
.task-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 32px;
}
.task-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.task-title {
  font-size: 14px;
  line-height: 1.4;
}
.task-title-done {
  text-decoration: line-through;
  opacity: 0.5;
}
.task-meta {
  font-size: 12px;
  color: var(--color-secondary);
}
.task-goal-preview {
  font-size: 11px;
  color: #7c3aed;
  background: #ede9fe;
  padding: 1px 6px;
  border-radius: 4px;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

/* 任务圆圈按钮 */
.task-circle {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid currentColor;
  background: transparent;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s, transform 0.1s;
}
.task-circle:hover { transform: scale(1.15); }
.circle-focus { color: #7c3aed; }
.circle-focus:hover { background: #ede9fe; }
.circle-quick { color: #d97706; }
.circle-quick:hover { background: #fef3c7; }
.circle-collab { color: #059669; }
.circle-collab:hover { background: #d1fae5; }
.circle-done { color: #16a34a; background: #bbf7d0; border-color: #16a34a; }

/* 子任务进度 */
.subtask-progress {
  font-size: 11px;
  color: #7c3aed;
  background: #ede9fe;
  padding: 1px 6px;
  border-radius: 10px;
}

/* ── Task Detail 展开区 ── */
.task-detail {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.detail-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.detail-row label {
  font-size: 11px;
  color: var(--color-secondary);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.detail-row-2col {
  flex-direction: row;
  gap: 12px;
}
.detail-row-2col > div {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.detail-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}
button.danger { color: var(--color-danger, #dc2626); }

/* ── 子任务列表 ── */
.subtask-list { display: flex; flex-direction: column; gap: 4px; }
.subtask-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  padding: 4px 6px;
  border-radius: 4px;
}
.subtask-item:hover { background: #f9fafb; }
.subtask-done > span {
  text-decoration: line-through;
  opacity: 0.5;
}
.subtask-del {
  background: none;
  border: none;
  cursor: pointer;
  color: #ccc;
  margin-left: auto;
  padding: 0 2px;
  font-size: 16px;
  line-height: 1;
}
.subtask-del:hover { color: var(--color-danger); }
.subtask-input-row {
  display: flex;
  gap: 6px;
  align-items: center;
}
.subtask-add-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 12px;
  color: var(--color-secondary);
  padding: 3px 4px;
  text-align: left;
}
.subtask-add-btn:hover { color: var(--color-text); }

/* ── 协作状态 ── */
.collab-status-badge {
  font-size: 11px;
  background: #ecfdf5;
  color: #059669;
  border: 1px solid #6ee7b7;
  padding: 1px 6px;
  border-radius: 8px;
  font-weight: 500;
}

/* ── 收件箱 ── */
.inbox-zone-btns { display: flex; gap: 4px; flex-shrink: 0; }
.inbox-task-card .task-row { flex-wrap: nowrap; }

/* ── 快速添加 ── */
.quick-add-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 6px;
  padding: 8px 10px;
  background: var(--color-bg-secondary, #f9fafb);
  border-radius: 8px;
  border: 1px dashed var(--color-border);
}
.quick-add-row input { flex: 1; }

/* ── 已完成 ── */
.done-toggle-btn {
  background: none;
  border: none;
  font-size: 13px;
  color: var(--color-secondary);
  cursor: pointer;
  padding: 4px 2px;
  font-weight: 600;
}
.done-toggle-btn:hover { color: var(--color-text); }
.done-list { margin-top: 6px; display: flex; flex-direction: column; gap: 4px; }
.done-task-card { opacity: 0.7; }

/* ── 周总结 ── */
.summary-card { padding: 16px; }
.summary-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.summary-title { font-size: 14px; font-weight: 700; }
.summary-label {
  font-size: 11px;
  color: var(--color-secondary);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  margin-bottom: 4px;
}
.summary-completed {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.summary-completed-block {
  padding: 10px 12px;
  background: var(--color-bg-secondary, #f9fafb);
  border-radius: 6px;
}

/* ── 响应式 ── */
@media (max-width: 639px) {
  .week-stats-right { font-size: 12px; gap: 4px; }
  .sep { display: none; }
  .zone-btn { width: 28px; height: 28px; font-size: 14px; }
  .detail-row-2col { flex-direction: column; }
}
</style>
