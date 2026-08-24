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
import { syncCreate, syncUpdate, syncDelete, syncWeekReview } from '../lib/cloudSync.js'


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
 *  注：mode 已同步到云端（tasks.mode 列），不再排除
 */
function splitCloudFields(changes) {
  const { focus_subtasks, focus_time_start, focus_time_end, focus_goal,
          collab_owner, collab_status, collab_next_check, ...cloud } = changes
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
      // 云端同步（mode 现在也同步，其余本地专属字段仍排除）
      const { focus_subtasks, focus_time_start, focus_time_end, focus_goal,
              collab_owner, collab_status, collab_next_check, ...cloudTask } = task
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
    },

    removeFocusSubtask(taskId, subtaskId) {
      const t = this.items.find(t => t.id === taskId)
      if (!t) return
      t.focus_subtasks = (t.focus_subtasks || []).filter(s => s.id !== subtaskId)
      t.updated_at = new Date().toISOString()
      persistTasks(this.items)
    },

    updateFocusSubtask(taskId, subtaskId, newText) {
      const t = this.items.find(t => t.id === taskId)
      if (!t) return
      const s = (t.focus_subtasks || []).find(s => s.id === subtaskId)
      if (!s || !newText.trim()) return
      s.text = newText.trim()
      t.updated_at = new Date().toISOString()
      persistTasks(this.items)
    },

    // ── 周重点工作便签 ──

    saveWeekFocusNote(weekKey, text) {
      this.weekFocusNotes[weekKey] = text
      persistFocusNotes(this.weekFocusNotes)
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
          // 优先级：云端 mode（最可靠，跨设备同步）> modesMap > localById > 默认 inbox
          const savedMode = t.mode || modesMap[t.id] || local?.mode || 'inbox'
          return withDefaults({
            ...t,
            // 从本地恢复云端不存储的字段
            mode: savedMode,
            focus_subtasks: local?.focus_subtasks || [],
            focus_time_start: local?.focus_time_start || '',
            focus_time_end: local?.focus_time_end || '',
            focus_goal: local?.focus_goal || '',
            collab_owner: local?.collab_owner || '',
            collab_status: local?.collab_status || '',
            collab_next_check: local?.collab_next_check || '',
            // 迁移旧状态
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
    },
  },
})
