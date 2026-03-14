import { defineStore } from 'pinia'
import { getAll, save } from '../data/adapters/index.js'

const KEY = 'work_tags'

export const useTagsStore = defineStore('tags', {
  state: () => ({
    // flat list of custom tags: { id, name, type:'custom', scope_type:'library'|'project', scope_id:string }
    items: [],
  }),

  actions: {
    init() {
      const stored = getAll(KEY)
      if (stored !== null) {
        this.items = stored
      } else {
        this.items = []
        this._persist()
      }
    },

    // Returns custom tags for a given scope
    getCustomTags(scopeType, scopeId) {
      return this.items.filter(
        t => t.scope_type === scopeType && String(t.scope_id) === String(scopeId)
      )
    },

    // Add a new custom tag; returns null if dedup fails or validation fails
    addCustomTag(name, scopeType, scopeId) {
      const trimmed = name.trim()
      if (trimmed.length < 2 || trimmed.length > 20) return null

      // Case-insensitive dedup within same scope
      const exists = this.items.some(
        t =>
          t.scope_type === scopeType &&
          String(t.scope_id) === String(scopeId) &&
          t.name.toLowerCase() === trimmed.toLowerCase()
      )
      if (exists) return null

      const tag = {
        id: Date.now(),
        name: trimmed,
        type: 'custom',
        scope_type: scopeType,
        scope_id: String(scopeId),
        created_at: new Date().toISOString(),
      }
      this.items.push(tag)
      this._persist()
      return tag
    },

    remove(id) {
      this.items = this.items.filter(t => t.id !== id)
      this._persist()
    },

    _persist() {
      save(KEY, JSON.parse(JSON.stringify(this.items)))
    },
  },
})
