<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import draggable from 'vuedraggable'
import { useTasksStore } from '../stores/tasks.js'
import { useProjectsStore } from '../stores/projects.js'
import { generateWeekSummary } from '../ai/organizeService.js'

const tasksStore = useTasksStore()
const projectsStore = useProjectsStore()

// ── 今日信息 ──
const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六']
const todayStr = computed(() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
})
const todayFormatted = computed(() => {
  const d = new Date()
  return `${d.getMonth()+1}月${d.getDate()}日`
})
const todayWeekday = computed(() => `周${WEEKDAY_CN[new Date().getDay()]}`)

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
  let c = 0
  for (const p of projectsStore.items)
    for (const u of (p.updates || [])) { const d = new Date(u.created_at); if (d >= monday && d <= end) c++ }
  return c
})

// ── Capture ──
const captureText = ref('')
const captureRef = ref(null)
const captureExpanded = ref(false)
const captureLineCount = computed(() => captureText.value.split('\n').filter(l => l.trim()).length)

function expandCapture() {
  captureExpanded.value = true
  nextTick(() => captureRef.value?.focus())
}
function submitCapture() {
  if (!captureLineCount.value) { captureExpanded.value = false; return }
  tasksStore.batchCreate(captureText.value.split('\n'), { week: weekInfo.value.weekNo })
  captureText.value = ''
  captureExpanded.value = false
}
function onCaptureKeydown(e) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submitCapture()
  if (e.key === 'Escape') captureExpanded.value = false
}

// ── 工作区分组 ──
const inboxTasks = computed(() => tasksStore.inboxTasks)

// 可拖拽排序的 focus / quick / collab（computed setter 触发 store.reorder）
const draggableFocusTasks = computed({
  get: () => [...tasksStore.focusTasks],
  set: (val) => tasksStore.reorder('focus', val),
})
const draggableQuickTasks = computed({
  get: () => [...tasksStore.quickTasks],
  set: (val) => tasksStore.reorder('quick', val),
})
const draggableCollabTasks = computed({
  get: () => [...tasksStore.collabTasks],
  set: (val) => tasksStore.reorder('collab', val),
})

// 协作到期判断
function isCollabDue(task) {
  return task.collab_next_check && task.collab_next_check <= todayStr.value
}

// ── 内联添加 ──
const addingMode = ref(null) // 'focus' | 'quick' | 'collab'
const addingTitle = ref('')
const addingInputRef = ref(null)

function startAdding(mode) {
  addingMode.value = mode
  addingTitle.value = ''
  nextTick(() => addingInputRef.value?.focus())
}
function submitAdding() {
  if (!addingTitle.value.trim()) { addingMode.value = null; return }
  tasksStore.add({ title: addingTitle.value.trim(), mode: addingMode.value, week: weekInfo.value.weekNo })
  addingTitle.value = ''
  addingMode.value = null
}
function onAddingKeydown(e) {
  if (e.key === 'Enter') submitAdding()
  if (e.key === 'Escape') addingMode.value = null
}

// ── 内联编辑（click to edit, blur to save）──
const editingCell = ref(null) // {taskId, field}

function startEdit(taskId, field, e) {
  e?.stopPropagation()
  editingCell.value = { taskId, field }
}
function saveEdit(task, field, value) {
  const val = typeof value === 'string' ? value.trim() : value
  tasksStore.update(task.id, { [field]: val })
  editingCell.value = null
}
function isEditing(taskId, field) {
  return editingCell.value?.taskId === taskId && editingCell.value?.field === field
}

// ── Focus 子步骤 ──
const subInputTaskId = ref(null)
const subInputText = ref('')
const subInputRef = ref(null)

function startSubInput(taskId) {
  subInputTaskId.value = taskId
  subInputText.value = ''
  nextTick(() => subInputRef.value?.focus())
}
function submitSubInput(taskId) {
  if (subInputText.value.trim()) tasksStore.addFocusSubtask(taskId, subInputText.value)
  subInputText.value = ''
  subInputTaskId.value = null
}

// ── 任务操作 ──
function markDone(id) { tasksStore.update(id, { status: 'done' }) }
function undoDone(id) { tasksStore.update(id, { status: 'doing' }) }
function removeTask(id) { tasksStore.remove(id) }
function assignZone(id, mode) { tasksStore.update(id, { mode }) }

// ── 格式化 ──
function fmtDate(isoOrDate) {
  if (!isoOrDate) return ''
  const s = typeof isoOrDate === 'string' ? isoOrDate : isoOrDate.toISOString()
  const [, m, d] = s.slice(0, 10).split('-')
  return `${+m}/${+d}`
}
function subtaskProgress(task) {
  const s = task.focus_subtasks || []
  if (!s.length) return null
  return { done: s.filter(x => x.done).length, total: s.length }
}

// ── 本周已完成 ──
const showDone = ref(false)
const weekDoneTasks = computed(() => {
  const { monday, sunday } = weekInfo.value
  const end = new Date(sunday); end.setHours(23, 59, 59, 999)
  return tasksStore.items
    .filter(t => {
      if (t.status !== 'done' || !t.completed_at) return false
      const d = new Date(t.completed_at)
      return d >= monday && d <= end
    })
    .sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at))
})

// ── 周总结 ──
const weekSummary = ref({ work: '', feeling: '', status: 'draft' })
const showSummary = ref(false)
const summaryWorkRef = ref(null)
const summaryFeelingRef = ref(null)
const summaryLoading = ref(false)
const summaryError = ref('')

watch(weekKey, k => { weekSummary.value = tasksStore.getWeekReview(k) }, { immediate: true })

function saveWeekSummary() { tasksStore.saveWeekReview(weekKey.value, { ...weekSummary.value }) }
function onWorkInput(e) { weekSummary.value = { ...weekSummary.value, work: e.target.value }; saveWeekSummary() }
function onFeelingInput(e) { weekSummary.value = { ...weekSummary.value, feeling: e.target.value }; saveWeekSummary() }

async function genWeekSummary() {
  summaryLoading.value = true; summaryError.value = ''
  try {
    const { monday, sunday } = weekInfo.value
    const end = new Date(sunday); end.setHours(23, 59, 59, 999)
    const projectUpdates = []
    for (const p of projectsStore.items)
      for (const u of (p.updates || [])) { const d = new Date(u.created_at); if (d >= monday && d <= end) projectUpdates.push({ ...u, projectName: p.name }) }
    const completedTasks = tasksStore.items.filter(t => {
      if (t.status !== 'done' || !t.completed_at) return false
      const d = new Date(t.completed_at)
      return d >= monday && d <= end
    })
    weekSummary.value = { ...weekSummary.value, work: await generateWeekSummary({ projectUpdates, completedTasks }) }
    saveWeekSummary()
    nextTick(() => { if (summaryWorkRef.value) { summaryWorkRef.value.style.height = 'auto'; summaryWorkRef.value.style.height = summaryWorkRef.value.scrollHeight + 'px' } })
  } catch (err) {
    summaryError.value = err.message || 'AI 生成失败'
  } finally {
    summaryLoading.value = false
  }
}
</script>

<template>
  <div class="dp">

    <!-- ═══ 顶部：今日 + 周信息 ═══ -->
    <div class="dp-header">
      <div class="dp-today">
        <span class="dp-date">{{ todayFormatted }}</span>
        <span class="dp-weekday">{{ todayWeekday }}</span>
      </div>
      <div class="dp-week">
        <button class="dp-nav" @click="currentWeekOffset--">‹</button>
        <span>Week {{ weekInfo.weekNo }}  ·  {{ weekInfo.range }}</span>
        <button class="dp-nav" @click="currentWeekOffset++">›</button>
        <span v-if="weekDoneCount || weekProjectUpdates" class="dp-stats">
          完成 {{ weekDoneCount }} 件{{ weekProjectUpdates ? `  ·  推进 ${weekProjectUpdates} 条` : '' }}
        </span>
      </div>
    </div>

    <!-- ═══ Capture ═══ -->
    <div class="dp-capture">
      <div v-if="!captureExpanded" class="capture-idle" @click="expandCapture">
        <span class="capture-icon">＋</span>
        <span class="capture-idle-text">记下一件事…</span>
      </div>
      <template v-else>
        <textarea
          ref="captureRef"
          v-model="captureText"
          class="capture-ta"
          placeholder="每行一条，不需要分类，先全部倒出来&#10;Ctrl+Enter 提交，Esc 取消"
          rows="4"
          @keydown="onCaptureKeydown"
        ></textarea>
        <div class="capture-foot">
          <span class="capture-hint">{{ captureLineCount ? `${captureLineCount} 条 → 收件箱` : '空行不计入' }}</span>
          <div style="display:flex;gap:6px">
            <button class="btn-p" @click="submitCapture" :disabled="!captureLineCount">加入收件箱</button>
            <button class="btn-s" @click="captureExpanded = false; captureText = ''">取消</button>
          </div>
        </div>
      </template>
    </div>

    <!-- ═══ 主体布局 ═══ -->
    <div class="dp-body">

      <!-- ─── 左列：今日工作 ─── -->
      <main class="dp-main">

        <!-- 1. 沉浸工作 -->
        <section class="dp-sec">
          <div class="sec-hd">
            <span class="sec-lbl">沉浸工作</span>
            <span v-if="draggableFocusTasks.length" class="sec-cnt">{{ draggableFocusTasks.length }}</span>
          </div>

          <p v-if="!draggableFocusTasks.length" class="sec-empty">今日没有沉浸工作安排</p>

          <draggable
            v-model="draggableFocusTasks"
            item-key="id"
            handle=".drag-handle"
            ghost-class="drag-ghost"
            animation="150"
          >
            <template #item="{ element: task, index }">
              <div class="fb">
                <!-- 标题行 -->
                <div class="fb-hd">
                  <span class="drag-handle" title="拖动调整优先级">⠿</span>
                  <span class="fb-num">{{ index + 1 }}</span>
                  <button class="fb-dot" @click="markDone(task.id)" title="完成"></button>

                  <!-- 标题 -->
                  <span
                    v-if="!isEditing(task.id,'title')"
                    class="fb-title editable"
                    @click="startEdit(task.id,'title',$event)"
                  >{{ task.title }}</span>
                  <input
                    v-else
                    class="il-inp fb-title-inp"
                    :value="task.title"
                    @blur="saveEdit(task,'title',$event.target.value)"
                    @keydown.enter.prevent="saveEdit(task,'title',$event.target.value)"
                    @keydown.escape.prevent="editingCell=null"
                    autofocus
                  />

                  <div class="fb-meta">
                    <!-- DDL -->
                    <template v-if="!isEditing(task.id,'due')">
                      <span
                        v-if="task.due"
                        class="fb-due editable"
                        :class="{'fb-due-over': task.due <= todayStr}"
                        @click="startEdit(task.id,'due',$event)"
                      >{{ fmtDate(task.due) }}</span>
                      <span
                        v-else
                        class="fb-due-ph"
                        @click="startEdit(task.id,'due',$event)"
                      >+ DDL</span>
                    </template>
                    <input
                      v-else
                      type="date"
                      class="il-inp due-inp"
                      :value="task.due"
                      @change="saveEdit(task,'due',$event.target.value)"
                      @blur="editingCell=null"
                      @keydown.escape.prevent="editingCell=null"
                      autofocus
                    />

                    <!-- 项目 -->
                    <span v-if="task.project" class="tag">{{ task.project }}</span>

                    <!-- 子步骤进度 -->
                    <span v-if="subtaskProgress(task)" class="fb-prog">
                      {{ subtaskProgress(task).done }}/{{ subtaskProgress(task).total }}
                    </span>
                  </div>

                  <!-- 操作（hover 显示） -->
                  <div class="hov-acts">
                    <button @click.stop="assignZone(task.id,'inbox')" title="退回收件箱">↩</button>
                    <button @click.stop="removeTask(task.id)" class="del" title="删除">×</button>
                  </div>
                </div>

                <!-- 备注 -->
                <div class="fb-goal-row" @click.stop>
                  <span
                    v-if="!isEditing(task.id,'focus_goal') && task.focus_goal"
                    class="fb-goal editable"
                    @click="startEdit(task.id,'focus_goal',$event)"
                  >{{ task.focus_goal }}</span>
                  <input
                    v-else-if="isEditing(task.id,'focus_goal')"
                    class="il-inp fb-goal-inp"
                    :value="task.focus_goal"
                    placeholder="备注…"
                    @blur="saveEdit(task,'focus_goal',$event.target.value)"
                    @keydown.enter.prevent="saveEdit(task,'focus_goal',$event.target.value)"
                    @keydown.escape.prevent="editingCell=null"
                    autofocus
                  />
                  <span
                    v-else
                    class="fb-goal-ph"
                    @click="startEdit(task.id,'focus_goal',$event)"
                  >+ 备注</span>
                </div>

                <!-- 子步骤 -->
                <div class="sub-list">
                  <label
                    v-for="sub in (task.focus_subtasks||[])"
                    :key="sub.id"
                    class="sub-row"
                    :class="{'sub-done': sub.done}"
                  >
                    <input type="checkbox" class="sub-ck" :checked="sub.done"
                      @change="tasksStore.toggleFocusSubtask(task.id,sub.id)" />
                    <span class="sub-text">{{ sub.text }}</span>
                    <button class="sub-del hov-show" @click.prevent.stop="tasksStore.removeFocusSubtask(task.id,sub.id)">×</button>
                  </label>

                  <!-- 新增子步骤输入 -->
                  <div v-if="subInputTaskId === task.id" class="sub-row sub-inp-row" @click.stop>
                    <span class="sub-ck-ph"></span>
                    <input
                      ref="subInputRef"
                      class="il-inp sub-inp"
                      v-model="subInputText"
                      placeholder="步骤内容…"
                      @keydown.enter.prevent="submitSubInput(task.id)"
                      @keydown.escape.prevent="subInputTaskId=null"
                    />
                    <button class="btn-xs" @click.stop="submitSubInput(task.id)">添加</button>
                  </div>
                  <button v-else class="sub-add" @click.stop="startSubInput(task.id)">+ 添加步骤</button>
                </div>
              </div>
            </template>
          </draggable>

          <!-- 内联添加 -->
          <div v-if="addingMode==='focus'" class="il-add">
            <input
              ref="addingInputRef"
              class="il-inp il-add-inp"
              v-model="addingTitle"
              placeholder="沉浸工作标题…"
              @keydown="onAddingKeydown"
            />
            <button class="btn-p" @click="submitAdding">确定</button>
            <button class="btn-s" @click="addingMode=null">取消</button>
          </div>
          <button v-else class="sec-add" @click="startAdding('focus')">+ 添加沉浸工作</button>
        </section>

        <!-- 2. 快速处理 -->
        <section class="dp-sec">
          <div class="sec-hd">
            <span class="sec-lbl">快速处理</span>
            <span v-if="draggableQuickTasks.length" class="sec-cnt">{{ draggableQuickTasks.length }}</span>
          </div>

          <p v-if="!draggableQuickTasks.length" class="sec-empty">无快速任务</p>

          <draggable
            v-model="draggableQuickTasks"
            item-key="id"
            handle=".drag-handle"
            ghost-class="drag-ghost"
            animation="150"
          >
            <template #item="{ element: task, index }">
              <div class="qk-row">
                <span class="drag-handle qk-handle" title="拖动调整优先级">⠿</span>
                <span class="qk-num">{{ index + 1 }}</span>
                <input type="checkbox" class="qk-ck" @change="markDone(task.id)" />
                <span
                  v-if="!isEditing(task.id,'title')"
                  class="qk-title"
                  @dblclick="startEdit(task.id,'title',$event)"
                >{{ task.title }}</span>
                <input
                  v-else
                  class="il-inp qk-inp"
                  :value="task.title"
                  @blur="saveEdit(task,'title',$event.target.value)"
                  @keydown.enter.prevent="saveEdit(task,'title',$event.target.value)"
                  @keydown.escape.prevent="editingCell=null"
                  autofocus
                />
                <span v-if="task.project" class="tag tag-sm">{{ task.project }}</span>
                <div class="hov-acts qk-acts">
                  <button @click.stop="startEdit(task.id,'title',$event)" title="编辑">✎</button>
                  <button @click.stop="assignZone(task.id,'inbox')" title="退回">↩</button>
                  <button @click.stop="removeTask(task.id)" class="del" title="删除">×</button>
                </div>
              </div>
            </template>
          </draggable>

          <div v-if="addingMode==='quick'" class="il-add">
            <input
              ref="addingInputRef"
              class="il-inp il-add-inp"
              v-model="addingTitle"
              placeholder="快速任务内容…"
              @keydown="onAddingKeydown"
            />
            <button class="btn-p" @click="submitAdding">确定</button>
            <button class="btn-s" @click="addingMode=null">取消</button>
          </div>
          <button v-else class="sec-add" @click="startAdding('quick')">+ 添加快速任务</button>
        </section>

        <!-- 3. 协作跟进 -->
        <section class="dp-sec">
          <div class="sec-hd">
            <span class="sec-lbl">协作跟进</span>
            <span v-if="draggableCollabTasks.length" class="sec-cnt">{{ draggableCollabTasks.length }}</span>
          </div>

          <p v-if="!draggableCollabTasks.length" class="sec-empty">无协作跟进事项</p>

          <template v-if="draggableCollabTasks.length">
            <!-- 表头 -->
            <div class="ct-hd ct-row">
              <span></span>
              <span>事项</span>
              <span>负责人</span>
              <span>状态</span>
              <span>检查日</span>
              <span></span>
            </div>

            <!-- 可拖拽数据行 -->
            <draggable
              v-model="draggableCollabTasks"
              item-key="id"
              handle=".ct-handle"
              ghost-class="drag-ghost"
              animation="150"
            >
              <template #item="{ element: task }">
                <div
                  class="ct-row"
                  :class="{'ct-due': isCollabDue(task)}"
                >
                  <!-- 拖把 -->
                  <span class="drag-handle ct-handle" title="拖动调整优先级">⠿</span>

                  <!-- 事项 -->
                  <span v-if="!isEditing(task.id,'title')" class="ct-cell editable" @click="startEdit(task.id,'title',$event)">{{ task.title }}</span>
                  <input v-else class="il-inp ct-inp" :value="task.title"
                    @blur="saveEdit(task,'title',$event.target.value)"
                    @keydown.enter.prevent="saveEdit(task,'title',$event.target.value)"
                    @keydown.escape.prevent="editingCell=null" autofocus />

                  <!-- 负责人 -->
                  <span v-if="!isEditing(task.id,'collab_owner')" class="ct-cell editable" :class="{'ct-empty':!task.collab_owner}" @click="startEdit(task.id,'collab_owner',$event)">{{ task.collab_owner || '—' }}</span>
                  <input v-else class="il-inp ct-inp" :value="task.collab_owner" placeholder="负责人"
                    @blur="saveEdit(task,'collab_owner',$event.target.value)"
                    @keydown.enter.prevent="saveEdit(task,'collab_owner',$event.target.value)"
                    @keydown.escape.prevent="editingCell=null" autofocus />

                  <!-- 状态 -->
                  <span v-if="!isEditing(task.id,'collab_status')" class="ct-cell editable" :class="{'ct-empty':!task.collab_status}" @click="startEdit(task.id,'collab_status',$event)">{{ task.collab_status || '—' }}</span>
                  <input v-else class="il-inp ct-inp" :value="task.collab_status" placeholder="状态"
                    @blur="saveEdit(task,'collab_status',$event.target.value)"
                    @keydown.enter.prevent="saveEdit(task,'collab_status',$event.target.value)"
                    @keydown.escape.prevent="editingCell=null" autofocus />

                  <!-- 检查日 -->
                  <span
                    v-if="!isEditing(task.id,'collab_next_check')"
                    class="ct-cell editable"
                    :class="{'ct-empty':!task.collab_next_check,'ct-date-due':isCollabDue(task)}"
                    @click="startEdit(task.id,'collab_next_check',$event)"
                  >{{ fmtDate(task.collab_next_check) || '—' }}</span>
                  <input v-else type="date" class="il-inp ct-inp" :value="task.collab_next_check"
                    @blur="saveEdit(task,'collab_next_check',$event.target.value)"
                    @keydown.enter.prevent="saveEdit(task,'collab_next_check',$event.target.value)"
                    @keydown.escape.prevent="editingCell=null" autofocus />

                  <!-- 操作 -->
                  <div class="hov-acts" style="justify-content:flex-end">
                    <button @click.stop="markDone(task.id)" title="完成">✓</button>
                    <button @click.stop="assignZone(task.id,'inbox')" title="退回">↩</button>
                    <button @click.stop="removeTask(task.id)" class="del" title="删除">×</button>
                  </div>
                </div>
              </template>
            </draggable>
          </template>

          <div v-if="addingMode==='collab'" class="il-add">
            <input
              ref="addingInputRef"
              class="il-inp il-add-inp"
              v-model="addingTitle"
              placeholder="协作事项标题…"
              @keydown="onAddingKeydown"
            />
            <button class="btn-p" @click="submitAdding">确定</button>
            <button class="btn-s" @click="addingMode=null">取消</button>
          </div>
          <button v-else class="sec-add" @click="startAdding('collab')">+ 添加跟进事项</button>
        </section>

        <!-- 本周已完成 -->
        <div v-if="weekDoneTasks.length" class="done-wrap">
          <button class="toggle-btn" @click="showDone = !showDone">
            {{ showDone ? '▾' : '▸' }} 本周已完成（{{ weekDoneTasks.length }}）
          </button>
          <div v-if="showDone" class="done-list">
            <div v-for="task in weekDoneTasks" :key="task.id" class="done-row">
              <span class="done-ck">✓</span>
              <span class="done-title">{{ task.title }}</span>
              <span v-if="task.project" class="tag tag-sm">{{ task.project }}</span>
              <span class="done-date">{{ fmtDate(task.completed_at?.slice(0,10)) }}</span>
              <div class="hov-acts">
                <button @click.stop="undoDone(task.id)" title="撤销">↩</button>
              </div>
            </div>
          </div>
        </div>

        <!-- 周总结 -->
        <div class="sum-wrap">
          <button class="toggle-btn" @click="showSummary = !showSummary">
            {{ showSummary ? '▾' : '▸' }} Week {{ weekInfo.weekNo }} 工作总结
          </button>
          <div v-if="showSummary" class="sum-panel">
            <div class="sum-top">
              <button class="btn-s" :disabled="summaryLoading" @click="genWeekSummary">
                {{ summaryLoading ? '生成中…' : 'AI 生成' }}
              </button>
              <button
                v-if="weekSummary.status !== 'completed'"
                class="btn-p" @click="weekSummary.status='completed'; saveWeekSummary()"
              >封存</button>
              <button v-else class="btn-s" @click="weekSummary.status='draft'; saveWeekSummary()">重开</button>
            </div>
            <p v-if="summaryError" class="err-txt">{{ summaryError }}</p>
            <div v-if="weekSummary.status === 'completed'" class="sum-view">
              <div v-if="weekSummary.work" class="sum-item">
                <div class="sum-lbl">工作内容</div>
                <div class="sum-body">{{ weekSummary.work }}</div>
              </div>
              <div v-if="weekSummary.feeling" class="sum-item">
                <div class="sum-lbl">感受</div>
                <div class="sum-body">{{ weekSummary.feeling }}</div>
              </div>
            </div>
            <template v-else>
              <div class="sum-field">
                <div class="sum-lbl">工作内容</div>
                <textarea ref="summaryWorkRef" :value="weekSummary.work" @input="onWorkInput" placeholder="本周做了什么…" rows="4"></textarea>
              </div>
              <div class="sum-field">
                <div class="sum-lbl">感受</div>
                <textarea ref="summaryFeelingRef" :value="weekSummary.feeling" @input="onFeelingInput" placeholder="本周感受…" rows="2"></textarea>
              </div>
            </template>
          </div>
        </div>
      </main>

      <!-- ─── 右列：收件箱 ─── -->
      <aside class="dp-inbox">
        <div class="sec-hd" style="margin-bottom:10px">
          <span class="sec-lbl">收件箱</span>
          <span v-if="inboxTasks.length" class="sec-cnt">{{ inboxTasks.length }}</span>
        </div>
        <p v-if="!inboxTasks.length" class="inbox-empty">空的，放心清零</p>
        <div v-else class="inbox-list">
          <div v-for="task in inboxTasks" :key="task.id" class="inbox-row">
            <span class="inbox-title" :title="task.title">{{ task.title }}</span>
            <div class="inbox-acts hov-acts">
              <button @click.stop="assignZone(task.id,'focus')" title="→ 沉浸">◎</button>
              <button @click.stop="assignZone(task.id,'quick')" title="→ 快速">□</button>
              <button @click.stop="assignZone(task.id,'collab')" title="→ 协作">↗</button>
              <button @click.stop="markDone(task.id)" title="直接完成">✓</button>
              <button @click.stop="removeTask(task.id)" class="del" title="删除">×</button>
            </div>
          </div>
        </div>
      </aside>

    </div><!-- end dp-body -->

  </div>
</template>

<style scoped>
/* ── 页面根 ── */
.dp {
  max-width: 1160px;
  margin: 0 auto;
  padding: 28px 24px 60px;
  font-size: 13.5px;
  color: var(--color-text);
  line-height: 1.5;
}

/* ── 顶部栏 ── */
.dp-header {
  display: flex;
  align-items: baseline;
  gap: 20px;
  margin-bottom: 22px;
  flex-wrap: wrap;
}
.dp-today { display: flex; align-items: baseline; gap: 8px; }
.dp-date { font-size: 24px; font-weight: 700; letter-spacing: -0.5px; }
.dp-weekday { font-size: 14px; color: var(--color-text-secondary); }
.dp-week {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: #aaa;
}
.dp-nav {
  background: none;
  border: none;
  cursor: pointer;
  padding: 1px 5px;
  font-size: 15px;
  color: #ccc;
  border-radius: 4px;
  line-height: 1;
}
.dp-nav:hover { background: #f3f4f6; color: var(--color-text); }
.dp-stats { margin-left: 6px; font-size: 11px; color: #ccc; }

/* ── Capture ── */
.dp-capture { margin-bottom: 24px; }
.capture-idle {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 12px;
  border-radius: 7px;
  cursor: text;
  color: #bbb;
  font-size: 13.5px;
  transition: background 0.1s, border-color 0.1s;
  border: 1px dashed transparent;
}
.capture-idle:hover { background: #f9fafb; border-color: #e2e5ed; color: #888; }
.capture-icon { font-size: 16px; line-height: 1; color: var(--color-primary); opacity: 0.7; }
.capture-ta {
  width: 100%;
  border: 1px solid var(--color-border);
  border-radius: 7px;
  padding: 10px 13px;
  font-size: 13.5px;
  line-height: 1.65;
  font-family: inherit;
  background: #fff;
  color: var(--color-text);
  resize: vertical;
}
.capture-ta:focus { outline: none; border-color: var(--color-primary); box-shadow: 0 0 0 3px rgba(79,110,247,0.08); }
.capture-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 7px;
}
.capture-hint { font-size: 11.5px; color: #bbb; }

/* ── 主体布局 ── */
.dp-body {
  display: grid;
  grid-template-columns: 1fr 256px;
  gap: 0 36px;
  align-items: start;
}
.dp-main { display: flex; flex-direction: column; gap: 0; }

/* ── Section ── */
.dp-sec {
  padding-bottom: 28px;
  margin-bottom: 4px;
  border-bottom: 1px solid #f0f1f4;
}
.dp-sec:last-of-type { border-bottom: none; }
.sec-hd { display: flex; align-items: center; gap: 7px; margin-bottom: 14px; }
.sec-lbl {
  font-size: 10.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: #b0b7c3;
}
.sec-cnt { font-size: 10.5px; color: #d0d5de; font-weight: 600; }
.sec-empty { font-size: 12px; color: #d0d5de; padding: 2px 0 6px; }
.sec-add {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 12px;
  color: #ccc;
  padding: 5px 0;
  margin-top: 4px;
  display: block;
}
.sec-add:hover { color: var(--color-text-secondary); }

/* ── Hover actions 通用 ── */
.hov-acts {
  display: none;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}
.hov-acts button {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 12.5px;
  color: #c4c9d4;
  padding: 2px 5px;
  border-radius: 4px;
  line-height: 1;
}
.hov-acts button:hover { color: var(--color-text-secondary); background: #f0f1f4; }
.hov-acts button.del:hover { color: #ef4444; background: #fef2f2; }

/* ── 沉浸 Focus Block ── */
.fb {
  padding: 12px 0 14px 0;
  border-bottom: 1px solid #f5f6f8;
  position: relative;
}
.fb:last-of-type { border-bottom: none; }
.fb:hover .hov-acts { display: flex; }
/* ── 拖拽手柄 ── */
.drag-handle {
  cursor: grab;
  color: #d8dce4;
  font-size: 13px;
  flex-shrink: 0;
  user-select: none;
  padding: 0 1px;
  line-height: 1;
  margin-top: 2px;
}
.drag-handle:hover { color: #9ca3af; }
.drag-ghost { opacity: 0.35; background: var(--color-primary-light) !important; border-radius: 6px; }

.fb-hd {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 5px;
}
.fb-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1.5px solid #c8ccd4;
  background: transparent;
  cursor: pointer;
  flex-shrink: 0;
  margin-top: 3px;
  transition: border-color 0.15s, background 0.15s;
}
.fb-dot:hover { border-color: var(--color-primary); background: var(--color-primary-light); }
.fb-title {
  font-size: 14.5px;
  font-weight: 600;
  color: var(--color-text);
  flex: 1;
  line-height: 1.4;
  cursor: text;
  word-break: break-word;
}
.fb-title-inp { font-size: 14.5px; font-weight: 600; flex: 1; }
.fb-num {
  font-size: 10px;
  font-weight: 700;
  color: #d0d5de;
  flex-shrink: 0;
  min-width: 14px;
  text-align: right;
  user-select: none;
  margin-top: 3px;
  line-height: 1.4;
}
.fb-meta {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-shrink: 0;
  flex-wrap: wrap;
  margin-top: 2px;
}
/* DDL */
.fb-due {
  font-size: 11.5px;
  color: #9ca3af;
  cursor: text;
  white-space: nowrap;
}
.fb-due:hover { color: var(--color-text); }
.fb-due-over { color: #d97706 !important; font-weight: 600; }
.fb-due-ph { font-size: 11.5px; color: #d8dce4; cursor: pointer; }
.fb-due-ph:hover { color: #9ca3af; }
.due-inp { width: 124px; font-size: 12px; }
.fb-prog { font-size: 11px; color: #b0b7c3; white-space: nowrap; }

.fb-goal-row { padding-left: 23px; margin-bottom: 9px; }
.fb-goal { font-size: 12.5px; color: #9ca3af; cursor: text; line-height: 1.5; }
.fb-goal:hover { color: var(--color-text); }
.fb-goal-ph { font-size: 12.5px; color: #d8dce4; cursor: pointer; }
.fb-goal-ph:hover { color: #9ca3af; }
.fb-goal-inp { font-size: 12.5px; width: 100%; }

/* ── 子步骤 ── */
.sub-list { padding-left: 23px; }
.sub-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 27px;
  padding: 1px 0;
  cursor: default;
}
.sub-row:hover .sub-del { opacity: 1; }
.sub-ck {
  flex-shrink: 0;
  width: 13px;
  height: 13px;
  cursor: pointer;
  accent-color: var(--color-primary);
}
.sub-ck-ph { width: 13px; flex-shrink: 0; }
.sub-text { font-size: 13px; flex: 1; line-height: 1.4; }
.sub-done .sub-text { text-decoration: line-through; color: #c4c9d4; }
.sub-del {
  background: none;
  border: none;
  cursor: pointer;
  color: #d0d5de;
  font-size: 14px;
  padding: 0 3px;
  line-height: 1;
  opacity: 0;
  flex-shrink: 0;
}
.sub-del:hover { color: #ef4444; }
.sub-inp-row { align-items: center; gap: 6px; }
.sub-inp { flex: 1; font-size: 13px; }
.sub-add {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 12px;
  color: #d0d5de;
  padding: 3px 0;
  display: block;
  margin-top: 2px;
  text-align: left;
}
.sub-add:hover { color: #9ca3af; }

/* ── 快速任务 ── */
.qk-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  padding: 1px 4px;
  border-radius: 5px;
}
.qk-row:hover { background: #f9fafb; }
.qk-row:hover .hov-acts { display: flex; }
.qk-handle { margin-top: 0; }
.qk-num {
  font-size: 10px;
  font-weight: 700;
  color: #d0d5de;
  flex-shrink: 0;
  min-width: 13px;
  text-align: right;
  user-select: none;
}
.qk-ck { flex-shrink: 0; width: 14px; height: 14px; cursor: pointer; accent-color: var(--color-primary); }
.qk-title { flex: 1; font-size: 13.5px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qk-inp { flex: 1; font-size: 13.5px; }
.qk-acts { margin-left: auto; }

/* ── 协作表格 ── */
.ct-hd, .ct-row {
  display: grid;
  grid-template-columns: 16px 1fr 76px 100px 52px 60px;
  gap: 8px;
  align-items: center;
  min-height: 34px;
  padding: 0 5px;
  border-radius: 4px;
}
.ct-handle {
  color: #c8cdd9;
  font-size: 13px;
  cursor: grab;
  user-select: none;
  line-height: 1;
}
.ct-handle:hover { color: #8891a7; }
.ct-hd {
  font-size: 10.5px;
  color: #c0c5cf;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 1px solid #f0f1f4;
  margin-bottom: 2px;
  padding-bottom: 6px;
  min-height: unset;
  border-radius: 0;
}
.ct-row:hover { background: #f9fafb; }
.ct-row:hover .hov-acts { display: flex; }
.ct-due { background: #fffbf3; }
.ct-due:hover { background: #fef6e4; }
.ct-cell { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: text; }
.ct-cell:hover { text-decoration: underline; text-decoration-color: #e0e3ea; }
.ct-empty { color: #d0d5de; cursor: pointer; }
.ct-date-due { color: #d97706 !important; font-weight: 600; }
.ct-inp { font-size: 13px; width: 100%; min-width: 0; }

/* ── 内联编辑通用 ── */
.editable { cursor: text; }
.il-inp {
  border: 1px solid var(--color-primary);
  border-radius: 4px;
  padding: 2px 7px;
  font-family: inherit;
  background: #fff;
  color: var(--color-text);
  outline: none;
  box-shadow: 0 0 0 2px rgba(79,110,247,0.1);
}
.il-add { display: flex; align-items: center; gap: 7px; margin-top: 8px; padding: 4px 0; }
.il-add-inp { flex: 1; font-size: 13.5px; }

/* ── 标签 ── */
.tag {
  font-size: 11px;
  background: #f3f4f6;
  color: #9ca3af;
  padding: 1px 7px;
  border-radius: 4px;
  flex-shrink: 0;
  white-space: nowrap;
}
.tag-sm { font-size: 10.5px; }

/* ── 已完成列表 ── */
.done-wrap, .sum-wrap { margin-top: 8px; margin-bottom: 6px; }
.toggle-btn {
  background: none;
  border: none;
  font-size: 12px;
  color: #c0c5cf;
  cursor: pointer;
  padding: 4px 0;
  font-weight: 600;
}
.toggle-btn:hover { color: var(--color-text-secondary); }
.done-list { margin-top: 5px; }
.done-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 29px;
  padding: 1px 5px;
  border-radius: 4px;
}
.done-row:hover { background: #f9fafb; }
.done-row:hover .hov-acts { display: flex; }
.done-ck { font-size: 11px; color: #c4c9d4; flex-shrink: 0; }
.done-title { flex: 1; font-size: 13px; color: #c4c9d4; text-decoration: line-through; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.done-date { font-size: 11px; color: #d8dce4; flex-shrink: 0; }

/* ── 周总结 ── */
.sum-panel {
  margin-top: 10px;
  background: #f9fafb;
  border-radius: 7px;
  padding: 14px 16px;
}
.sum-top { display: flex; justify-content: flex-end; gap: 7px; margin-bottom: 12px; }
.sum-field { margin-bottom: 11px; }
.sum-lbl {
  font-size: 10.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #b0b7c3;
  margin-bottom: 5px;
}
.sum-view { display: flex; flex-direction: column; gap: 10px; }
.sum-item { padding: 8px 10px; background: #fff; border-radius: 6px; }
.sum-body { font-size: 13px; line-height: 1.7; white-space: pre-wrap; }
.err-txt { font-size: 12px; color: #ef4444; margin-bottom: 8px; }

/* ── 收件箱 ── */
.dp-inbox {
  background: #f7f8fa;
  border-radius: 9px;
  padding: 14px 14px 12px;
  position: sticky;
  top: 16px;
  max-height: calc(100vh - 80px);
  overflow-y: auto;
}
.inbox-empty { font-size: 12px; color: #d0d5de; padding: 4px 0; }
.inbox-list { display: flex; flex-direction: column; gap: 1px; }
.inbox-row {
  display: flex;
  align-items: center;
  gap: 5px;
  min-height: 31px;
  padding: 2px 5px;
  border-radius: 5px;
}
.inbox-row:hover { background: #eef0f3; }
.inbox-row:hover .hov-acts { display: flex; }
.inbox-title {
  flex: 1;
  font-size: 12.5px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text);
}
.inbox-acts { gap: 1px; }
.inbox-acts button { font-size: 11.5px; padding: 2px 4px; }

/* ── 按钮 ── */
.btn-p {
  background: var(--color-primary);
  color: #fff;
  border: none;
  border-radius: 5px;
  padding: 5px 12px;
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
}
.btn-p:hover { opacity: 0.88; }
.btn-p:disabled { opacity: 0.45; cursor: default; }
.btn-s {
  background: #fff;
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border);
  border-radius: 5px;
  padding: 5px 12px;
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
}
.btn-s:hover { background: #f3f4f6; }
.btn-s:disabled { opacity: 0.5; cursor: default; }
.btn-xs {
  background: none;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 11px;
  cursor: pointer;
  color: var(--color-text-secondary);
}
.btn-xs:hover { background: #f0f1f4; }

/* ── 响应式 ── */
@media (max-width: 780px) {
  .dp { padding: 18px 14px 50px; }
  .dp-body { grid-template-columns: 1fr; }
  .dp-inbox { position: static; max-height: none; margin-top: 28px; }
  .ct-hd, .ct-row { grid-template-columns: 16px 1fr 52px 50px; }
  .ct-hd span:nth-child(3), .ct-hd span:nth-child(4),
  .ct-row > *:nth-child(3), .ct-row > *:nth-child(4) { display: none; }
}
@media (max-width: 480px) {
  .dp-date { font-size: 20px; }
  .fb-meta { display: none; }
  .fb:hover .fb-meta { display: flex; }
}
</style>
