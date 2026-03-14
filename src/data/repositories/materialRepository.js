import { getAll, save } from '../adapters/index.js'
import { seedMaterials } from '../seed.js'

const KEY = 'work_materials'

export function list() {
  return getAll(KEY) ?? seedMaterials
}

export function getById(id) {
  return list().find(m => m.id === id) || null
}

export function create(material) {
  const items = list()
  items.unshift(material)
  save(KEY, items)
  return material
}

export function update(id, changes) {
  const items = list()
  const idx = items.findIndex(m => m.id === id)
  if (idx === -1) return null
  items[idx] = { ...items[idx], ...changes }
  save(KEY, items)
  return items[idx]
}

export function remove(id) {
  save(KEY, list().filter(m => m.id !== id))
}
