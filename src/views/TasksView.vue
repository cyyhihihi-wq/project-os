<script setup>
import { ref, computed, watch } from 'vue'
import { useTasksStore } from '../stores/tasks.js'
import { useProjectsStore } from '../stores/projects.js'
import RichEditor from '../components/shared/RichEditor.vue'

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
  newProjectId.value = ''
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

// 只有两个状态: doing <-> done
function cycleStatus(task) {
  const next = task.status === 'done' ? 'doing' : 'done'
  tasksStore.update(task.id, { status: next })
}

function updateTask(task, field, value) {
  tasksStore.update(task.id, { [field]: value })
}

function removeTask(id) {
  tasksStore.remove(id)
  if (expandedId.value === id) expandedId.value = null
}

// -- Week stats --
const weekTasks = computed(() => {
  const weekNo = weekInfo.value.weekNo
  const year = weekInfo.value.monday.getFullYear()
  return tasks.value.filter(t =>
    t.week === weekNo && new Date(t.created_at).getFullYear() === year
  )
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

// -- Tab 分组 --
// 构建 tab 列表：所有有任务的 project + 无专项
const projectTabs = computed(() => {
  const map = new Map()
  for (const t of tasks.value) {
    const key = t.project_id || '__none__'
    if (!map.has(key)) {
      if (t.project_id) {
        const p = projectsStore.getById(t.project_id)
        map.set(key, { id: key, name: p?.name || t.project || '无专项' })
      } else {
        map.set('__none__', { id: '__none__', name: '无专项' })
      }
    }
  }
  const tabs = [...map.values()]
  // 具名专项排前，无专项排末
  tabs.sort((a, b) => {
    if (a.id === '__none__') return 1
    if (b.id === '__none__') return -1
    return a.name.localeCompare(b.name, 'zh')
  })
  return tabs
})

const activeTab = ref('__none__')
// 当 tabs 变化时，确保 activeTab 有效
watch(projectTabs, (tabs) => {
  if (tabs.length > 0 && !tabs.find(t => t.id === activeTab.value)) {
    activeTab.value = tabs[0].id
  }
}, { immediate: true })

// 当前 tab 下的任务，分 active(doing) 和 done
const tabActiveTasks = computed(() =>
  tasks.value.filter(t => {
    const key = t.project_id || '__none__'
    return key === activeTab.value && t.status !== 'done'
  })
)
const tabDoneTasks = computed(() =>
  tasks.value.filter(t => {
    const key = t.project_id || '__none__'
    return key === activeTab.value && t.status === 'done'
  })
)

const showDone = ref(false)

// -- Week review --
const weekReview = ref('')
watch(weekKey, (key) => { weekReview.value = tasksStore.getWeekReview(key) }, { immediate: true })
function onWeekReviewChange(val) {
  weekReview.value = val
  tasksStore.saveWeekReview(weekKey.value, val)
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
      <div v-if="showInputOptions" class="flex gap-12 mt-8">
        <select v-model="newProjectId" style="width:auto;flex:1">
          <option value="">无专项</option>
          <option v-for="p in projectsStore.items" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
        <input type="date" v-model="newDue" style="width:auto;flex:1" />
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

      <!-- Doing tasks -->
      <template v-if="tabActiveTasks.length > 0">
        <div class="group-status-label">进行中 ({{ tabActiveTasks.length }})</div>
        <div v-for="task in tabActiveTasks" :key="task.id" class="card task-card">
          <div class="flex-between" @click="toggle(task.id)" style="cursor:pointer">
            <div class="flex-center gap-8">
              <span
                class="task-circle circle-doing"
                @click.stop="cycleStatus(task)"
              ></span>
              <span>{{ task.title }}</span>
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

      <div v-if="tabActiveTasks.length === 0 && tabDoneTasks.length === 0" class="text-secondary text-sm" style="padding:16px 0;text-align:center">
        暂无任务
      </div>
    </div>

    <div v-else class="text-secondary text-sm section" style="padding:16px 0;text-align:center">
      暂无任务，请在上方输入框创建
    </div>

    <!-- Week Review -->
    <div class="card section" style="margin-top:24px">
      <div class="card-title">周回顾</div>
      <RichEditor :modelValue="weekReview" @update:modelValue="onWeekReviewChange" />
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

/* Status label */
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

/* Task cards */
.task-card { cursor: pointer; }
.task-done-card {
  background: #f8fdf8;
  border-color: #d4ecd4;
}
.task-detail {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--color-border);
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
</style>
