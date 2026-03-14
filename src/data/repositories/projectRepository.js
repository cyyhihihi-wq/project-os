import { getAll, save } from '../adapters/index.js'
import { seedProjects } from '../seed.js'

const KEY = 'work_projects'

function persist(items) {
  save(KEY, items)
}

export function list() {
  return getAll(KEY) ?? seedProjects
}

export function getById(id) {
  return list().find(p => p.id === id) || null
}

export function create(project) {
  const items = list()
  items.push(project)
  persist(items)
  return project
}

export function update(id, changes) {
  const items = list()
  const idx = items.findIndex(p => p.id === id)
  if (idx === -1) return null
  items[idx] = { ...items[idx], ...changes, updated_at: new Date().toISOString() }
  persist(items)
  return items[idx]
}

export function remove(id) {
  persist(list().filter(p => p.id !== id))
}

// -- Judgement operations --

export function addJudgement(projectId, judgement) {
  const items = list()
  const p = items.find(p => p.id === projectId)
  if (!p) return null
  p.judgements.unshift(judgement)
  p.updated_at = new Date().toISOString()
  persist(items)
  return judgement
}

export function removeJudgement(projectId, judgementId) {
  const items = list()
  const p = items.find(p => p.id === projectId)
  if (!p) return
  p.judgements = p.judgements.filter(j => j.id !== judgementId)
  p.updated_at = new Date().toISOString()
  persist(items)
}

// -- Update/Progress operations --

export function addUpdate(projectId, update) {
  const items = list()
  const p = items.find(p => p.id === projectId)
  if (!p) return null
  p.updates.unshift(update)
  p.updated_at = new Date().toISOString()
  persist(items)
  return update
}

export function removeUpdate(projectId, updateId) {
  const items = list()
  const p = items.find(p => p.id === projectId)
  if (!p) return
  p.updates = p.updates.filter(u => u.id !== updateId)
  p.updated_at = new Date().toISOString()
  persist(items)
}

export function saveAll(items) {
  persist(items)
}
