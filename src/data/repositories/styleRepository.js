import { getAll, save } from '../adapters/index.js'
import { seedStyles } from '../seed.js'

const KEY = 'work_styles'

export function list() {
  return getAll(KEY) ?? seedStyles
}

export function getById(id) {
  return list().find(s => s.id === id) || null
}

export function create(style) {
  const items = list()
  items.push(style)
  save(KEY, items)
  return style
}

export function update(id, changes) {
  const items = list()
  const idx = items.findIndex(s => s.id === id)
  if (idx === -1) return null
  items[idx] = { ...items[idx], ...changes }
  save(KEY, items)
  return items[idx]
}

export function remove(id) {
  save(KEY, list().filter(s => s.id !== id))
}
