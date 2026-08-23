import { getAll, save } from '../adapters/index.js'

const KEY = 'work_tasks'
const REVIEWS_KEY = 'work_week_reviews'
/** 独立存储 taskId→mode 映射，防止 initFromCloud 覆盖导致区域分类丢失 */
const MODES_KEY = 'work_task_modes'

/**
 * 从存储层加载任务列表。
 * 首次（空存储）返回空数组，不注入 seed 数据。
 * seed 数据仅供开发调试，不在生产环境自动填充。
 */
export function loadTasks() {
  const stored = getAll(KEY)
  return stored !== null ? stored : []
}

/**
 * 把当前 store 内存状态整体写入存储层。
 * 调用方负责传入最新的 items。
 */
export function persistTasks(items) {
  save(KEY, JSON.parse(JSON.stringify(items)))
  // 同步更新 modes 映射（仅保存非 inbox 的任务，节省空间）
  const modes = {}
  for (const t of items) {
    if (t.mode && t.mode !== 'inbox') modes[t.id] = t.mode
  }
  save(MODES_KEY, modes)
}

/**
 * 读取独立的 taskId→mode 映射表。
 * 在 initFromCloud 后用于恢复区域分类，优先级高于主 tasks 数组。
 */
export function loadModesMap() {
  return getAll(MODES_KEY) || {}
}

export function loadReviews() {
  return getAll(REVIEWS_KEY) || {}
}

export function persistReviews(reviews) {
  save(REVIEWS_KEY, reviews)
}

/** 每周重点工作便签（weekKey → text） */
const FOCUS_NOTES_KEY = 'work_week_focus_notes'

export function loadFocusNotes() {
  return getAll(FOCUS_NOTES_KEY) || {}
}

export function persistFocusNotes(notes) {
  save(FOCUS_NOTES_KEY, notes)
}
