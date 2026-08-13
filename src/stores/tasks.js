import { defineStore } from 'pinia'
import {
  loadTasks,
  persistTasks,
  loadReviews,
  persistReviews,
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

/** 从 changes 中提取仅本地存储的字段（不同步到云端） */
function splitCloudFields(changes) {
  const { focus_subtasks, focus_time_start, focus_time_end, focus_goal,
          collab_owner, collab_status, collab_next_check, mode, ...cloud } = changes
  return cloud
}

export const useTasksStore = defineStore('tasks', {
  state: () => ({
    items: [],
    weekReviews: {},
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
      // 云端只同步基础字段
      const { focus_subtasks, focus_time_start, focus_time_end, focus_goal,
              collab_owner, collab_status, collab_next_check, mode, ...cloudTask } = task
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
        const localById = {}
        for (const t of this.items) localById[t.id] = t

        this.items = tasks.map(t => {
          const local = localById[t.id]
          return withDefaults({
            ...t,
            // 从本地恢复云端不存储的字段
            mode: local?.mode || 'inbox',
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
