import { defineStore } from 'pinia'

const CONTACTS_KEY = 'work_contacts'

export const CONTACT_CATEGORIES = ['团队成员', '数分', '产品', '运营', '媒体', '外部合作']

export const useContactsStore = defineStore('contacts', {
  state: () => ({
    items: [], // [{ id, name, category }]
  }),

  actions: {
    init() {
      try {
        const raw = localStorage.getItem(CONTACTS_KEY)
        this.items = raw ? JSON.parse(raw) : []
      } catch {
        this.items = []
      }
    },

    _persist() {
      localStorage.setItem(CONTACTS_KEY, JSON.stringify(this.items))
    },

    /**
     * 按名字查找，若不存在则自动新建联系人
     * 已存在但缺 category 时，补全 category
     */
    findOrCreate(name, category = '') {
      if (!name?.trim()) return null
      const nameLower = name.trim().toLowerCase()
      const existing = this.items.find(c => c.name.toLowerCase() === nameLower)
      if (existing) {
        if (category && !existing.category) {
          existing.category = category
          this._persist()
        }
        return existing
      }
      const contact = {
        id: crypto.randomUUID(),
        name: name.trim(),
        category: category || '',
      }
      this.items.push(contact)
      this._persist()
      return contact
    },

    /** 前缀模糊匹配，返回建议列表（最多 6 条） */
    suggest(prefix) {
      if (!prefix?.trim()) return []
      const lower = prefix.toLowerCase()
      return this.items
        .filter(c => c.name.toLowerCase().includes(lower))
        .slice(0, 6)
    },

    findByName(name) {
      if (!name?.trim()) return null
      return this.items.find(
        c => c.name.toLowerCase() === name.trim().toLowerCase()
      ) || null
    },

    update(id, changes) {
      const c = this.items.find(c => c.id === id)
      if (!c) return
      Object.assign(c, changes)
      this._persist()
    },

    remove(id) {
      this.items = this.items.filter(c => c.id !== id)
      this._persist()
    },
  },
})
