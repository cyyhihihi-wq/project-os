<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { useTasksStore } from '../stores/tasks.js'
import { useProjectsStore } from '../stores/projects.js'
import RichEditor from '../components/shared/RichEditor.vue'
import { generateWeekSummary } from '../ai/organizeService.js'

const tasksStore = useTasksStore()
const projectsStore = useProjectsStore()

// -- Week navigation --
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
  return `${w.monday.getFullYear()}-W${String(w.weekNo).padStart(2, '00')}`
})

// -- Tasks --
const tasks = computed(() => tasksStore.items)

// 今天的日期字符串 YYYY-MM-DD，用于今日处理判断
const todayStr = computed(() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})

// 只在查看本周时判断"今日处理"，历史周不显示此标签
function isDueToday(task) {
  return currentWeekOffset.value === 0 &&
    task.status !== 'done' &&
    task.due === todayStr.value
}

// -- Input --
const newTitle = ref('')
const newProjectId = ref('')
const showInputOptions = ref(false)

function getFridayOfWeek(info) {
  const friday = new Date(info.monday)
  friday.setDate(friday.getDate() + 4)
  const y = friday.getFullYear()
  const m = String(friday.getMonth() + 1).padStart(2, '0')
  const d = String(friday.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const newDue = ref(getFridayOfWeek(weekInfo.value))
watch(weekInfo, (info) => { newDue.value = getFridayOfWeek(info) })

function addTask() {
  if (!newTitle.value.trim()) return
  const selectedProject = projectsStore.getById(newProjectId.value)
  tasksStore.add({
    title: newTitle.value.trim(),
    project: selectedProject?.name || '',
    project_id: newProjectId.value || null,
    due: newDue.value,
    week: weekInfo.value.weekNo,
  })
  newTitle.value = ''
  // 重置为当前 tab 对应的项目，而不是清空
  newProjectId.value = activeTab.value === '__none__' ? '' : activeTab.value
  newDue.value = getFridayOfWeek(weekInfo.value)
  showInputOptions.value = false
}

function onTaskProjectChange(task, projectId) {
  const project = projectsStore.getById(projectId)
  tasksStore.update(task.id, { project_id: projectId || null, project: project?.name || '' })
}

// -- Task actions --
const expandedId = ref(null)

function toggle(id) {
  expandedId.value = expandedId.value === id ? null : id
}

function cycleStatus(task) {
  const next = task.status === 'done' ? 'doing' : 'done'
  const changes = { status: next }
  // 顺延任务完成时归属到当前周
  if (next === 'done' && carriedTasks.value.some(t => t.id === task.id)) {
    changes.week = weekInfo.value.weekNo
  }
  tasksStore.update(task.id, changes)
}

function updateTask(task, field, value) {
  const changes = { [field]: value }
  // 顺延任务完成时归属到当前周
  if (field === 'status' && value === 'done' && carriedTasks.value.some(t => t.id === task.id)) {
    changes.week = weekInfo.value.weekNo
  }
  tasksStore.update(task.id, changes)
}

function removeTask(id) {
  tasksStore.remove(id)
  if (expandedId.value === id) expandedId.value = null
}

// -- Tab 分组 --

/**
 * 任务的规范 tab ID：
 * 1. project_id 存在且在 store 中有效 → 用 project_id
 * 2. project_id 无效（stale/null）但 project name 能解析到现有项目 → 用该项目 id
 * 3. 均不匹配 → '__none__'
 * 保证同名项目不会产生多个 tab。
 */
function taskTabId(task) {
  if (task.project_id && projectsStore.getById(task.project_id)) return task.project_id
  if (task.project) {
    const p = projectsStore.items.find(p => p.name === task.project)
    if (p) return p.id
  }
  return '__none__'
}

const projectTabs = computed(() => {
  const seenIds = new Set()
  const tabs = []
  let hasNone = false

  for (const t of tasks.value) {
    const tid = taskTabId(t)
    if (tid === '__none__') { hasNone = true; continue }
    if (!seenIds.has(tid)) {
      seenIds.add(tid)
      const p = projectsStore.getById(tid)
      if (p) tabs.push({ id: tid, name: p.name })
    }
  }

  tabs.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  // 无专项排第一（固定入口）
  if (hasNone) tabs.unshift({ id: '__none__', name: '无专项' })
  return tabs
})

const activeTab = ref('__none__')

// tabs 变化时保持 activeTab 有效
watch(projectTabs, (tabs) => {
  if (tabs.length > 0 && !tabs.find(t => t.id === activeTab.value)) {
    activeTab.value = tabs[0].id
  }
}, { immediate: true })

// activeTab 切换时同步 newProjectId（默认专项跟随当前 tab）
watch(activeTab, (tabId) => {
  newProjectId.value = tabId === '__none__' ? '' : tabId
}, { immediate: true })

// -- 跨周顺延（虚拟，不改数据）--

/**
 * 上一周及更早的未完成任务，仅在查看当前周时显示（顺延）。
 * 条件：week < 当前周 且 status !== done。
 * due 只是时间提示，不影响任务归属于哪个周面板。
 * 完成时会将 week 更新为当前周，之后自然归入本周统计。
 */
const carriedTasks = computed(() => {
  if (currentWeekOffset.value !== 0) return []
  const { monday } = weekInfo.value
  const curYear = monday.getFullYear()
  const curWeekNo = weekInfo.value.weekNo
  return tasks.value.filter(t => {
    if (t.status === 'done') return false
    const taskYear = new Date(t.created_at).getFullYear()
    return taskYear < curYear || (taskYear === curYear && t.week < curWeekNo)
  })
})

const carriedSet = computed(() => new Set(carriedTasks.value.map(t => t.id)))

// -- Week stats --
const weekTasks = computed(() => {
  const weekNo = weekInfo.value.weekNo
  const year = weekInfo.value.monday.getFullYear()
  const ownTasks = tasks.value.filter(t =>
    t.week === weekNo && new Date(t.created_at).getFullYear() === year
  )
  // 当前周统计计入顺延任务（上周未完成的工作量）
  return currentWeekOffset.value === 0 ? [...ownTasks, ...carriedTasks.value] : ownTasks
})

const weekDoneCount = computed(() =>
  weekTasks.value.filter(t => t.status === 'done').length
)

const weekCompletionRate = computed(() => {
  if (weekTasks.value.length === 0) return 0
  return Math.round(weekDoneCount.value / weekTasks.value.length * 100)
})

const weekProjectUpdates = computed(() => {
  const { monday, sunday } = weekInfo.value
  const endOfSunday = new Date(sunday)
  endOfSunday.setHours(23, 59, 59, 999)
  let count = 0
  for (const p of projectsStore.items) {
    for (const u of (p.updates || [])) {
      const d = new Date(u.created_at)
      if (d >= monday && d <= endOfSunday) count++
    }
  }
  return count
})

// 通用排序：今日处理排最前，其余按 due 升序，无 due 排最后
function sortByDueToday(list) {
  const today = todayStr.value
  return [...list].sort((a, b) => {
    const aToday = a.due === today ? 0 : 1
    const bToday = b.due === today ? 0 : 1
    if (aToday !== bToday) return aToday - bToday
    if (!a.due && !b.due) return 0
    if (!a.due) return 1
    if (!b.due) return -1
    return a.due.localeCompare(b.due)
  })
}

// -- Tab 任务列表 --
// 当前 tab 的顺延任务（仅当前周，今日处理排最前）
const tabCarriedTasks = computed(() =>
  sortByDueToday(carriedTasks.value.filter(t => taskTabId(t) === activeTab.value))
)

// 当前 tab 的本周进行中任务
// - 严格过滤 week === 当前视图周，避免跨周串台
// - 顺延任务单独展示，从此列表排除
// - 今日处理排最前
const tabActiveTasks = computed(() => {
  const weekNo = weekInfo.value.weekNo
  const year = weekInfo.value.monday.getFullYear()
  const list = tasks.value.filter(t =>
    taskTabId(t) === activeTab.value &&
    t.status !== 'done' &&
    t.week === weekNo &&
    new Date(t.created_at).getFullYear() === year &&
    !carriedSet.value.has(t.id)
  )
  return sortByDueToday(list)
})

// 当前 tab 本周已完成任务（仅当前视图周，不跨周）
const tabDoneTasks = computed(() => {
  const weekNo = weekInfo.value.weekNo
  const year = weekInfo.value.monday.getFullYear()
  return tasks.value.filter(t =>
    taskTabId(t) === activeTab.value &&
    t.status === 'done' &&
    t.week === weekNo &&
    new Date(t.created_at).getFullYear() === year
  )
})

const showDone = ref(false)

// -- 本周工作总结 --
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
    // 本周专项进展
    const { monday, sunday } = weekInfo.value
    const endOfSunday = new Date(sunday)
    endOfSunday.setHours(23, 59, 59, 999)
    const projectUpdates = []
    for (const p of projectsStore.items) {
      for (const u of (p.updates || [])) {
        const d = new Date(u.created_at)
        if (d >= monday && d <= endOfSunday) {
          projectUpdates.push({ ...u, projectName: p.name })
        }
      }
    }
    // 本周已完成任务
    const weekNo = weekInfo.value.weekNo
    const year = weekInfo.value.monday.getFullYear()
    const completedTasks = tasks.value.filter(t =>
      t.status === 'done' &&
      t.week === weekNo &&
      new Date(t.created_at).getFullYear() === year
    )
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

// -- Format --
function fmtTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
function fmtDue(dateStr) {
  if (!dateStr) return ''
  const [, m, d] = dateStr.split('-')
  return `${+m}/${+d}`
}
function taskTimeLabel(task) {
  if (task.status === 'done') return fmtTime(task.completed_at)
  return fmtDue(task.due)
}
</script>

<template>
  <div class="page">

    <!-- Week Header + Stats + Progress Bar -->
    <div class="card section">
      <div class="flex-between mb-10">
        <div class="flex-center gap-12">
          <button class="small" @click="currentWeekOffset--">&lt;</button>
          <div>
            <strong>Week {{ weekInfo.weekNo }}</strong>
            <span class="text-sm text-secondary" style="margin-left:10px">{{ weekInfo.range }}</span>
          </div>
          <button class="small" @click="currentWeekOffset++">&gt;</button>
        </div>
        <div class="week-stats-right">
          <span>本周完成 <strong>{{ weekDoneCount }}</strong> 任务</span>
          <span class="sep">·</span>
          <span>项目推进 <strong>{{ weekProjectUpdates }}</strong> 条</span>
        </div>
      </div>
      <div class="progress-track">
        <div
          class="progress-fill"
          :style="{
            width: weekCompletionRate + '%',
            background: weekCompletionRate === 100 ? 'var(--color-success)' : 'var(--color-primary)',
          }"
        ></div>
      </div>
      <div class="text-xs text-secondary" style="margin-top:5px">
        完成率 <strong>{{ weekCompletionRate }}%</strong>
        <span style="margin-left:6px">本周 {{ weekTasks.length }} 个任务</span>
      </div>
    </div>

    <!-- Task Input -->
    <div class="card section">
      <input
        type="text"
        v-model="newTitle"
        placeholder="+ 输入任务标题，回车创建"
        @keydown.enter="addTask"
        @focus="showInputOptions = true"
      />
      <div v-if="showInputOptions" class="flex task-input-row gap-12 mt-8">
        <select v-model="newProjectId" style="flex:1">
          <option value="">无专项</option>
          <option v-for="p in projectsStore.items" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
        <input type="date" v-model="newDue" style="flex:1" />
      </div>
    </div>

    <!-- Project Tabs -->
    <div v-if="projectTabs.length > 0" class="tabs-bar section">
      <button
        v-for="tab in projectTabs"
        :key="tab.id"
        class="tab-btn"
        :class="{ active: tab.id === activeTab }"
        @click="activeTab = tab.id; showDone = false"
      >
        {{ tab.name }}
      </button>
    </div>

    <!-- Task list for active tab -->
    <div v-if="projectTabs.length > 0" class="section">

      <!-- 顺延任务（真正超期未完成，仅当前周显示） -->
      <template v-if="tabCarriedTasks.length > 0">
        <div class="group-status-label group-carried-label">上周顺延 ({{ tabCarriedTasks.length }})</div>
        <div
          v-for="task in tabCarriedTasks"
          :key="task.id"
          class="card task-card task-carried-card"
          :class="{ 'task-due-today-card': isDueToday(task) }"
        >
          <div class="flex-between" @click="toggle(task.id)" style="cursor:pointer">
            <div class="flex-center gap-8">
              <span class="task-circle circle-doing" @click.stop="cycleStatus(task)"></span>
              <span>{{ task.title }}</span>
              <span v-if="isDueToday(task)" class="badge-today">今日处理</span>
            </div>
            <span class="text-xs text-secondary">{{ taskTimeLabel(task) }}</span>
          </div>
          <div v-if="expandedId === task.id" class="task-detail">
            <div class="mb-8">
              <label class="text-xs text-secondary">标题</label>
              <input type="text" :value="task.title" @change="updateTask(task, 'title', $event.target.value)" />
            </div>
            <div class="flex gap-12 mb-8">
              <div style="flex:1">
                <label class="text-xs text-secondary">所属专项</label>
                <select :value="task.project_id || ''" @change="onTaskProjectChange(task, $event.target.value)">
                  <option value="">无</option>
                  <option v-for="p in projectsStore.items" :key="p.id" :value="p.id">{{ p.name }}</option>
                </select>
              </div>
              <div style="flex:1">
                <label class="text-xs text-secondary">截止时间</label>
                <input type="date" :value="task.due" @change="updateTask(task, 'due', $event.target.value)" />
              </div>
            </div>
            <div class="mb-8">
              <label class="text-xs text-secondary">执行备注 & 子步骤</label>
              <RichEditor :modelValue="task.note" @update:modelValue="updateTask(task, 'note', $event)" />
            </div>
            <div class="flex gap-8">
              <button class="small primary" @click="updateTask(task, 'status', 'done')">标为完成（归入本周）</button>
              <button class="small" style="color:var(--color-danger);margin-left:auto" @click="removeTask(task.id)">删除</button>
            </div>
          </div>
        </div>
      </template>

      <!-- Doing tasks -->
      <template v-if="tabActiveTasks.length > 0">
        <div class="group-status-label">进行中 ({{ tabActiveTasks.length }})</div>
        <div
          v-for="task in tabActiveTasks"
          :key="task.id"
          class="card task-card"
          :class="{ 'task-due-today-card': isDueToday(task) }"
        >
          <div class="flex-between" @click="toggle(task.id)" style="cursor:pointer">
            <div class="flex-center gap-8">
              <span
                class="task-circle circle-doing"
                @click.stop="cycleStatus(task)"
              ></span>
              <span>{{ task.title }}</span>
              <span v-if="isDueToday(task)" class="badge-today">今日处理</span>
            </div>
            <span class="text-xs text-secondary">{{ taskTimeLabel(task) }}</span>
          </div>
          <div v-if="expandedId === task.id" class="task-detail">
            <div class="mb-8">
              <label class="text-xs text-secondary">标题</label>
              <input type="text" :value="task.title" @change="updateTask(task, 'title', $event.target.value)" />
            </div>
            <div class="flex gap-12 mb-8">
              <div style="flex:1">
                <label class="text-xs text-secondary">所属专项</label>
                <select :value="task.project_id || ''" @change="onTaskProjectChange(task, $event.target.value)">
                  <option value="">无</option>
                  <option v-for="p in projectsStore.items" :key="p.id" :value="p.id">{{ p.name }}</option>
                </select>
              </div>
              <div style="flex:1">
                <label class="text-xs text-secondary">截止时间</label>
                <input type="date" :value="task.due" @change="updateTask(task, 'due', $event.target.value)" />
              </div>
            </div>
            <div class="mb-8">
              <label class="text-xs text-secondary">执行备注 & 子步骤</label>
              <RichEditor :modelValue="task.note" @update:modelValue="updateTask(task, 'note', $event)" />
            </div>
            <div class="flex gap-8">
              <button class="small primary" @click="updateTask(task, 'status', 'doing')">进行中</button>
              <button class="small" @click="updateTask(task, 'status', 'done')">已完成</button>
              <button class="small" style="color:var(--color-danger);margin-left:auto" @click="removeTask(task.id)">删除</button>
            </div>
          </div>
        </div>
      </template>

      <!-- Done tasks with expand/collapse -->
      <template v-if="tabDoneTasks.length > 0">
        <div class="group-status-label group-done-label flex-between">
          <span>已完成 ({{ tabDoneTasks.length }})</span>
          <button class="small" style="font-weight:normal" @click="showDone = !showDone">
            {{ showDone ? '收起' : '展开' }}
          </button>
        </div>
        <template v-if="showDone">
          <div v-for="task in tabDoneTasks" :key="task.id" class="card task-card task-done-card">
            <div class="flex-between" @click="toggle(task.id)" style="cursor:pointer">
              <div class="flex-center gap-8">
                <span class="task-circle circle-done" @click.stop="cycleStatus(task)">&#10003;</span>
                <span style="text-decoration:line-through;opacity:0.45">{{ task.title }}</span>
              </div>
              <span class="text-xs" style="color:var(--color-success)">{{ taskTimeLabel(task) }}</span>
            </div>
            <div v-if="expandedId === task.id" class="task-detail">
              <div class="mb-8">
                <label class="text-xs text-secondary">标题</label>
                <input type="text" :value="task.title" @change="updateTask(task, 'title', $event.target.value)" />
              </div>
              <div class="flex gap-12 mb-8">
                <div style="flex:1">
                  <label class="text-xs text-secondary">所属专项</label>
                  <select :value="task.project_id || ''" @change="onTaskProjectChange(task, $event.target.value)">
                    <option value="">无</option>
                    <option v-for="p in projectsStore.items" :key="p.id" :value="p.id">{{ p.name }}</option>
                  </select>
                </div>
                <div style="flex:1">
                  <label class="text-xs text-secondary">截止时间</label>
                  <input type="date" :value="task.due" @change="updateTask(task, 'due', $event.target.value)" />
                </div>
              </div>
              <div class="mb-8">
                <label class="text-xs text-secondary">执行备注 & 子步骤</label>
                <RichEditor :modelValue="task.note" @update:modelValue="updateTask(task, 'note', $event)" />
              </div>
              <div class="flex gap-8">
                <button class="small" @click="updateTask(task, 'status', 'doing')">进行中</button>
                <button class="small primary" @click="updateTask(task, 'status', 'done')">已完成</button>
                <button class="small" style="color:var(--color-danger);margin-left:auto" @click="removeTask(task.id)">删除</button>
              </div>
            </div>
          </div>
        </template>
      </template>

      <div
        v-if="tabActiveTasks.length === 0 && tabDoneTasks.length === 0 && tabCarriedTasks.length === 0"
        class="text-secondary text-sm"
        style="padding:16px 0;text-align:center"
      >
        暂无任务
      </div>
    </div>

    <div v-else class="text-secondary text-sm section" style="padding:16px 0;text-align:center">
      暂无任务，请在上方输入框创建
    </div>

    <!-- 本周工作总结 -->
    <div
      class="card section summary-card"
      :class="{ 'summary-completed-card': weekSummary.status === 'completed' }"
      style="margin-top:24px"
    >
      <!-- 标题行 -->
      <div class="flex-between mb-10">
        <div class="card-title" style="margin:0">
          <span v-if="weekSummary.status === 'completed'">本周总结已完成！真棒！</span>
          <span v-else>本周工作总结</span>
        </div>
        <div class="flex gap-8">
          <button class="small" @click="genWeekSummary" :disabled="summaryLoading">
            {{ summaryLoading ? 'AI 生成中...' : '生成本周工作总结' }}
          </button>
          <button
            v-if="weekSummary.status !== 'completed'"
            class="small primary"
            @click="completeWeekSummary"
          >完成本周总结</button>
          <button v-else class="small" @click="reopenWeekSummary">重新编辑</button>
        </div>
      </div>

      <div v-if="summaryError" class="text-xs mb-8" style="color:var(--color-danger);background:#fff0f0;border:1px solid var(--color-danger);border-radius:4px;padding:6px 10px">{{ summaryError }}</div>

      <!-- 工作区 -->
      <div class="summary-row">
        <span class="summary-label">工作</span>
        <textarea
          ref="summaryWorkRef"
          class="summary-textarea"
          rows="3"
          placeholder="点击「生成本周工作总结」或直接编辑..."
          :value="weekSummary.work"
          @input="onSummaryWorkInput"
        />
      </div>

      <div class="summary-sep"></div>

      <!-- 感受区 -->
      <div class="summary-row">
        <span class="summary-label">感受</span>
        <textarea
          ref="summaryFeelingRef"
          class="summary-textarea"
          rows="2"
          placeholder="这周感受如何..."
          :value="weekSummary.feeling"
          @input="onSummaryFeelingInput"
        />
      </div>
    </div>

  </div>
</template>

<style scoped>
/* Week stats */
.mb-10 { margin-bottom: 10px; }
.week-stats-right {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--color-secondary, #666);
}
.week-stats-right strong { color: var(--color-text, #1a1a1a); }
.sep { opacity: 0.4; }

/* Progress bar */
.progress-track {
  height: 6px;
  background: var(--color-border);
  border-radius: 3px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.4s ease;
  min-width: 0;
}

/* Tabs */
.tabs-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 0;
}
.tab-btn {
  padding: 6px 14px;
  border-radius: 8px;
  border: none;
  background: #f0f2f7;
  color: var(--color-text, #333);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  font-weight: 500;
}
.tab-btn:hover {
  background: #e2e6f0;
}
.tab-btn.active {
  background: var(--color-primary, #3b82f6);
  color: #fff;
}

/* Status labels */
.group-status-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-secondary, #888);
  text-transform: uppercase;
  letter-spacing: 0.6px;
  padding: 6px 0 3px;
}
.group-done-label {
  color: var(--color-success, #388e3c);
}
.group-carried-label {
  color: var(--color-warning, #d97706);
}

/* Task cards */
.task-card { cursor: pointer; }
.task-done-card {
  background: #f8fdf8;
  border-color: #d4ecd4;
}
.task-carried-card {
  background: #fffbf0;
  border-color: #fde68a;
}
.task-detail {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--color-border);
}

/* 本周工作总结卡片 */
.summary-completed-card {
  background: #FFF7CC !important;
  border-color: #E6C800 !important;
}
.summary-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.summary-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-secondary, #888);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding-top: 6px;
  flex-shrink: 0;
  width: 28px;
}
.summary-textarea {
  flex: 1;
  resize: none;
  border: none;
  background: transparent;
  font-size: 13px;
  line-height: 1.7;
  padding: 4px 0;
  color: var(--color-text);
  font-family: inherit;
  overflow: hidden;
  outline: none;
  min-height: 0;
}
.summary-textarea:focus {
  outline: none;
}
.summary-textarea::placeholder {
  color: var(--color-secondary, #aaa);
}
.summary-sep {
  height: 1px;
  background: var(--color-border);
  margin: 8px 0;
}

/* Today due badge */
.badge-today {
  font-size: 10px;
  font-weight: 600;
  color: #1d4ed8;
  background: #dbeafe;
  border-radius: 4px;
  padding: 1px 6px;
  letter-spacing: 0.3px;
  vertical-align: middle;
  flex-shrink: 0;
}
.task-due-today-card {
  border-color: #93c5fd !important;
  background: #f0f7ff !important;
}

/* Status circles */
.task-circle {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  cursor: pointer;
}
.circle-doing {
  background: transparent;
  border: 2px solid #3b82f6;
}
.circle-done {
  background: transparent;
  color: #10b981;
  font-size: 15px;
  line-height: 1;
}

/* ── 手机端响应式 ── */
@media (max-width: 639px) {
  /* 周统计右侧：换行显示 */
  .week-stats-right {
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 2px 6px;
    font-size: 12px;
  }
  .sep {
    display: none;
  }
  /* 任务输入区 project + date 选择器竖排 */
  .task-input-row {
    flex-direction: column;
    gap: 8px;
  }
}
</style>
