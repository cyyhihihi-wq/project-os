import { getAll, save } from '../adapters/index.js'
import { seedTasks } from '../seed.js'

const KEY = 'work_tasks'
const REVIEWS_KEY = 'work_week_reviews'

/**
 * 从存储层加载任务列表。
 * 首次（空存储）时写入 seed 数据并返回。
 */
export function loadTasks() {
  const stored = getAll(KEY)
  if (stored !== null) return stored
  const initial = JSON.parse(JSON.stringify(seedTasks))
  save(KEY, initial)
  return initial
}

/**
 * 把当前 store 内存状态整体写入存储层。
 * 调用方负责传入最新的 items。
 */
export function persistTasks(items) {
  save(KEY, JSON.parse(JSON.stringify(items)))
}

export function loadReviews() {
  return getAll(REVIEWS_KEY) || {}
}

export function persistReviews(reviews) {
  save(REVIEWS_KEY, reviews)
}
