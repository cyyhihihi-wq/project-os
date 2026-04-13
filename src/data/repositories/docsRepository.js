import { getAll, save } from '../adapters/index.js'

const KEY = 'work_docs'

export function loadDocs() {
  return getAll(KEY) ?? []
}

export function persistDocs(items) {
  save(KEY, JSON.parse(JSON.stringify(items)))
}
