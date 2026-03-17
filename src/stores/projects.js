import { defineStore } from 'pinia'
import { getAll, save } from '../data/adapters/index.js'
import { supabase } from '../lib/supabase.js'
import { syncCreate, syncUpdate, syncDelete } from '../lib/cloudSync.js'

const KEY = 'work_projects'

export const useProjectsStore = defineStore('projects', {
  state: () => ({
    items: [],
  }),

  getters: {
    names: (state) => state.items.map(p => p.name),
    getById: (state) => (id) => state.items.find(p => p.id === id) || null,
  },

  actions: {
    init() {
      const stored = getAll(KEY)
      this.items = stored || []
    },

    add(data) {
      const project = {
        id: crypto.randomUUID(),
        name: data.name,
        status: 'active',
        judgements: [],
        updates: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      this.items.push(project)
      this._persist()
      // 双写：只同步 projects 表字段，子表通过各自操作写入
      syncCreate('projects', {
        id: project.id,
        name: project.name,
        status: project.status,
        created_at: project.created_at,
        updated_at: project.updated_at,
      })
      return project
    },

    update(id, changes) {
      const p = this.items.find(p => p.id === id)
      if (!p) return
      Object.assign(p, changes, { updated_at: new Date().toISOString() })
      this._persist()
      // judgements / updates 是嵌套数组，不写入 projects 表
      const { judgements, updates, ...cloudChanges } = changes
      syncUpdate('projects', id, { ...cloudChanges, updated_at: p.updated_at })
    },

    remove(id) {
      this.items = this.items.filter(p => p.id !== id)
      this._persist()
      syncDelete('projects', id)
    },

    // -- Judgement operations --

    getJudgements(projectId) {
      const p = this.items.find(p => p.id === projectId)
      return p ? p.judgements : []
    },

    addJudgement(projectId, content, createdAt = null) {
      const p = this.items.find(p => p.id === projectId)
      if (!p) return null
      const j = {
        id: crypto.randomUUID(),
        content,
        created_at: createdAt || new Date().toISOString(),
      }
      p.judgements.unshift(j)
      p.updated_at = new Date().toISOString()
      this._persist()
      syncCreate('project_judgements', {
        id: j.id,
        project_id: projectId,
        content: j.content,
        created_at: j.created_at,
      })
      return j
    },

    updateJudgement(projectId, judgementId, content, createdAt = null) {
      const p = this.items.find(p => p.id === projectId)
      if (!p) return
      const j = p.judgements.find(j => j.id === judgementId)
      if (!j) return
      j.content = content
      if (createdAt) j.created_at = createdAt
      p.updated_at = new Date().toISOString()
      this._persist()
      const changes = { content }
      if (createdAt) changes.created_at = createdAt
      syncUpdate('project_judgements', judgementId, changes)
    },

    removeJudgement(projectId, judgementId) {
      const p = this.items.find(p => p.id === projectId)
      if (!p) return
      p.judgements = p.judgements.filter(j => j.id !== judgementId)
      p.updated_at = new Date().toISOString()
      this._persist()
      syncDelete('project_judgements', judgementId)
    },

    // -- Update/Progress operations --

    getUpdates(projectId) {
      const p = this.items.find(p => p.id === projectId)
      return p ? p.updates : []
    },

    addProjectUpdate(projectId, data) {
      const p = this.items.find(p => p.id === projectId)
      if (!p) return null
      const u = {
        id: crypto.randomUUID(),
        title: data.title,
        content: data.content,
        tags: data.tags || [],
        highlight: data.highlight || false,
        created_at: data.created_at || new Date().toISOString(),
      }
      p.updates.unshift(u)
      p.updated_at = new Date().toISOString()
      this._persist()
      syncCreate('project_updates', {
        id: u.id,
        project_id: projectId,
        title: u.title,
        content: u.content,
        created_at: u.created_at,
      })
      return u
    },

    updateProjectUpdate(projectId, updateId, changes) {
      const p = this.items.find(p => p.id === projectId)
      if (!p) return
      const u = p.updates.find(u => u.id === updateId)
      if (!u) return
      Object.assign(u, changes)
      p.updated_at = new Date().toISOString()
      this._persist()
      // tags / highlight 仅存本地，不同步到云端（v2-final schema 未含这两列）
      const { tags, highlight, ...cloudChanges } = changes
      syncUpdate('project_updates', updateId, cloudChanges)
    },

    removeProjectUpdate(projectId, updateId) {
      const p = this.items.find(p => p.id === projectId)
      if (!p) return
      p.updates = p.updates.filter(u => u.id !== updateId)
      p.updated_at = new Date().toISOString()
      this._persist()
      syncDelete('project_updates', updateId)
    },

    // -- 云端只读初始化（Step 3）--
    async initFromCloud(userId) {
      const { data: projects, error } = await supabase
        .from('projects')
        .select('*')
        .eq('user_id', userId)

      if (error) {
        console.error('[cloud] projects fetch error:', error.message)
        return
      }

      // 无论云端是否为空，都以云端为权威来源覆盖本地
      if (!projects.length) {
        this.items = []
        this._persist()
        return
      }

      const projectIds = projects.map(p => p.id)
      const [{ data: updates }, { data: judgements }] = await Promise.all([
        supabase.from('project_updates').select('*').in('project_id', projectIds),
        supabase.from('project_judgements').select('*').in('project_id', projectIds),
      ])

      this.items = projects.map(p => ({
        ...p,
        updates: (updates || [])
          .filter(u => u.project_id === p.id)
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
        judgements: (judgements || [])
          .filter(j => j.project_id === p.id)
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
      }))
      this._persist()
    },

    _persist() {
      save(KEY, JSON.parse(JSON.stringify(this.items)))
    },
  },
})
