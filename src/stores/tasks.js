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
        completed_at: null, // v2-final 冻结字段
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      this.items.unshift(task)
      persistTasks(this.items)
      syncCreate('tasks', task)
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
      syncUpdate('tasks', id, { ...changes, updated_at: this.items[idx].updated_at })
    },

    remove(id) {
      this.items = this.items.filter(t => t.id !== id)
      persistTasks(this.items)
      syncDelete('tasks', id)
    },

    saveWeekReview(weekKey, data) {
      this.weekReviews[weekKey] = data
      persistReviews(this.weekReviews)
      // 云端 content 字段存 JSON 字符串以兼容旧 schema
      syncWeekReview(weekKey, JSON.stringify(data))
    },

    getWeekReview(weekKey) {
      const stored = this.weekReviews[weekKey]
      if (!stored) return { work: '', feeling: '', status: 'draft' }
      // 向下兼容旧版纯字符串格式
      if (typeof stored === 'string') return { work: stored, feeling: '', status: 'draft' }
      return { work: '', feeling: '', status: 'draft', ...stored }
    },

    // -- 云端只读初始化（Step 3）--
    async initFromCloud(userId) {
      // --- tasks ---
      const { data: tasks, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('user_id', userId)

      if (error) {
        console.error('[cloud] tasks fetch error:', error.message)
      } else {
        // 无论云端是否为空，都以云端为权威来源覆盖本地
        // 防止新设备首次登录时看到 seed/测试数据
        this.items = tasks
        persistTasks(tasks)
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
            // 旧版纯字符串内容，迁移为新格式
            reviewMap[r.week_label] = { work: r.content, feeling: '', status: 'draft' }
          }
        })
        this.weekReviews = reviewMap
        persistReviews(reviewMap)
      }
    },
  },
})
