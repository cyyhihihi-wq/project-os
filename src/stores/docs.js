import { defineStore } from 'pinia'
import { loadDocs, persistDocs } from '../data/repositories/docsRepository.js'
import { supabase } from '../lib/supabase.js'
import { syncCreate, syncUpdate, syncDelete } from '../lib/cloudSync.js'

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
      // 阶段性用 date，周期性用 period_end；无标记日期时降级到 updated_at
      const key = (d) => {
        const marked = d.type === 'milestone'
          ? (d.date || '')
          : (d.period_end || d.period_start || '')
        return marked || d.updated_at || d.created_at || ''
      }
      return key(b).localeCompare(key(a))
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
        date: data.date || '',
        period_type: data.period_type || 'monthly',
        period_start: data.period_start || '',
        period_end: data.period_end || '',
        project_id: data.project_id || null,
        project: data.project || '',
        content: data.content || '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      this.items.unshift(doc)
      persistDocs(this.items)
      syncCreate('docs', doc)
      return doc
    },

    update(id, changes) {
      const idx = this.items.findIndex(d => d.id === id)
      if (idx === -1) return
      const updated_at = new Date().toISOString()
      this.items[idx] = { ...this.items[idx], ...changes, updated_at }
      persistDocs(this.items)
      syncUpdate('docs', id, { ...changes, updated_at })
    },

    remove(id) {
      this.items = this.items.filter(d => d.id !== id)
      persistDocs(this.items)
      syncDelete('docs', id)
    },

    async initFromCloud(userId) {
      const { data, error } = await supabase
        .from('docs')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })

      if (error) {
        console.error('[cloud] docs fetch error:', error.message)
        return
      }
      if (!data.length) return

      this.items = data
      persistDocs(this.items)
    },
  },
})
