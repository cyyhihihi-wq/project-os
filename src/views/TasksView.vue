<script setup>
import { ref, computed, watch } from 'vue'
import { useTasksStore } from '../stores/tasks.js'
import { useProjectsStore } from '../stores/projects.js'
import AutoTextarea from '../components/shared/AutoTextarea.vue'
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
  return `${w.monday.getFullYear()}-W${String(w.weekNo).padStart(2, '0')}`
})

// -- Tasks from store --
const tasks = computed(() => tasksStore.items)

// -- Input --
const newTitle = ref('')
const newProjectId = ref('')
const newPriority = ref('')
const showInputOptions = ref(false)

function getFridayOfWeek(info) {
  const friday = new Date(info.monday)
  friday.setDate(friday.getDate() + 4)
  const y = friday.getFullYear()
  const m = String(friday.getMonth() + 1).padStart(2, '0')
  const d = String(friday.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// 默认截止日期 = 当前显示周的周五，切周时同步更新
const newDue = ref(getFridayOfWeek(weekInfo.value))
watch(weekInfo, (info) => {
  newDue.value = getFridayOfWeek(info)
})

function addTask() {
  if (!newTitle.value.trim()) return
  const selectedProject = projectsStore.getById(newProjectId.value)
  tasksStore.add({
    title: newTitle.value.trim(),
    project: selectedProject?.name || '',
    project_id: newProjectId.value || null,
    priority: newPriority.value,
    due: newDue.value,
    week: weekInfo.value.weekNo,
  })
  newTitle.value = ''
  newProjectId.value = ''
  // 创建后重置为当前显示周的周五
  newDue.value = getFridayOfWeek(weekInfo.value)
  showInputOptions.value = false
}

function onTaskProjectChange(task, projectId) {
  const project = projectsStore.getById(projectId)
  tasksStore.update(task.id, {
    project_id: projectId || null,
    project: project?.name || '',
  })
}

// -- Task detail --
const expandedId = ref(null)

function toggle(id) {
  expandedId.value = expandedId.value === id ? null : id
}

function cycleStatus(task) {
  const order = ['todo', 'doing', 'done']
  const idx = order.indexOf(task.status)
  tasksStore.update(task.id, { status: order[(idx + 1) % 3] })
}

function updateTask(task, field, value) {
  tasksStore.update(task.id, { [field]: value })
}

function removeTask(id) {
  tasksStore.remove(id)
  if (expandedId.value === id) expandedId.value = null
}

// -- Grouped tasks --
const todoTasks = computed(() => tasks.value.filter(t => t.status === 'todo'))
const doingTasks = computed(() => tasks.value.filter(t => t.status === 'doing'))
const doneTasks = computed(() => tasks.value.filter(t => t.status === 'done'))

const showDone = ref(false)

const completionRate = computed(() => {
  if (tasks.value.length === 0) return 0
  return Math.round(doneTasks.value.length / tasks.value.length * 100)
})

// -- Week review --
const weekReview = ref('')

watch(weekKey, (key) => {
  weekReview.value = tasksStore.getWeekReview(key)
}, { immediate: true })

function saveWeekReview() {
  tasksStore.saveWeekReview(weekKey.value, weekReview.value)
}

function onWeekReviewChange(val) {
  weekReview.value = val
  saveWeekReview()
}

// -- Format time --
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
    <!-- Week Overview -->
    <div class="card section">
      <div class="flex-between">
        <div class="flex-center gap-16">
          <button class="small" @click="currentWeekOffset--">&lt;</button>
          <div>
            <strong>Week {{ weekInfo.weekNo }}</strong>
            <span class="text-sm text-secondary" style="margin-left:12px">{{ weekInfo.range }}</span>
            <span class="tag primary" style="margin-left:12px">完成率 {{ completionRate }}%</span>
          </div>
          <button class="small" @click="currentWeekOffset++">></button>
        </div>
      </div>
    </div>

    <!-- Task Input -->
    <div class="card section">
      <div class="flex gap-8">
        <input
          type="text"
          v-model="newTitle"
          placeholder="+ 输入任务标题，回车创建"
          @keydown.enter="addTask"
          @focus="showInputOptions = true"
        />
      </div>
      <div v-if="showInputOptions" class="flex gap-12 mt-8">
        <select v-model="newProjectId" style="width:auto;flex:1">
          <option value="">无专项</option>
          <option v-for="p in projectsStore.items" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
        <select v-model="newPriority" style="width:auto;flex:1">
          <option value="">优先级</option>
          <option value="high">高</option>
          <option value="medium">中</option>
          <option value="low">低</option>
        </select>
        <input type="date" v-model="newDue" style="width:auto;flex:1" />
      </div>
    </div>

    <!-- Task List -->
    <div class="section" v-for="group in [
      { key: 'doing', label: '进行中', items: doingTasks },
      { key: 'todo', label: '未开始', items: todoTasks },
      { key: 'done', label: '已完成', items: doneTasks },
    ]" :key="group.key">
      <div class="card-title flex-between" :class="'status-' + group.key">
        <span>{{ group.label }} ({{ group.items.length }})</span>
        <button v-if="group.key === 'done' && group.items.length > 0" class="small" style="font-weight:normal" @click="showDone = !showDone">
          {{ showDone ? '收起' : '展开' }}
        </button>
      </div>
      <div v-if="group.items.length === 0" class="text-sm text-secondary" style="padding:8px 0">
        暂无任务
      </div>
      <template v-if="group.key !== 'done' || showDone">
      <div
        v-for="task in group.items"
        :key="task.id"
        class="card"
        style="cursor:pointer"
      >
        <!-- Task Row -->
        <div class="flex-between" @click="toggle(task.id)">
          <div class="flex-center gap-8">
            <span
              style="width:18px;height:18px;border-radius:50%;border:2px solid;display:inline-flex;align-items:center;justify-content:center;font-size:10px;flex-shrink:0;cursor:pointer"
              :style="{
                borderColor: task.status === 'done' ? 'var(--color-success)' : task.status === 'doing' ? 'var(--color-primary)' : 'var(--color-border)',
                background: task.status === 'done' ? 'var(--color-success)' : 'transparent',
                color: task.status === 'done' ? '#fff' : 'transparent',
              }"
              @click.stop="cycleStatus(task)"
            >&#10003;</span>
            <span :style="{ textDecoration: task.status === 'done' ? 'line-through' : 'none', opacity: task.status === 'done' ? 0.5 : 1 }">
              {{ task.title }}
            </span>
          </div>
          <div class="flex-center gap-8">
            <span v-if="task.project" class="tag">{{ task.project }}</span>
            <span class="text-xs text-secondary">{{ taskTimeLabel(task) }}</span>
          </div>
        </div>

        <!-- Task Detail (expanded) -->
        <div v-if="expandedId === task.id" class="mt-12" style="padding-top:12px;border-top:1px solid var(--color-border)">
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
            <label class="text-xs text-secondary">执行备注</label>
            <AutoTextarea :modelValue="task.note" @update:modelValue="updateTask(task, 'note', $event)" placeholder="记录执行过程...（支持 Markdown）" />
          </div>
          <div class="flex gap-8">
            <button class="small" :class="{ primary: task.status === 'todo' }" @click="updateTask(task, 'status', 'todo')">未开始</button>
            <button class="small" :class="{ primary: task.status === 'doing' }" @click="updateTask(task, 'status', 'doing')">进行中</button>
            <button class="small" :class="{ primary: task.status === 'done' }" @click="updateTask(task, 'status', 'done')">已完成</button>
            <button class="small" style="color:var(--color-danger);margin-left:auto" @click="removeTask(task.id)">删除</button>
          </div>
        </div>
      </div>
      </template>
    </div>

    <!-- Week Review -->
    <div class="card section" style="margin-top:24px">
      <div class="card-title">周回顾</div>
      <RichEditor
        :modelValue="weekReview"
        @update:modelValue="onWeekReviewChange"
      />
    </div>
  </div>
</template>
