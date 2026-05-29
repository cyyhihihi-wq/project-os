import { defineStore } from 'pinia'
import {
  loadTasks,
  persistTasks,
  loadReviews,
  persistReviews,
} from '../data/repositories/taskRepository.js'
import { supabase } from '../lib/supabase.js'
import { syncCreate, syncUpdate, syncDelete, syncWeekReview } from '../lib/cloudSync.js'

const TASKS_KEY = 'work_tasks'
const REVIEWS_KEY = 'work_week_reviews'

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
  },

  actions: {
    init() {
      this.items = loadTasks()
      this.weekReviews = loadReviews()
    },

    add(data) {
      const task = {
        id: crypto.randomUUID(),
        title: data.title,
        status: 'doing',
        project: data.project || '',
        project_id: data.project_id || null,
        note: '',
        priority: data.priority || '',
        due: data.due || '',
        week: data.week || 0,
        completed_at: null,
        handoffs: [],          // 接力记录（本地存储，不同步云端）
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      this.items.unshift(task)
      persistTasks(this.items)
      // 云端不同步 handoffs 字段
      const { handoffs, ...cloudTask } = task
      syncCreate('tasks', cloudTask)
      return task
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
      // 不向云端同步 handoffs
      const { handoffs, ...cloudChanges } = { ...changes, updated_at: this.items[idx].updated_at }
      syncUpdate('tasks', id, cloudChanges)
    },

    remove(id) {
      this.items = this.items.filter(t => t.id !== id)
      persistTasks(this.items)
      syncDelete('tasks', id)
    },

    // ── 接力任务：添加移交记录 ──
    addHandoff(taskId, data) {
      const idx = this.items.findIndex(t => t.id === taskId)
      if (idx === -1) return null

      const handoff = {
        id: crypto.randomUUID(),
        assignee: data.assignee || '',
        assignee_category: data.assignee_category || '',
        due: data.due || '',
        hand_note: data.hand_note || '',
        completion_note: '',
        status: 'pending',
        linked_project_id: null,
        linked_update_id: null,
        created_at: new Date().toISOString(),
        completed_at: null,
      }

      if (!this.items[idx].handoffs) this.items[idx].handoffs = []
      this.items[idx].handoffs.push(handoff)
      this.items[idx].status = 'waiting'
      this.items[idx].updated_at = new Date().toISOString()

      persistTasks(this.items)
      // 云端只同步状态变更（不含 handoffs）
      syncUpdate('tasks', taskId, {
        status: 'waiting',
        updated_at: this.items[idx].updated_at,
      })
      return handoff
    },

    // ── 接力任务：验收完成 ──
    completeHandoff(taskId, handoffId, data) {
      const idx = this.items.findIndex(t => t.id === taskId)
      if (idx === -1) return

      const handoffs = this.items[idx].handoffs || []
      const hIdx = handoffs.findIndex(h => h.id === handoffId)
      if (hIdx === -1) return

      const completed_at = new Date().toISOString()

      handoffs[hIdx] = {
        ...handoffs[hIdx],
        completion_note: data.completion_note || '',
        status: 'done',
        linked_project_id: data.linked_project_id || null,
        linked_update_id: data.linked_update_id || null,
        completed_at,
      }

      // next_action 决定任务下一步状态
      let newStatus = 'doing'
      let newCompletedAt = null
      if (data.next_action === 'done') {
        newStatus = 'done'
        newCompletedAt = completed_at
      }
      // 're-handoff' → 状态回到 doing，UI 层紧接着打开移交表单

      this.items[idx].handoffs = handoffs
      this.items[idx].status = newStatus
      this.items[idx].updated_at = new Date().toISOString()
      if (newCompletedAt) this.items[idx].completed_at = newCompletedAt

      persistTasks(this.items)
      syncUpdate('tasks', taskId, {
        status: newStatus,
        updated_at: this.items[idx].updated_at,
        ...(newCompletedAt ? { completed_at: newCompletedAt } : {}),
      })
    },

    // ── 接力任务：取消等待，恢复 doing ──
    cancelWaiting(taskId) {
      const idx = this.items.findIndex(t => t.id === taskId)
      if (idx === -1) return
      const handoffs = this.items[idx].handoffs || []
      // 把最后一条 pending 改为 cancelled
      const pendingIdx = handoffs.findLastIndex ? handoffs.findLastIndex(h => h.status === 'pending') : [...handoffs].reverse().findIndex(h => h.status === 'pending')
      if (pendingIdx !== -1) {
        handoffs[pendingIdx] = { ...handoffs[pendingIdx], status: 'cancelled' }
      }
      this.items[idx].handoffs = handoffs
      this.items[idx].status = 'doing'
      this.items[idx].updated_at = new Date().toISOString()
      persistTasks(this.items)
      syncUpdate('tasks', taskId, {
        status: 'doing',
        updated_at: this.items[idx].updated_at,
      })
    },

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

    async initFromCloud(userId) {
      // --- tasks ---
      const { data: tasks, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('user_id', userId)

      if (error) {
        console.error('[cloud] tasks fetch error:', error.message)
      } else {
        // 合并时保留本地 handoffs（云端无此字段）
        const localById = {}
        for (const t of this.items) localById[t.id] = t

        this.items = tasks.map(t => ({
          ...t,
          handoffs: localById[t.id]?.handoffs || [],
        }))
        persistTasks(this.items)
      }

      // --- week_reviews ---
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
