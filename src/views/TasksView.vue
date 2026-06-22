<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { useTasksStore } from '../stores/tasks.js'
import { useProjectsStore } from '../stores/projects.js'
import { useContactsStore, CONTACT_CATEGORIES } from '../stores/contacts.js'
import RichEditor from '../components/shared/RichEditor.vue'
import { generateWeekSummary } from '../ai/organizeService.js'

const tasksStore = useTasksStore()
const projectsStore = useProjectsStore()
const contactsStore = useContactsStore()

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

// 今天的日期字符串 YYYY-MM-DD
const todayStr = computed(() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})

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
watch(weekInfo, (info) => {
  if (activeTab.value !== '__today__') newDue.value = getFridayOfWeek(info)
})

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
  if (activeTab.value === '__today__') {
    newProjectId.value = ''
    newDue.value = todayStr.value
  } else {
    newProjectId.value = activeTab.value
    newDue.value = getFridayOfWeek(weekInfo.value)
  }
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
  // 打开新卡片时关闭移交表单
  if (expandedId.value !== id) {
    if (handoffFormTaskId.value === id) handoffFormTaskId.value = null
  }
}

function cycleStatus(task) {
  if (task.status === 'waiting') return // waiting 状态需走验收流程
  const next = task.status === 'done' ? 'doing' : 'done'
  const changes = { status: next }
  if (next === 'done' && carriedTasks.value.some(t => t.id === task.id)) {
    changes.week = weekInfo.value.weekNo
  }
  tasksStore.update(task.id, changes)
}

function updateTask(task, field, value) {
  const changes = { [field]: value }
  if (field === 'status' && value === 'done' && carriedTasks.value.some(t => t.id === task.id)) {
    changes.week = weekInfo.value.weekNo
  }
  tasksStore.update(task.id, changes)
}

function removeTask(id) {
  tasksStore.remove(id)
  if (expandedId.value === id) expandedId.value = null
  if (handoffFormTaskId.value === id) handoffFormTaskId.value = null
  if (reviewFormKey.value?.taskId === id) reviewFormKey.value = null
}

// -- Tab 分组 --
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

  for (const t of tasks.value) {
    const tid = taskTabId(t)
    if (tid === '__none__') continue
    if (!seenIds.has(tid)) {
      seenIds.add(tid)
      const p = projectsStore.getById(tid)
      // 已完成的专项不再展示独立 Tab
      if (p && p.status !== 'completed') tabs.push({ id: tid, name: p.name })
    }
  }

  tabs.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  tabs.unshift({ id: '__today__', name: '今日 Todo' })
  return tabs
})

const activeTab = ref('__today__')

watch(projectTabs, (tabs) => {
  if (tabs.length > 0 && !tabs.find(t => t.id === activeTab.value)) {
    activeTab.value = tabs[0].id
  }
}, { immediate: true })

watch(activeTab, (tabId) => {
  if (tabId === '__today__') {
    newProjectId.value = ''
    newDue.value = todayStr.value
  } else {
    newProjectId.value = tabId
    newDue.value = getFridayOfWeek(weekInfo.value)
  }
}, { immediate: true })

// -- 跨周顺延 --
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
const tabCarriedTasks = computed(() =>
  sortByDueToday(carriedTasks.value.filter(t => taskTabId(t) === activeTab.value))
)

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

const showDone = ref(true)

// -- 今日 Todo tab --
// 判断任务所属专项是否已完成
function isProjectCompleted(task) {
  const tid = taskTabId(task)
  if (tid === '__none__') return false
  const p = projectsStore.getById(tid)
  return p?.status === 'completed'
}

// 今日截止任务（用于激励横幅统计），排除已完成专项下的任务
const todayTabTasksDue = computed(() =>
  tasks.value.filter(t => t.due === todayStr.value && !isProjectCompleted(t))
)

// 今日待验收：status=waiting 且最新 pending handoff 的 due <= today，排除已完成专项
const todayTabWaiting = computed(() =>
  tasks.value.filter(t => {
    if (t.status !== 'waiting') return false
    if (isProjectCompleted(t)) return false
    const pending = getPendingHandoff(t)
    return pending && pending.due && pending.due <= todayStr.value
  })
)

const todayTabActive = computed(() =>
  [...todayTabTasksDue.value.filter(t => t.status !== 'done' && t.status !== 'waiting')]
    .sort((a, b) => {
      const aC = carriedSet.value.has(a.id) ? 0 : 1
      const bC = carriedSet.value.has(b.id) ? 0 : 1
      return aC - bC
    })
)
const todayTabDone = computed(() =>
  todayTabTasksDue.value.filter(t => t.status === 'done')
)

// 激励横幅计算（只基于 due === today 的任务）
const todayMotivation = computed(() => {
  const total = todayTabTasksDue.value.length
  const done = todayTabDone.value.length
  const remaining = todayTabActive.value.length
  const waiting = todayTabTasksDue.value.filter(t => t.status === 'waiting').length
  if (total === 0) return '今日暂无任务安排，享受轻松时光'
  if (remaining === 0 && waiting === 0) return `今日 ${total} 件任务全部完成！辛苦了，好好休息`
  if (done === 0) return `今日工作 ${total} 件，加油，逐个击破！`
  return `今日工作 ${total} 件，已完成 ${done} 件，还有 ${remaining} 件就收工啦！`
})

// -- 接力任务：状态 --

/** 获取任务的第一条 pending handoff */
function getPendingHandoff(task) {
  return task.handoffs?.find(h => h.status === 'pending') || null
}

/** 获取任务已完成/取消的 handoff 历史（按时间正序） */
function getDoneHandoffs(task) {
  return (task.handoffs || []).filter(h => h.status === 'done').sort(
    (a, b) => new Date(a.created_at) - new Date(b.created_at)
  )
}

// 移交表单状态
const handoffFormTaskId = ref(null)
const handoffDraft = ref({ assignee: '', assignee_category: '', due: '', hand_note: '' })
const contactQuery = ref('')

const contactSuggestions = computed(() => {
  if (!contactQuery.value.trim()) return []
  return contactsStore.suggest(contactQuery.value)
})

// 验收表单状态
const reviewFormKey = ref(null) // { taskId, handoffId }
const reviewDraft = ref({ completion_note: '', link_project: false, project_id: '', next_action: 'doing' })

function openHandoffForm(taskId) {
  handoffFormTaskId.value = taskId
  reviewFormKey.value = null
  // 默认 due = 3 天后
  const d = new Date()
  d.setDate(d.getDate() + 3)
  handoffDraft.value = {
    assignee: '',
    assignee_category: '',
    due: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    hand_note: '',
  }
  contactQuery.value = ''
}

function onAssigneeInput(val) {
  handoffDraft.value.assignee = val
  contactQuery.value = val
  // 自动填充职能
  const contact = contactsStore.findByName(val)
  if (contact?.category) handoffDraft.value.assignee_category = contact.category
}

function selectContact(contact) {
  handoffDraft.value.assignee = contact.name
  handoffDraft.value.assignee_category = contact.category || ''
  contactQuery.value = ''
}

function submitHandoff(taskId) {
  if (!handoffDraft.value.assignee.trim()) return
  // 保存/更新联系人
  contactsStore.findOrCreate(handoffDraft.value.assignee, handoffDraft.value.assignee_category)
  tasksStore.addHandoff(taskId, { ...handoffDraft.value })
  handoffFormTaskId.value = null
}

function openReviewForm(taskId, handoffId) {
  reviewFormKey.value = { taskId, handoffId }
  reviewDraft.value = { completion_note: '', link_project: false, project_id: '', next_action: 'doing' }
  handoffFormTaskId.value = null
}

function submitReview() {
  if (!reviewFormKey.value) return
  const { taskId, handoffId } = reviewFormKey.value

  let linked_update_id = null
  let linked_project_id = null

  if (reviewDraft.value.link_project && reviewDraft.value.project_id) {
    const task = tasks.value.find(t => t.id === taskId)
    const handoff = task?.handoffs?.find(h => h.id === handoffId)
    linked_project_id = reviewDraft.value.project_id

    const contentParts = []
    if (handoff?.hand_note) contentParts.push(`<p><strong>移交说明：</strong>${handoff.hand_note}</p>`)
    if (reviewDraft.value.completion_note) contentParts.push(`<p><strong>验收说明：</strong>${reviewDraft.value.completion_note}</p>`)
    if (handoff?.assignee) {
      const catStr = handoff.assignee_category ? `（${handoff.assignee_category}）` : ''
      contentParts.push(`<p><strong>承接方：</strong>${handoff.assignee}${catStr}</p>`)
    }

    const update = projectsStore.addProjectUpdate(linked_project_id, {
      title: `${task?.title || '任务'} · 移交验收`,
      content: contentParts.join('') || '<p>（无说明）</p>',
    })
    linked_update_id = update?.id || null
  }

  const nextAction = reviewDraft.value.next_action
  tasksStore.completeHandoff(taskId, handoffId, {
    completion_note: reviewDraft.value.completion_note,
    linked_project_id,
    linked_update_id,
    next_action: nextAction,
  })

  reviewFormKey.value = null

  // 再次移交：立即打开移交表单
  if (nextAction === 'handoff') {
    expandedId.value = taskId
    openHandoffForm(taskId)
  }
}

function cancelWaiting(taskId) {
  tasksStore.cancelWaiting(taskId)
}

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

// -- 完成时间辅助 --
function toDatetimeLocal(isoStr) {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function weekNoFromDate(isoStr) {
  if (!isoStr) return weekInfo.value.weekNo
  const date = new Date(isoStr)
  const day = date.getDay()
  const diff = date.getDate() - day + (day === 0 ? -6 : 1)
  const monday = new Date(date)
  monday.setDate(diff)
  const yearStart = new Date(monday.getFullYear(), 0, 1)
  return Math.ceil(((monday - yearStart) / 86400000 + yearStart.getDay() + 1) / 7)
}

function changeCompletedAt(task, datetimeLocalValue) {
  if (!datetimeLocalValue) return
  const iso = new Date(datetimeLocalValue).toISOString()
  tasksStore.update(task.id, { completed_at: iso, week: weekNoFromDate(iso) })
}

// -- 联系人管理面板 --
const showContacts = ref(false)
const newContactName = ref('')
const newContactCategory = ref('')
const editingContactId = ref(null)
const editContactName = ref('')
const editContactCategory = ref('')

function addContact() {
  if (!newContactName.value.trim()) return
  contactsStore.findOrCreate(newContactName.value.trim(), newContactCategory.value)
  newContactName.value = ''
  newContactCategory.value = ''
}

function startEditContact(c) {
  editingContactId.value = c.id
  editContactName.value = c.name
  editContactCategory.value = c.category
}

function saveEditContact() {
  if (!editContactName.value.trim()) return
  contactsStore.update(editingContactId.value, {
    name: editContactName.value.trim(),
    category: editContactCategory.value,
  })
  editingContactId.value = null
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
function fmtDateShort(isoOrDate) {
  if (!isoOrDate) return ''
  const d = new Date(isoOrDate)
  return `${d.getMonth() + 1}/${d.getDate()}`
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
        @click="activeTab = tab.id"
      >
        {{ tab.name }}
      </button>
    </div>

    <!-- Task list for active tab -->
    <div v-if="projectTabs.length > 0" class="section">

      <!-- ══ 今日 Todo 视图 ══ -->
      <template v-if="activeTab === '__today__'">

        <!-- 激励横幅 -->
        <div
          class="today-banner"
          :class="{
            'today-banner-empty': todayTabTasksDue.length === 0 && todayTabWaiting.length === 0,
            'today-banner-done': todayTabActive.length === 0 && todayTabTasksDue.length > 0,
            'today-banner-progress': todayTabActive.length > 0,
          }"
        >{{ todayMotivation }}</div>

        <!-- 待验收提醒 -->
        <template v-if="todayTabWaiting.length > 0">
          <div class="group-status-label group-waiting-label">待验收提醒 ({{ todayTabWaiting.length }})</div>
          <div
            v-for="task in todayTabWaiting"
            :key="task.id"
            class="card task-card task-waiting-card"
          >
            <div class="flex-between" @click="toggle(task.id)" style="cursor:pointer">
              <div class="flex-center gap-8" style="flex:1;min-width:0">
                <span class="task-circle circle-waiting" @click.stop></span>
                <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ task.title }}</span>
                <span class="badge-waiting">待验收</span>
                <span v-if="task.project" class="badge-project">{{ task.project }}</span>
              </div>
              <span class="text-xs text-secondary" style="flex-shrink:0;margin-left:8px">
                → {{ getPendingHandoff(task)?.assignee }} · 截止 {{ fmtDue(getPendingHandoff(task)?.due) }}
              </span>
            </div>

            <div v-if="expandedId === task.id" class="task-detail">
              <!-- 移交待验收区 -->
              <div class="handoff-pending-box">
                <div class="flex-center gap-8" style="flex-wrap:wrap">
                  <span class="badge-waiting">待验收</span>
                  <span class="text-xs text-secondary">承接方：{{ getPendingHandoff(task)?.assignee }}<span v-if="getPendingHandoff(task)?.assignee_category">（{{ getPendingHandoff(task)?.assignee_category }}）</span></span>
                  <span class="text-xs text-secondary">验收截止：{{ fmtDue(getPendingHandoff(task)?.due) }}</span>
                </div>
                <div v-if="getPendingHandoff(task)?.hand_note" class="text-xs text-secondary" style="margin-top:6px;line-height:1.6">
                  移交说明：{{ getPendingHandoff(task)?.hand_note }}
                </div>

                <!-- 验收表单 -->
                <template v-if="reviewFormKey?.taskId === task.id">
                  <div class="handoff-review-form">
                    <div class="mb-6">
                      <label class="text-xs text-secondary">验收说明（可选）</label>
                      <textarea v-model="reviewDraft.completion_note" rows="2" placeholder="验收结果说明..."></textarea>
                    </div>
                    <div class="mb-6">
                      <label class="flex gap-6" style="align-items:center;cursor:pointer">
                        <input type="checkbox" v-model="reviewDraft.link_project" />
                        <span class="text-xs">同步此次进展到专项</span>
                      </label>
                      <select v-if="reviewDraft.link_project" v-model="reviewDraft.project_id" style="margin-top:6px">
                        <option value="">选择专项</option>
                        <option v-for="p in projectsStore.items" :key="p.id" :value="p.id">{{ p.name }}</option>
                      </select>
                    </div>
                    <div class="mb-8">
                      <label class="text-xs text-secondary">验收后</label>
                      <div class="flex gap-12 mt-4">
                        <label class="flex gap-4" style="cursor:pointer;font-size:12px;align-items:center">
                          <input type="radio" v-model="reviewDraft.next_action" value="doing" />
                          <span>继续我来做</span>
                        </label>
                        <label class="flex gap-4" style="cursor:pointer;font-size:12px;align-items:center">
                          <input type="radio" v-model="reviewDraft.next_action" value="handoff" />
                          <span>再次移交</span>
                        </label>
                        <label class="flex gap-4" style="cursor:pointer;font-size:12px;align-items:center">
                          <input type="radio" v-model="reviewDraft.next_action" value="done" />
                          <span>完成任务</span>
                        </label>
                      </div>
                    </div>
                    <div class="flex gap-8">
                      <button class="small primary" @click.stop="submitReview">确认验收</button>
                      <button class="small" @click.stop="reviewFormKey = null">取消</button>
                    </div>
                  </div>
                </template>
                <template v-else>
                  <div style="margin-top:10px">
                    <button class="small primary" @click.stop="openReviewForm(task.id, getPendingHandoff(task)?.id)">开始验收</button>
                    <button class="small" style="margin-left:8px" @click.stop="cancelWaiting(task.id)">取消移交</button>
                  </div>
                </template>
              </div>

              <!-- 历史接力记录 -->
              <div v-if="getDoneHandoffs(task).length > 0" class="handoff-history">
                <div class="text-xs text-secondary" style="font-weight:600;margin-bottom:6px">接力历史</div>
                <div v-for="h in getDoneHandoffs(task)" :key="h.id" class="handoff-history-item">
                  <div class="flex-center gap-6">
                    <span class="handoff-dot"></span>
                    <span class="text-xs" style="font-weight:500">→ {{ h.assignee }}</span>
                    <span v-if="h.assignee_category" class="text-xs text-secondary">({{ h.assignee_category }})</span>
                    <span class="text-xs text-secondary" style="margin-left:auto">{{ fmtDateShort(h.created_at) }} ~ {{ fmtDue(h.due) }}</span>
                  </div>
                  <div v-if="h.hand_note || h.completion_note" style="padding-left:16px;margin-top:2px">
                    <div v-if="h.hand_note" class="text-xs text-secondary">移交：{{ h.hand_note }}</div>
                    <div v-if="h.completion_note" class="text-xs text-secondary">验收：{{ h.completion_note }}</div>
                  </div>
                  <div v-if="h.linked_project_id" class="text-xs" style="padding-left:16px;margin-top:2px;color:var(--color-primary)">
                    已同步至专项：{{ projectsStore.getById(h.linked_project_id)?.name || h.linked_project_id }}
                  </div>
                </div>
              </div>

              <div class="flex gap-8 mt-8">
                <button class="small" style="color:var(--color-danger);margin-left:auto" @click="removeTask(task.id)">删除</button>
              </div>
            </div>
          </div>
        </template>

        <!-- 今日待办 -->
        <template v-if="todayTabActive.length > 0">
          <div class="group-status-label">今日待办 ({{ todayTabActive.length }})</div>
          <div
            v-for="task in todayTabActive"
            :key="task.id"
            class="card task-card"
            :class="{ 'task-carried-card': carriedSet.has(task.id) }"
          >
            <div class="flex-between" @click="toggle(task.id)" style="cursor:pointer">
              <div class="flex-center gap-8" style="flex:1;min-width:0">
                <span class="task-circle circle-doing" @click.stop="cycleStatus(task)"></span>
                <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ task.title }}</span>
                <span v-if="task.project" class="badge-project">{{ task.project }}</span>
                <span v-if="carriedSet.has(task.id)" class="badge-carried">顺延</span>
              </div>
              <span class="text-xs text-secondary" style="flex-shrink:0;margin-left:8px">{{ taskTimeLabel(task) }}</span>
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

              <!-- 接力历史 -->
              <div v-if="getDoneHandoffs(task).length > 0" class="handoff-history mb-8">
                <div class="text-xs text-secondary" style="font-weight:600;margin-bottom:6px">接力历史</div>
                <div v-for="h in getDoneHandoffs(task)" :key="h.id" class="handoff-history-item">
                  <div class="flex-center gap-6">
                    <span class="handoff-dot"></span>
                    <span class="text-xs" style="font-weight:500">→ {{ h.assignee }}</span>
                    <span v-if="h.assignee_category" class="text-xs text-secondary">({{ h.assignee_category }})</span>
                    <span class="text-xs text-secondary" style="margin-left:auto">{{ fmtDateShort(h.created_at) }}</span>
                  </div>
                  <div v-if="h.hand_note || h.completion_note" style="padding-left:16px;margin-top:2px">
                    <div v-if="h.hand_note" class="text-xs text-secondary">移交：{{ h.hand_note }}</div>
                    <div v-if="h.completion_note" class="text-xs text-secondary">验收：{{ h.completion_note }}</div>
                  </div>
                  <div v-if="h.linked_project_id" class="text-xs" style="padding-left:16px;margin-top:2px;color:var(--color-primary)">
                    已同步至：{{ projectsStore.getById(h.linked_project_id)?.name || h.linked_project_id }}
                  </div>
                </div>
              </div>

              <!-- 移交表单 -->
              <div v-if="handoffFormTaskId === task.id" class="handoff-form mb-8">
                <div class="handoff-form-title">移交给</div>
                <div class="mb-6" style="position:relative">
                  <label class="text-xs text-secondary">承接方姓名</label>
                  <input
                    type="text"
                    :value="handoffDraft.assignee"
                    @input="onAssigneeInput($event.target.value)"
                    placeholder="输入姓名，自动匹配历史联系人"
                    autocomplete="off"
                  />
                  <div v-if="contactSuggestions.length > 0" class="contact-dropdown">
                    <div
                      v-for="c in contactSuggestions"
                      :key="c.id"
                      class="contact-option"
                      @mousedown.prevent="selectContact(c)"
                    >
                      <span>{{ c.name }}</span>
                      <span v-if="c.category" class="text-xs text-secondary" style="margin-left:auto">{{ c.category }}</span>
                    </div>
                  </div>
                </div>
                <div class="flex gap-12 mb-6">
                  <div style="flex:1">
                    <label class="text-xs text-secondary">承接方职能</label>
                    <select v-model="handoffDraft.assignee_category">
                      <option value="">不指定</option>
                      <option v-for="cat in CONTACT_CATEGORIES" :key="cat" :value="cat">{{ cat }}</option>
                    </select>
                  </div>
                  <div style="flex:1">
                    <label class="text-xs text-secondary">验收截止日</label>
                    <input type="date" v-model="handoffDraft.due" />
                  </div>
                </div>
                <div class="mb-6">
                  <label class="text-xs text-secondary">移交说明（可选）</label>
                  <textarea v-model="handoffDraft.hand_note" rows="2" placeholder="说明交接内容或要求..."></textarea>
                </div>
                <div class="flex gap-8">
                  <button class="small primary" @click.stop="submitHandoff(task.id)" :disabled="!handoffDraft.assignee.trim()">确认移交</button>
                  <button class="small" @click.stop="handoffFormTaskId = null">取消</button>
                </div>
              </div>

              <div class="flex gap-8">
                <button
                  class="small primary"
                  @click="carriedSet.has(task.id) ? updateTask(task, 'status', 'done') : cycleStatus(task)"
                >{{ carriedSet.has(task.id) ? '标为完成（归入本周）' : '已完成' }}</button>
                <button
                  class="small"
                  @click.stop="handoffFormTaskId === task.id ? handoffFormTaskId = null : openHandoffForm(task.id)"
                >{{ handoffFormTaskId === task.id ? '取消移交' : '移交' }}</button>
                <button class="small" style="color:var(--color-danger);margin-left:auto" @click="removeTask(task.id)">删除</button>
              </div>
            </div>
          </div>
        </template>

        <!-- 今日已完成 -->
        <template v-if="todayTabDone.length > 0">
          <div class="group-status-label group-done-label flex-between">
            <span>今日已完成 ({{ todayTabDone.length }})</span>
            <button class="small" style="font-weight:normal" @click="showDone = !showDone">
              {{ showDone ? '收起' : '展开' }}
            </button>
          </div>
          <template v-if="showDone">
            <div v-for="task in todayTabDone" :key="task.id" class="card task-card task-done-card">
              <div class="flex-between" @click="toggle(task.id)" style="cursor:pointer">
                <div class="flex-center gap-8" style="flex:1;min-width:0">
                  <span class="task-circle circle-done" @click.stop="cycleStatus(task)">&#10003;</span>
                  <span style="text-decoration:line-through;opacity:0.45;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ task.title }}</span>
                  <span v-if="task.project" class="badge-project">{{ task.project }}</span>
                </div>
                <span class="text-xs" style="color:var(--color-success);flex-shrink:0;margin-left:8px">{{ taskTimeLabel(task) }}</span>
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
                  <label class="text-xs text-secondary">完成时间（修改后自动归入对应周）</label>
                  <input type="datetime-local" :value="toDatetimeLocal(task.completed_at)" @change="changeCompletedAt(task, $event.target.value)" />
                </div>
                <div class="mb-8">
                  <label class="text-xs text-secondary">执行备注 & 子步骤</label>
                  <RichEditor :modelValue="task.note" @update:modelValue="updateTask(task, 'note', $event)" />
                </div>
                <!-- 接力历史（已完成任务只读）-->
                <div v-if="getDoneHandoffs(task).length > 0" class="handoff-history mb-8">
                  <div class="text-xs text-secondary" style="font-weight:600;margin-bottom:6px">接力历史</div>
                  <div v-for="h in getDoneHandoffs(task)" :key="h.id" class="handoff-history-item">
                    <div class="flex-center gap-6">
                      <span class="handoff-dot"></span>
                      <span class="text-xs" style="font-weight:500">→ {{ h.assignee }}</span>
                      <span v-if="h.assignee_category" class="text-xs text-secondary">({{ h.assignee_category }})</span>
                      <span class="text-xs text-secondary" style="margin-left:auto">{{ fmtDateShort(h.created_at) }}</span>
                    </div>
                    <div v-if="h.hand_note || h.completion_note" style="padding-left:16px;margin-top:2px">
                      <div v-if="h.hand_note" class="text-xs text-secondary">移交：{{ h.hand_note }}</div>
                      <div v-if="h.completion_note" class="text-xs text-secondary">验收：{{ h.completion_note }}</div>
                    </div>
                    <div v-if="h.linked_project_id" class="text-xs" style="padding-left:16px;margin-top:2px;color:var(--color-primary)">
                      已同步至：{{ projectsStore.getById(h.linked_project_id)?.name || h.linked_project_id }}
                    </div>
                  </div>
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

        <!-- 今日无任务空态 -->
        <div
          v-if="todayTabTasksDue.length === 0 && todayTabWaiting.length === 0"
          class="text-secondary text-sm"
          style="padding:24px 0;text-align:center"
        >今日暂无任务安排</div>

      </template>

      <!-- ══ 专项视图 ══ -->
      <template v-else>

        <!-- 顺延任务 -->
        <template v-if="tabCarriedTasks.length > 0">
          <div class="group-status-label group-carried-label">上周顺延 ({{ tabCarriedTasks.length }})</div>
          <div
            v-for="task in tabCarriedTasks"
            :key="task.id"
            class="card task-card task-carried-card"
            :class="{
              'task-due-today-card': isDueToday(task),
              'task-waiting-card': task.status === 'waiting',
            }"
          >
            <div class="flex-between" @click="toggle(task.id)" style="cursor:pointer">
              <div class="flex-center gap-8">
                <span
                  class="task-circle"
                  :class="task.status === 'waiting' ? 'circle-waiting' : 'circle-doing'"
                  @click.stop="task.status !== 'waiting' && cycleStatus(task)"
                ></span>
                <span>{{ task.title }}</span>
                <span v-if="task.status === 'waiting'" class="badge-waiting">待验收</span>
                <span v-else-if="isDueToday(task)" class="badge-today">今日处理</span>
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

              <!-- 待验收区 (status=waiting) -->
              <div v-if="task.status === 'waiting'" class="handoff-pending-box mb-8">
                <div class="flex-center gap-8" style="flex-wrap:wrap">
                  <span class="badge-waiting">待验收</span>
                  <span class="text-xs text-secondary">承接方：{{ getPendingHandoff(task)?.assignee }}<span v-if="getPendingHandoff(task)?.assignee_category">（{{ getPendingHandoff(task)?.assignee_category }}）</span></span>
                  <span class="text-xs text-secondary">截止：{{ fmtDue(getPendingHandoff(task)?.due) }}</span>
                </div>
                <div v-if="getPendingHandoff(task)?.hand_note" class="text-xs text-secondary" style="margin-top:6px">
                  移交说明：{{ getPendingHandoff(task)?.hand_note }}
                </div>
                <template v-if="reviewFormKey?.taskId === task.id">
                  <div class="handoff-review-form">
                    <div class="mb-6">
                      <label class="text-xs text-secondary">验收说明（可选）</label>
                      <textarea v-model="reviewDraft.completion_note" rows="2" placeholder="验收结果..."></textarea>
                    </div>
                    <div class="mb-6">
                      <label class="flex gap-6" style="align-items:center;cursor:pointer">
                        <input type="checkbox" v-model="reviewDraft.link_project" />
                        <span class="text-xs">同步进展到专项</span>
                      </label>
                      <select v-if="reviewDraft.link_project" v-model="reviewDraft.project_id" style="margin-top:6px">
                        <option value="">选择专项</option>
                        <option v-for="p in projectsStore.items" :key="p.id" :value="p.id">{{ p.name }}</option>
                      </select>
                    </div>
                    <div class="mb-8">
                      <label class="text-xs text-secondary">验收后</label>
                      <div class="flex gap-12 mt-4">
                        <label class="flex gap-4" style="cursor:pointer;font-size:12px;align-items:center">
                          <input type="radio" v-model="reviewDraft.next_action" value="doing" /><span>继续我来做</span>
                        </label>
                        <label class="flex gap-4" style="cursor:pointer;font-size:12px;align-items:center">
                          <input type="radio" v-model="reviewDraft.next_action" value="handoff" /><span>再次移交</span>
                        </label>
                        <label class="flex gap-4" style="cursor:pointer;font-size:12px;align-items:center">
                          <input type="radio" v-model="reviewDraft.next_action" value="done" /><span>完成任务</span>
                        </label>
                      </div>
                    </div>
                    <div class="flex gap-8">
                      <button class="small primary" @click.stop="submitReview">确认验收</button>
                      <button class="small" @click.stop="reviewFormKey = null">取消</button>
                    </div>
                  </div>
                </template>
                <template v-else>
                  <div style="margin-top:10px">
                    <button class="small primary" @click.stop="openReviewForm(task.id, getPendingHandoff(task)?.id)">开始验收</button>
                    <button class="small" style="margin-left:8px" @click.stop="cancelWaiting(task.id)">取消移交</button>
                  </div>
                </template>
              </div>

              <!-- 接力历史 -->
              <div v-if="getDoneHandoffs(task).length > 0" class="handoff-history mb-8">
                <div class="text-xs text-secondary" style="font-weight:600;margin-bottom:6px">接力历史</div>
                <div v-for="h in getDoneHandoffs(task)" :key="h.id" class="handoff-history-item">
                  <div class="flex-center gap-6">
                    <span class="handoff-dot"></span>
                    <span class="text-xs" style="font-weight:500">→ {{ h.assignee }}</span>
                    <span v-if="h.assignee_category" class="text-xs text-secondary">({{ h.assignee_category }})</span>
                    <span class="text-xs text-secondary" style="margin-left:auto">{{ fmtDateShort(h.created_at) }}</span>
                  </div>
                  <div v-if="h.hand_note || h.completion_note" style="padding-left:16px;margin-top:2px">
                    <div v-if="h.hand_note" class="text-xs text-secondary">移交：{{ h.hand_note }}</div>
                    <div v-if="h.completion_note" class="text-xs text-secondary">验收：{{ h.completion_note }}</div>
                  </div>
                  <div v-if="h.linked_project_id" class="text-xs" style="padding-left:16px;margin-top:2px;color:var(--color-primary)">
                    已同步至：{{ projectsStore.getById(h.linked_project_id)?.name || h.linked_project_id }}
                  </div>
                </div>
              </div>

              <!-- 移交表单 -->
              <div v-if="handoffFormTaskId === task.id" class="handoff-form mb-8">
                <div class="handoff-form-title">移交给</div>
                <div class="mb-6" style="position:relative">
                  <label class="text-xs text-secondary">承接方姓名</label>
                  <input
                    type="text"
                    :value="handoffDraft.assignee"
                    @input="onAssigneeInput($event.target.value)"
                    placeholder="输入姓名，自动匹配历史联系人"
                    autocomplete="off"
                  />
                  <div v-if="contactSuggestions.length > 0" class="contact-dropdown">
                    <div
                      v-for="c in contactSuggestions"
                      :key="c.id"
                      class="contact-option"
                      @mousedown.prevent="selectContact(c)"
                    >
                      <span>{{ c.name }}</span>
                      <span v-if="c.category" class="text-xs text-secondary" style="margin-left:auto">{{ c.category }}</span>
                    </div>
                  </div>
                </div>
                <div class="flex gap-12 mb-6">
                  <div style="flex:1">
                    <label class="text-xs text-secondary">承接方职能</label>
                    <select v-model="handoffDraft.assignee_category">
                      <option value="">不指定</option>
                      <option v-for="cat in CONTACT_CATEGORIES" :key="cat" :value="cat">{{ cat }}</option>
                    </select>
                  </div>
                  <div style="flex:1">
                    <label class="text-xs text-secondary">验收截止日</label>
                    <input type="date" v-model="handoffDraft.due" />
                  </div>
                </div>
                <div class="mb-6">
                  <label class="text-xs text-secondary">移交说明（可选）</label>
                  <textarea v-model="handoffDraft.hand_note" rows="2" placeholder="说明交接内容或要求..."></textarea>
                </div>
                <div class="flex gap-8">
                  <button class="small primary" @click.stop="submitHandoff(task.id)" :disabled="!handoffDraft.assignee.trim()">确认移交</button>
                  <button class="small" @click.stop="handoffFormTaskId = null">取消</button>
                </div>
              </div>

              <div class="flex gap-8">
                <button class="small primary" @click="updateTask(task, 'status', 'done')">标为完成（归入本周）</button>
                <button
                  v-if="task.status !== 'waiting'"
                  class="small"
                  @click.stop="handoffFormTaskId === task.id ? handoffFormTaskId = null : openHandoffForm(task.id)"
                >{{ handoffFormTaskId === task.id ? '取消' : '移交' }}</button>
                <button class="small" style="color:var(--color-danger);margin-left:auto" @click="removeTask(task.id)">删除</button>
              </div>
            </div>
          </div>
        </template>

        <!-- 进行中 -->
        <template v-if="tabActiveTasks.length > 0">
          <div class="group-status-label">进行中 ({{ tabActiveTasks.length }})</div>
          <div
            v-for="task in tabActiveTasks"
            :key="task.id"
            class="card task-card"
            :class="{
              'task-due-today-card': isDueToday(task),
              'task-waiting-card': task.status === 'waiting',
            }"
          >
            <div class="flex-between" @click="toggle(task.id)" style="cursor:pointer">
              <div class="flex-center gap-8">
                <span
                  class="task-circle"
                  :class="task.status === 'waiting' ? 'circle-waiting' : 'circle-doing'"
                  @click.stop="task.status !== 'waiting' && cycleStatus(task)"
                ></span>
                <span>{{ task.title }}</span>
                <span v-if="task.status === 'waiting'" class="badge-waiting">待验收</span>
                <span v-else-if="isDueToday(task)" class="badge-today">今日处理</span>
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

              <!-- 待验收区 -->
              <div v-if="task.status === 'waiting'" class="handoff-pending-box mb-8">
                <div class="flex-center gap-8" style="flex-wrap:wrap">
                  <span class="badge-waiting">待验收</span>
                  <span class="text-xs text-secondary">承接方：{{ getPendingHandoff(task)?.assignee }}<span v-if="getPendingHandoff(task)?.assignee_category">（{{ getPendingHandoff(task)?.assignee_category }}）</span></span>
                  <span class="text-xs text-secondary">截止：{{ fmtDue(getPendingHandoff(task)?.due) }}</span>
                </div>
                <div v-if="getPendingHandoff(task)?.hand_note" class="text-xs text-secondary" style="margin-top:6px">
                  移交说明：{{ getPendingHandoff(task)?.hand_note }}
                </div>
                <template v-if="reviewFormKey?.taskId === task.id">
                  <div class="handoff-review-form">
                    <div class="mb-6">
                      <label class="text-xs text-secondary">验收说明（可选）</label>
                      <textarea v-model="reviewDraft.completion_note" rows="2" placeholder="验收结果..."></textarea>
                    </div>
                    <div class="mb-6">
                      <label class="flex gap-6" style="align-items:center;cursor:pointer">
                        <input type="checkbox" v-model="reviewDraft.link_project" />
                        <span class="text-xs">同步进展到专项</span>
                      </label>
                      <select v-if="reviewDraft.link_project" v-model="reviewDraft.project_id" style="margin-top:6px">
                        <option value="">选择专项</option>
                        <option v-for="p in projectsStore.items" :key="p.id" :value="p.id">{{ p.name }}</option>
                      </select>
                    </div>
                    <div class="mb-8">
                      <label class="text-xs text-secondary">验收后</label>
                      <div class="flex gap-12 mt-4">
                        <label class="flex gap-4" style="cursor:pointer;font-size:12px;align-items:center">
                          <input type="radio" v-model="reviewDraft.next_action" value="doing" /><span>继续我来做</span>
                        </label>
                        <label class="flex gap-4" style="cursor:pointer;font-size:12px;align-items:center">
                          <input type="radio" v-model="reviewDraft.next_action" value="handoff" /><span>再次移交</span>
                        </label>
                        <label class="flex gap-4" style="cursor:pointer;font-size:12px;align-items:center">
                          <input type="radio" v-model="reviewDraft.next_action" value="done" /><span>完成任务</span>
                        </label>
                      </div>
                    </div>
                    <div class="flex gap-8">
                      <button class="small primary" @click.stop="submitReview">确认验收</button>
                      <button class="small" @click.stop="reviewFormKey = null">取消</button>
                    </div>
                  </div>
                </template>
                <template v-else>
                  <div style="margin-top:10px">
                    <button class="small primary" @click.stop="openReviewForm(task.id, getPendingHandoff(task)?.id)">开始验收</button>
                    <button class="small" style="margin-left:8px" @click.stop="cancelWaiting(task.id)">取消移交</button>
                  </div>
                </template>
              </div>

              <!-- 接力历史 -->
              <div v-if="getDoneHandoffs(task).length > 0" class="handoff-history mb-8">
                <div class="text-xs text-secondary" style="font-weight:600;margin-bottom:6px">接力历史</div>
                <div v-for="h in getDoneHandoffs(task)" :key="h.id" class="handoff-history-item">
                  <div class="flex-center gap-6">
                    <span class="handoff-dot"></span>
                    <span class="text-xs" style="font-weight:500">→ {{ h.assignee }}</span>
                    <span v-if="h.assignee_category" class="text-xs text-secondary">({{ h.assignee_category }})</span>
                    <span class="text-xs text-secondary" style="margin-left:auto">{{ fmtDateShort(h.created_at) }}</span>
                  </div>
                  <div v-if="h.hand_note || h.completion_note" style="padding-left:16px;margin-top:2px">
                    <div v-if="h.hand_note" class="text-xs text-secondary">移交：{{ h.hand_note }}</div>
                    <div v-if="h.completion_note" class="text-xs text-secondary">验收：{{ h.completion_note }}</div>
                  </div>
                  <div v-if="h.linked_project_id" class="text-xs" style="padding-left:16px;margin-top:2px;color:var(--color-primary)">
                    已同步至：{{ projectsStore.getById(h.linked_project_id)?.name || h.linked_project_id }}
                  </div>
                </div>
              </div>

              <!-- 移交表单 -->
              <div v-if="handoffFormTaskId === task.id" class="handoff-form mb-8">
                <div class="handoff-form-title">移交给</div>
                <div class="mb-6" style="position:relative">
                  <label class="text-xs text-secondary">承接方姓名</label>
                  <input
                    type="text"
                    :value="handoffDraft.assignee"
                    @input="onAssigneeInput($event.target.value)"
                    placeholder="输入姓名，自动匹配历史联系人"
                    autocomplete="off"
                  />
                  <div v-if="contactSuggestions.length > 0" class="contact-dropdown">
                    <div
                      v-for="c in contactSuggestions"
                      :key="c.id"
                      class="contact-option"
                      @mousedown.prevent="selectContact(c)"
                    >
                      <span>{{ c.name }}</span>
                      <span v-if="c.category" class="text-xs text-secondary" style="margin-left:auto">{{ c.category }}</span>
                    </div>
                  </div>
                </div>
                <div class="flex gap-12 mb-6">
                  <div style="flex:1">
                    <label class="text-xs text-secondary">承接方职能</label>
                    <select v-model="handoffDraft.assignee_category">
                      <option value="">不指定</option>
                      <option v-for="cat in CONTACT_CATEGORIES" :key="cat" :value="cat">{{ cat }}</option>
                    </select>
                  </div>
                  <div style="flex:1">
                    <label class="text-xs text-secondary">验收截止日</label>
                    <input type="date" v-model="handoffDraft.due" />
                  </div>
                </div>
                <div class="mb-6">
                  <label class="text-xs text-secondary">移交说明（可选）</label>
                  <textarea v-model="handoffDraft.hand_note" rows="2" placeholder="说明交接内容或要求..."></textarea>
                </div>
                <div class="flex gap-8">
                  <button class="small primary" @click.stop="submitHandoff(task.id)" :disabled="!handoffDraft.assignee.trim()">确认移交</button>
                  <button class="small" @click.stop="handoffFormTaskId = null">取消</button>
                </div>
              </div>

              <div class="flex gap-8">
                <button class="small primary" @click="updateTask(task, 'status', 'doing')">进行中</button>
                <button v-if="task.status !== 'waiting'" class="small" @click="updateTask(task, 'status', 'done')">已完成</button>
                <button
                  v-if="task.status !== 'waiting'"
                  class="small"
                  @click.stop="handoffFormTaskId === task.id ? handoffFormTaskId = null : openHandoffForm(task.id)"
                >{{ handoffFormTaskId === task.id ? '取消' : '移交' }}</button>
                <button class="small" style="color:var(--color-danger);margin-left:auto" @click="removeTask(task.id)">删除</button>
              </div>
            </div>
          </div>
        </template>

        <!-- 已完成 -->
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
                  <label class="text-xs text-secondary">完成时间（修改后自动归入对应周）</label>
                  <input type="datetime-local" :value="toDatetimeLocal(task.completed_at)" @change="changeCompletedAt(task, $event.target.value)" />
                </div>
                <div class="mb-8">
                  <label class="text-xs text-secondary">执行备注 & 子步骤</label>
                  <RichEditor :modelValue="task.note" @update:modelValue="updateTask(task, 'note', $event)" />
                </div>

                <!-- 接力历史 -->
                <div v-if="getDoneHandoffs(task).length > 0" class="handoff-history mb-8">
                  <div class="text-xs text-secondary" style="font-weight:600;margin-bottom:6px">接力历史</div>
                  <div v-for="h in getDoneHandoffs(task)" :key="h.id" class="handoff-history-item">
                    <div class="flex-center gap-6">
                      <span class="handoff-dot"></span>
                      <span class="text-xs" style="font-weight:500">→ {{ h.assignee }}</span>
                      <span v-if="h.assignee_category" class="text-xs text-secondary">({{ h.assignee_category }})</span>
                      <span class="text-xs text-secondary" style="margin-left:auto">{{ fmtDateShort(h.created_at) }}</span>
                    </div>
                    <div v-if="h.hand_note || h.completion_note" style="padding-left:16px;margin-top:2px">
                      <div v-if="h.hand_note" class="text-xs text-secondary">移交：{{ h.hand_note }}</div>
                      <div v-if="h.completion_note" class="text-xs text-secondary">验收：{{ h.completion_note }}</div>
                    </div>
                    <div v-if="h.linked_project_id" class="text-xs" style="padding-left:16px;margin-top:2px;color:var(--color-primary)">
                      已同步至：{{ projectsStore.getById(h.linked_project_id)?.name || h.linked_project_id }}
                    </div>
                  </div>
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
        >暂无任务</div>

      </template>
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

  <!-- 联系人管理 -->
  <div class="section" style="margin-top:12px">
    <button
      class="contacts-toggle"
      @click="showContacts = !showContacts"
    >
      承接方联系人 ({{ contactsStore.items.length }})
      <span style="margin-left:6px;font-size:12px;opacity:0.6">{{ showContacts ? '▲' : '▼' }}</span>
    </button>

    <div v-if="showContacts" class="card contacts-panel">
      <!-- 列表 -->
      <div v-if="contactsStore.items.length > 0" class="contacts-list">
        <div
          v-for="c in contactsStore.items"
          :key="c.id"
          class="contact-row"
        >
          <template v-if="editingContactId === c.id">
            <input
              type="text"
              v-model="editContactName"
              style="flex:1;min-width:0"
              @keydown.enter="saveEditContact"
            />
            <select v-model="editContactCategory" style="width:110px">
              <option value="">不指定</option>
              <option v-for="cat in CONTACT_CATEGORIES" :key="cat" :value="cat">{{ cat }}</option>
            </select>
            <button class="small primary" @click="saveEditContact">保存</button>
            <button class="small" @click="editingContactId = null">取消</button>
          </template>
          <template v-else>
            <span class="contact-name">{{ c.name }}</span>
            <span v-if="c.category" class="badge-project" style="font-size:11px">{{ c.category }}</span>
            <span v-else class="text-xs text-secondary" style="margin-left:4px">未分类</span>
            <div style="margin-left:auto;display:flex;gap:6px">
              <button class="small" @click="startEditContact(c)">编辑</button>
              <button class="small" style="color:var(--color-danger)" @click="contactsStore.remove(c.id)">删除</button>
            </div>
          </template>
        </div>
      </div>
      <div v-else class="text-xs text-secondary" style="padding:10px 0">
        暂无联系人记录。在移交任务时填写承接方姓名，系统会自动保存。
      </div>

      <!-- 手动新增 -->
      <div class="contact-add-row">
        <input
          type="text"
          v-model="newContactName"
          placeholder="新增联系人姓名"
          style="flex:1;min-width:0"
          @keydown.enter="addContact"
        />
        <select v-model="newContactCategory" style="width:110px">
          <option value="">不指定职能</option>
          <option v-for="cat in CONTACT_CATEGORIES" :key="cat" :value="cat">{{ cat }}</option>
        </select>
        <button class="small primary" @click="addContact" :disabled="!newContactName.trim()">添加</button>
      </div>
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
.tab-btn:hover { background: #e2e6f0; }
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
.group-done-label { color: var(--color-success, #388e3c); }
.group-carried-label { color: var(--color-warning, #d97706); }
.group-waiting-label { color: #b45309; }

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
.task-waiting-card {
  background: #fffbf0 !important;
  border-color: #fcd34d !important;
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
.summary-textarea:focus { outline: none; }
.summary-textarea::placeholder { color: var(--color-secondary, #aaa); }
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
.circle-waiting {
  background: transparent;
  border: 2px dashed #d97706;
  cursor: default;
}
.circle-done {
  background: transparent;
  color: #10b981;
  font-size: 15px;
  line-height: 1;
}

/* 今日 Todo 激励横幅 */
.today-banner {
  border-radius: 10px;
  padding: 13px 16px;
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 14px;
  letter-spacing: 0.2px;
  line-height: 1.5;
}
.today-banner-empty {
  background: #f0f9ff;
  color: #0369a1;
  border: 1px solid #bae6fd;
}
.today-banner-progress {
  background: #fffbeb;
  color: #92400e;
  border: 1px solid #fcd34d;
}
.today-banner-done {
  background: #f0fdf4;
  color: #166534;
  border: 1px solid #bbf7d0;
}

/* 今日任务项目徽章 */
.badge-project {
  font-size: 11px;
  background: #ede9fe;
  color: #6d28d9;
  padding: 1px 6px;
  border-radius: 3px;
  font-weight: 500;
  flex-shrink: 0;
  white-space: nowrap;
}
.badge-carried {
  font-size: 10px;
  background: #fef3c7;
  color: #b45309;
  padding: 1px 6px;
  border-radius: 3px;
  font-weight: 600;
  flex-shrink: 0;
}

/* 待验收徽章 */
.badge-waiting {
  font-size: 10px;
  font-weight: 700;
  color: #b45309;
  background: #fef3c7;
  border: 1px solid #fcd34d;
  border-radius: 4px;
  padding: 1px 7px;
  flex-shrink: 0;
  white-space: nowrap;
  letter-spacing: 0.3px;
}

/* 待验收区块 */
.handoff-pending-box {
  background: #fffbeb;
  border: 1px solid #fcd34d;
  border-radius: 8px;
  padding: 10px 14px;
}

/* 接力历史 */
.handoff-history {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 10px 12px;
}
.handoff-history-item {
  padding: 5px 0;
  border-bottom: 1px solid #f0f0f0;
}
.handoff-history-item:last-child { border-bottom: none; }
.handoff-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #d97706;
  flex-shrink: 0;
}

/* 验收表单 */
.handoff-review-form {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid #fcd34d;
}

/* 移交表单 */
.handoff-form {
  background: #f0f9ff;
  border: 1px solid #bae6fd;
  border-radius: 8px;
  padding: 12px 14px;
}
.handoff-form-title {
  font-size: 13px;
  font-weight: 700;
  color: #0369a1;
  margin-bottom: 10px;
}

/* 联系人下拉建议 */
.contact-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: #fff;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  z-index: 100;
  overflow: hidden;
}
.contact-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  font-size: 13px;
  transition: background 0.1s;
}
.contact-option:hover { background: #f0f7ff; }

/* 联系人管理 */
.contacts-toggle {
  background: none;
  border: none;
  padding: 6px 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-secondary, #888);
  cursor: pointer;
  display: flex;
  align-items: center;
  letter-spacing: 0.3px;
}
.contacts-toggle:hover { color: var(--color-text); }
.contacts-panel {
  margin-top: 6px;
  padding: 12px 14px;
}
.contacts-list {
  margin-bottom: 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  overflow: hidden;
}
.contact-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  font-size: 13px;
  border-bottom: 1px solid var(--color-border);
  background: #fff;
}
.contact-row:last-child { border-bottom: none; }
.contact-row:hover { background: #f9fafb; }
.contact-name {
  font-weight: 500;
  min-width: 60px;
}
.contact-add-row {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

/* ── 手机端响应式 ── */
@media (max-width: 639px) {
  .week-stats-right {
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 2px 6px;
    font-size: 12px;
  }
  .sep { display: none; }
  .task-input-row {
    flex-direction: column;
    gap: 8px;
  }
}
</style>
