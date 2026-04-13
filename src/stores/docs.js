import { defineStore } from 'pinia'
import { loadDocs, persistDocs } from '../data/repositories/docsRepository.js'

// 周期类型标签
export const PERIOD_LABELS = {
  weekly: '周报',
  biweekly: '双周报',
  monthly: '月报',
}

export const useDocsStore = defineStore('docs', {
  state: () => ({
    items: [],
  }),

  getters: {
    sorted: (state) => [...state.items].sort((a, b) => {
      // 阶段性用 date，周期性用 period_end（都降序）
      const da = a.type === 'milestone' ? (a.date || '') : (a.period_end || a.period_start || '')
      const db = b.type === 'milestone' ? (b.date || '') : (b.period_end || b.period_start || '')
      return db.localeCompare(da)
    }),

    // 给定日期范围，自动匹配周期性文档
    matchPeriodic: (state) => (start, end) => {
      return state.items.filter(d => {
        if (d.type !== 'periodic') return false
        // 无日期筛选时全部匹配
        if (!start && !end) return true
        // 区间重叠：doc.period_start <= end && doc.period_end >= start
        const ds = d.period_start || ''
        const de = d.period_end || d.period_start || ''
        if (end && ds > end) return false
        if (start && de < start) return false
        return true
      })
    },

    milestones: (state) => state.items.filter(d => d.type === 'milestone'),
  },

  actions: {
    init() {
      this.items = loadDocs()
    },

    add(data) {
      const doc = {
        id: crypto.randomUUID(),
        title: data.title?.trim() || '未命名文档',
        type: data.type || 'milestone',
        // 阶段性
        date: data.date || '',
        // 周期性
        period_type: data.period_type || 'monthly',
        period_start: data.period_start || '',
        period_end: data.period_end || '',
        // 可选关联专项
        project_id: data.project_id || null,
        project: data.project || '',
        // 内容
        content: data.content || '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      this.items.unshift(doc)
      persistDocs(this.items)
      return doc
    },

    update(id, changes) {
      const idx = this.items.findIndex(d => d.id === id)
      if (idx === -1) return
      this.items[idx] = {
        ...this.items[idx],
        ...changes,
        updated_at: new Date().toISOString(),
      }
      persistDocs(this.items)
    },

    remove(id) {
      this.items = this.items.filter(d => d.id !== id)
      persistDocs(this.items)
    },
  },
})
