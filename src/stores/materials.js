import { defineStore } from 'pinia'
import { getAll, save } from '../data/adapters/index.js'
import { supabase } from '../lib/supabase.js'
import { syncCreate, syncUpdate, syncDelete } from '../lib/cloudSync.js'

const KEY = 'work_materials'

export const useMaterialsStore = defineStore('materials', {
  state: () => ({
    items: [],
  }),

  actions: {
    init() {
      const stored = getAll(KEY)
      this.items = stored || []
    },

    add(data) {
      const material = {
        id: crypto.randomUUID(),
        title: data.title,
        type: data.type || '快速记录',
        raw_content: data.raw_content || '',
        ai_summary: data.ai_summary || '',
        tags: data.tags || [],
        project: data.project || '',
        project_id: data.project_id || null,
        file_name: data.file_name || '',
        file_type: data.file_type || '',
        created_at: data.created_at || new Date().toISOString(),
      }
      this.items.unshift(material)
      this._persist()
      syncCreate('materials', material)
      return material
    },

    update(id, changes) {
      const idx = this.items.findIndex(m => m.id === id)
      if (idx === -1) return
      this.items[idx] = { ...this.items[idx], ...changes }
      this._persist()
      syncUpdate('materials', id, changes)
    },

    remove(id) {
      this.items = this.items.filter(m => m.id !== id)
      this._persist()
      syncDelete('materials', id)
    },

    // -- 云端只读初始化（Step 3）--
    async initFromCloud(userId) {
      const { data: materials, error } = await supabase
        .from('materials')
        .select('*')
        .eq('user_id', userId)

      if (error) {
        console.error('[cloud] materials fetch error:', error.message)
        return
      }

      // 无论云端是否为空，都以云端为权威来源覆盖本地
      this.items = materials
      this._persist()
    },

    _persist() {
      save(KEY, JSON.parse(JSON.stringify(this.items)))
    },
  },
})
