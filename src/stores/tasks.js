import { defineStore } from 'pinia'
import {
  loadTasks,
  persistTasks,
  loadReviews,
  persistReviews,
  loadModesMap,
  loadFocusNotes,
  persistFocusNotes,
} from '../data/repositories/taskRepository.js'
import { supabase } from '../lib/supabase.js'
import { syncCreate, syncUpdate, syncDelete, syncWeekReview, syncWeekFocusNote } from '../lib/cloudSync.js'


/** 迁移：确保 task 对象包含所有新字段的默认值 */
function withDefaults(t) {
  return {
    mode: 'inbox',          // 'inbox' | 'focus' | 'quick' | 'collab'
    focus_time_start: '',
    focus_time_end: '',
    focus_goal: '',
    focus_subtasks: [],     // [{id, text, done}]
    collab_owner: '',
    collab_status: '',
    collab_next_check: '',
    ...t,
  }
}

/** 从 changes 中提取仅本地存储的字段（不同步到云端）
 *  focus_time_start / focus_time_end 是已废弃的 UI 字段，保持本地存储即可。
 *  其余字段（mode / focus_goal / focus_subtasks / collab_* 等）全部同步到云端。
 */
function splitCloudFields(changes) {
  const { focus_time_start, focus_time_end, ...cloud } = changes
  return cloud
}

export const useTasksStore = defineStore('tasks', {
  state: () => ({
    items: [],
    weekReviews: {},
    weekFocusNotes: {},
  }),

  getters: {
    byStatus: (state) => (status) => state.items.filter(t => t.status === status),
    byProject: (state) => (projectId, projectName) =>
      state.items.filter(t =>
        t.project_id
          ? t.project_id === projectId
          : (projectName && t.project === projectName)
      ),
    projectNames: (state) => [...new Set(state.items.map(t => t.project).filter(Boolean))],

    // 按工作区分组（未完成）
    inboxTasks: (state) => state.items.filter(t => t.mode === 'inbox' && t.status !== 'done'),
    focusTasks: (state) => state.items.filter(t => t.mode === 'focus' && t.status !== 'done'),
    quickTasks: (state) => state.items.filter(t => t.mode === 'quick' && t.status !== 'done'),
    collabTasks: (state) => state.items.filter(t => t.mode === 'collab' && t.status !== 'done'),
  },

  actions: {
    init() {
      const stored = loadTasks()
      // 迁移：给旧任务补齐新字段默认值；旧 waiting/todo 状态归入 doing
      this.items = (stored || []).map(t => {
        const migrated = withDefaults(t)
        // 旧 waiting 任务 → collab 区，状态改为 doing
        if (migrated.status === 'waiting') {
          migrated.status = 'doing'
          if (migrated.mode === 'inbox') migrated.mode = 'collab'
        }
        if (migrated.status === 'todo') {
          migrated.status = 'doing'
        }
        return migrated
      })
      this.weekReviews = loadReviews()
      this.weekFocusNotes = loadFocusNotes()
    },

    add(data) {
      const task = withDefaults({
        id: crypto.randomUUID(),
        title: data.title,
        mode: data.mode || 'inbox',
        status: 'doing',
        project: data.project || '',
        project_id: data.project_id || null,
        note: '',
        priority: data.priority || '',
        due: data.due || '',
        week: data.week || 0,
        completed_at: null,
        focus_time_start: data.focus_time_start || '',
        focus_time_end: data.focus_time_end || '',
        focus_goal: data.focus_goal || '',
        focus_subtasks: data.focus_subtasks || [],
        collab_owner: data.collab_owner || '',
        collab_status: data.collab_status || '',
        collab_next_check: data.collab_next_check || '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      this.items.unshift(task)
      persistTasks(this.items)
      // 云端同步（只排除已废弃的时间字段）
      const { focus_time_start, focus_time_end, ...cloudTask } = task
      syncCreate('tasks', cloudTask)
      return task
    },

    /** 批量从文本行创建任务（Capture 区） */
    batchCreate(titles, extraData = {}) {
      const created = []
      for (const raw of titles) {
        const title = raw.trim()
        if (!title) continue
        const task = this.add({ title, mode: 'inbox', ...extraData })
        created.push(task)
      }
      return created
    },

    update(id, changes) {
      const idx = this.items.findIndex(t => t.id === id)
      if (idx === -1) return
      const current = this.items[idx]
      if ('status' in changes) {
        if (changes.status === 'done' && current.status !== 'done') {
          changes = { ...changes, completed_at: new Date().toISOString() }
        } else if (changes.status !== 'done' && current.status === 'done') {
          changes = { ...changes, completed_at: null }
        }
      }
      this.items[idx] = { ...current, ...changes, updated_at: new Date().toISOString() }
      persistTasks(this.items)
      // 云端不同步本地专属字段
      const cloudChanges = splitCloudFields({ ...changes, updated_at: this.items[idx].updated_at })
      if (Object.keys(cloudChanges).length > 1) {
        syncUpdate('tasks', id, cloudChanges)
      }
    },

    remove(id) {
      this.items = this.items.filter(t => t.id !== id)
      persistTasks(this.items)
      syncDelete('tasks', id)
    },

    /** 拖拽排序：传入某 mode 下的新顺序（未完成任务数组），更新全局 items 中该 mode 的顺序 */
    reorder(mode, newItems) {
      const newIds = new Set(newItems.map(t => t.id))
      const others = this.items.filter(t => !newIds.has(t.id))
      this.items = [...newItems, ...others]
      persistTasks(this.items)
    },

    // ── Focus 子任务操作 ──

    addFocusSubtask(taskId, text) {
      const t = this.items.find(t => t.id === taskId)
      if (!t || !text.trim()) return null
      const sub = { id: crypto.randomUUID(), text: text.trim(), done: false }
      if (!t.focus_subtasks) t.focus_subtasks = []
      t.focus_subtasks.push(sub)
      t.updated_at = new Date().toISOString()
      persistTasks(this.items)
      syncUpdate('tasks', taskId, { focus_subtasks: t.focus_subtasks, updated_at: t.updated_at })
      return sub
    },

    toggleFocusSubtask(taskId, subtaskId) {
      const t = this.items.find(t => t.id === taskId)
      if (!t) return
      const s = (t.focus_subtasks || []).find(s => s.id === subtaskId)
      if (!s) return
      s.done = !s.done
      t.updated_at = new Date().toISOString()
      persistTasks(this.items)
      syncUpdate('tasks', taskId, { focus_subtasks: t.focus_subtasks, updated_at: t.updated_at })
    },

    removeFocusSubtask(taskId, subtaskId) {
      const t = this.items.find(t => t.id === taskId)
      if (!t) return
      t.focus_subtasks = (t.focus_subtasks || []).filter(s => s.id !== subtaskId)
      t.updated_at = new Date().toISOString()
      persistTasks(this.items)
      syncUpdate('tasks', taskId, { focus_subtasks: t.focus_subtasks, updated_at: t.updated_at })
    },

    updateFocusSubtask(taskId, subtaskId, newText) {
      const t = this.items.find(t => t.id === taskId)
      if (!t) return
      const s = (t.focus_subtasks || []).find(s => s.id === subtaskId)
      if (!s || !newText.trim()) return
      s.text = newText.trim()
      t.updated_at = new Date().toISOString()
      persistTasks(this.items)
      syncUpdate('tasks', taskId, { focus_subtasks: t.focus_subtasks, updated_at: t.updated_at })
    },

    // ── 周重点工作便签 ──

    saveWeekFocusNote(weekKey, text) {
      this.weekFocusNotes[weekKey] = text
      persistFocusNotes(this.weekFocusNotes)
      syncWeekFocusNote(weekKey, text)
    },

    getWeekFocusNote(weekKey) {
      return this.weekFocusNotes[weekKey] || ''
    },

    // ── 周总结 ──

    saveWeekReview(weekKey, data) {
      this.weekReviews[weekKey] = data
      persistReviews(this.weekReviews)
      syncWeekReview(weekKey, JSON.stringify(data))
    },

    getWeekReview(weekKey) {
      const stored = this.weekReviews[weekKey]
      if (!stored) return { work: '', feeling: '', status: 'draft' }
      if (typeof stored === 'string') return { work: stored, feeling: '', status: 'draft' }
      return { work: '', feeling: '', status: 'draft', ...stored }
    },

    // ── 云端同步初始化 ──

    async initFromCloud(userId) {
      const { data: tasks, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('user_id', userId)

      if (error) {
        console.error('[cloud] tasks fetch error:', error.message)
      } else {
        // localById：来自 init() 加载的本地数据（有 mode 等本地字段）
        const localById = {}
        for (const t of this.items) localById[t.id] = t

        // ⭐ 保存本地排序位置——init() 已按用户拖拽后的顺序加载好了，
        //    必须在覆盖 this.items 之前先记下来，否则刷新后顺序丢失
        const localOrderMap = {}
        this.items.forEach((t, i) => { localOrderMap[t.id] = i })

        // modesMap：独立持久化的 taskId→mode 映射，是 mode 的最终权威来源
        const modesMap = loadModesMap()

        const merged = tasks.map(t => {
          const local = localById[t.id]

          // ── mode 合并 ──
          // 云端非 inbox → 以云端为准（其他设备明确设置过）
          // 云端 null/inbox → 优先本地（可能是 DEFAULT 初始值）
          const cloudMode = t.mode && t.mode !== 'inbox' ? t.mode : null
          const localMode = modesMap[t.id] || local?.mode || null
          const savedMode = cloudMode || localMode || 'inbox'

          // ── 其他字段合并：云端有值优先，否则用本地 ──
          const savedFocusGoal      = t.focus_goal      != null ? t.focus_goal      : (local?.focus_goal      || '')
          const savedFocusSubtasks  = t.focus_subtasks  != null ? t.focus_subtasks  : (local?.focus_subtasks  || [])
          const savedCollabOwner    = t.collab_owner    != null ? t.collab_owner    : (local?.collab_owner    || '')
          const savedCollabStatus   = t.collab_status   != null ? t.collab_status   : (local?.collab_status   || '')
          const savedCollabNextCheck= t.collab_next_check != null ? t.collab_next_check : (local?.collab_next_check || '')

          // ⭐ 愈合同步：云端字段为 null（列刚添加），但本地有数据 → 一次性推送到云端
          const heal = {}
          if (!cloudMode && localMode && localMode !== 'inbox')          heal.mode = localMode
          if (t.focus_goal      == null && savedFocusGoal)               heal.focus_goal = savedFocusGoal
          if (t.focus_subtasks  == null && savedFocusSubtasks.length)    heal.focus_subtasks = savedFocusSubtasks
          if (t.collab_owner    == null && savedCollabOwner)             heal.collab_owner = savedCollabOwner
          if (t.collab_status   == null && savedCollabStatus)            heal.collab_status = savedCollabStatus
          if (t.collab_next_check == null && savedCollabNextCheck)       heal.collab_next_check = savedCollabNextCheck
          if (Object.keys(heal).length > 0) syncUpdate('tasks', t.id, heal)

          return withDefaults({
            ...t,
            mode: savedMode,
            focus_goal: savedFocusGoal,
            focus_subtasks: savedFocusSubtasks,
            focus_time_start: local?.focus_time_start || '',
            focus_time_end: local?.focus_time_end || '',
            collab_owner: savedCollabOwner,
            collab_status: savedCollabStatus,
            collab_next_check: savedCollabNextCheck,
            status: (t.status === 'waiting' || t.status === 'todo') ? 'doing' : t.status,
          })
        })

        // ⭐ 按本地保存的排序位置重排；云端新增的任务（本地无记录）放到最后
        merged.sort((a, b) => {
          const pa = localOrderMap[a.id] ?? Infinity
          const pb = localOrderMap[b.id] ?? Infinity
          return pa - pb
        })

        this.items = merged
        persistTasks(this.items)
      }

      // week_reviews
      const { data: reviews, error: rErr } = await supabase
        .from('week_reviews')
        .select('*')
        .eq('user_id', userId)

      if (rErr) {
        console.error('[cloud] week_reviews fetch error:', rErr.message)
      } else {
        const reviewMap = {}
        reviews.forEach(r => {
          if (!r.content) {
            reviewMap[r.week_label] = { work: '', feeling: '', status: 'draft' }
            return
          }
          try {
            const parsed = JSON.parse(r.content)
            reviewMap[r.week_label] = typeof parsed === 'object'
              ? parsed
              : { work: r.content, feeling: '', status: 'draft' }
          } catch {
            reviewMap[r.week_label] = { work: r.content, feeling: '', status: 'draft' }
          }
        })
        this.weekReviews = reviewMap
        persistReviews(reviewMap)
      }

      // week_focus_notes（本周重点工作）
      const { data: focusNotes, error: fnErr } = await supabase
        .from('week_focus_notes')
        .select('*')
        .eq('user_id', userId)

      if (fnErr) {
        console.error('[cloud] week_focus_notes fetch error:', fnErr.message)
      } else {
        const noteMap = {}
        focusNotes.forEach(n => {
          noteMap[n.week_label] = n.content || ''
        })
        // 合并：云端有值覆盖本地，本地有但云端无则保留本地
        this.weekFocusNotes = { ...this.weekFocusNotes, ...noteMap }
        persistFocusNotes(this.weekFocusNotes)
      }
    },
  },
})
