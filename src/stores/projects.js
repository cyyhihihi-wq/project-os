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
        tags: u.tags,
        highlight: u.highlight,
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
      syncUpdate('project_updates', updateId, changes)
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

      // 云端无数据时保留本地数据，避免意外清空
      if (!projects.length) return

      // ── 构建本地索引（用于合并而非覆盖）──
      // 目的：
      //   1. 恢复云端 schema 中不存在的字段（tags / highlight）
      //   2. 保留尚未同步到云端的本地进展条目（syncCreate 失败或延迟时）
      const localProjectsById = {}
      for (const p of this.items) {
        localProjectsById[p.id] = p
      }

      const projectIds = projects.map(p => p.id)
      const [{ data: cloudUpdates }, { data: cloudJudgements }] = await Promise.all([
        supabase.from('project_updates').select('*').in('project_id', projectIds),
        supabase.from('project_judgements').select('*').in('project_id', projectIds),
      ])

      const cloudUpdateIdSet = new Set((cloudUpdates || []).map(u => u.id))

      this.items = projects.map(p => {
        const localProject = localProjectsById[p.id] || { updates: [], judgements: [] }

        // 本地 updates 按 id 索引，用于恢复 tags/highlight
        const localUpdatesById = {}
        for (const u of (localProject.updates || [])) {
          localUpdatesById[u.id] = u
        }

        // 本地有但云端没有的 update（syncCreate 失败/延迟），保留原样
        const pendingLocalUpdates = (localProject.updates || []).filter(
          u => !cloudUpdateIdSet.has(u.id)
        )

        // 云端 updates 合并策略：
        //   tags   — 云端有内容优先；云端为 null/[] 时回落到本地缓存（兼容 DEFAULT '[]' 迁移）
        //   highlight — 云端 true 优先；云端 false/null 时回落到本地缓存
        // 原因：Supabase 列加默认值后旧行 tags=[], highlight=false，
        //       直接 `??` 只能判 null/undefined，无法识别空数组/false，会误覆盖本地数据。
        const syncedUpdates = (cloudUpdates || [])
          .filter(u => u.project_id === p.id)
          .map(u => {
            const local = localUpdatesById[u.id]
            // tags：云端非空数组 → 用云端；否则看本地；再否则空数组
            const cloudTags = Array.isArray(u.tags) ? u.tags : null
            const localTags = local?.tags
            const tags = (cloudTags && cloudTags.length > 0)
              ? cloudTags
              : (localTags && localTags.length > 0 ? localTags : (cloudTags ?? []))
            // highlight：任意一方为 true 则保留 true（优先云端）
            const highlight = u.highlight === true
              ? true
              : (local?.highlight === true ? true : false)
            return { ...u, tags, highlight }
          })

        // 合并：已同步 + 待同步（本地独有），统一按时间降序
        const mergedUpdates = [...syncedUpdates, ...pendingLocalUpdates]
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

        return {
          ...p,
          updates: mergedUpdates,
          judgements: (cloudJudgements || [])
            .filter(j => j.project_id === p.id)
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
        }
      })
      this._persist()
    },

    _persist() {
      save(KEY, JSON.parse(JSON.stringify(this.items)))
    },
  },
})
