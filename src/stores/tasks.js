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
        status: 'todo',
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
      this.items[idx] = { ...this.items[idx], ...changes, updated_at: new Date().toISOString() }
      persistTasks(this.items)
      syncUpdate('tasks', id, { ...changes, updated_at: this.items[idx].updated_at })
    },

    remove(id) {
      this.items = this.items.filter(t => t.id !== id)
      persistTasks(this.items)
      syncDelete('tasks', id)
    },

    saveWeekReview(weekKey, content) {
      this.weekReviews[weekKey] = content
      persistReviews(this.weekReviews)
      // 先查再写，不依赖 UNIQUE(user_id, week_label) DB 约束
      syncWeekReview(weekKey, content)
    },

    getWeekReview(weekKey) {
      return this.weekReviews[weekKey] || ''
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
      } else if (tasks.length) {
        this.items = tasks
      }

      // --- week_reviews ---
      const { data: reviews, error: rErr } = await supabase
        .from('week_reviews')
        .select('*')
        .eq('user_id', userId)

      if (rErr) {
        console.error('[cloud] week_reviews fetch error:', rErr.message)
      } else if (reviews.length) {
        const reviewMap = {}
        reviews.forEach(r => { reviewMap[r.week_label] = r.content })
        this.weekReviews = reviewMap
      }
    },
  },
})
