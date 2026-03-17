import { defineStore } from 'pinia'
import { getAll, save } from '../data/adapters/index.js'
import { supabase } from '../lib/supabase.js'
import { syncCreate, syncUpdate, syncDelete } from '../lib/cloudSync.js'

const KEY = 'work_styles'

export const useStylesStore = defineStore('styles', {
  state: () => ({
    items: [],
  }),

  actions: {
    init() {
      const stored = getAll(KEY)
      this.items = stored || []
    },

    add(data) {
      const style = {
        id: crypto.randomUUID(),
        name: data.name,
        content: data.content || '',
        summary: data.summary || '',
        file_type: data.file_type || '',
        created_at: new Date().toISOString(),
      }
      this.items.push(style)
      this._persist()
      syncCreate('style_references', style)
      return style
    },

    update(id, changes) {
      const idx = this.items.findIndex(s => s.id === id)
      if (idx === -1) return
      this.items[idx] = { ...this.items[idx], ...changes }
      this._persist()
      syncUpdate('style_references', id, changes)
    },

    remove(id) {
      this.items = this.items.filter(s => s.id !== id)
      this._persist()
      syncDelete('style_references', id)
    },

    // -- 云端只读初始化（Step 3）--
    // v2-final 对应表名为 style_references，非 styles。
    async initFromCloud(userId) {
      const { data: styles, error } = await supabase
        .from('style_references')
        .select('*')
        .eq('user_id', userId)

      if (error) {
        console.error('[cloud] style_references fetch error:', error.message)
        return
      }

      // 无论云端是否为空，都以云端为权威来源覆盖本地
      this.items = styles
      this._persist()
    },

    _persist() {
      save(KEY, JSON.parse(JSON.stringify(this.items)))
    },
  },
})
