/**
 * AI Context Builders
 * 从 Pinia store 读取真实数据，组装成 AI 生成所需的上下文对象。
 * 不直接调用 AI，只负责数据收集与结构化。
 *
 * 导出的 builder 函数：
 *   buildWeeklyReportContext  — 周报
 *   buildMonthlyReportContext — 月报（独立函数，与周报逻辑不同）
 *   buildProjectReportContext — 专项报告（支持可选聚焦时间范围）
 *   buildReviewContext        — 复盘（weekReview 为未完成原因主来源）
 *   buildFreeformContext      — 自由生成（数据全量，不做 structureGuide 硬映射）
 *
 * 辅助函数 resolveDateRange 也对外导出，供 aiService 使用。
 */

// ---------------------------------------------------------------------------
// HTML → 纯文本（AI 上下文用）
// ---------------------------------------------------------------------------

/**
 * htmlToText
 * 将 Tiptap 输出的 HTML 转为结构化纯文本，供 AI prompt 使用。
 * 保留段落、列表层级、加粗标记，不压成一行。
 *
 * @param {string} html
 * @returns {string}
 */
export function htmlToText(html) {
  if (!html) return ''
  if (typeof document === 'undefined') {
    // 非浏览器环境：最简降级
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  }
  const el = document.createElement('div')
  el.innerHTML = html
  return _walkNode(el, 0).replace(/\n{3,}/g, '\n\n').trim()
}

function _walkNode(node, listDepth) {
  // 文本节点
  if (node.nodeType === 3) return node.textContent

  const tag = (node.tagName || '').toLowerCase()
  const inner = (depth = listDepth) =>
    Array.from(node.childNodes).map(c => _walkNode(c, depth)).join('')

  switch (tag) {
    case 'p':      return inner() + '\n'
    case 'br':     return '\n'
    case 'strong':
    case 'b':      return '**' + inner() + '**'
    case 'em':
    case 'i':      return '_' + inner() + '_'
    case 'mark':   return '【' + inner() + '】'
    case 'h1':     return '# ' + inner() + '\n'
    case 'h2':     return '## ' + inner() + '\n'
    case 'h3':
    case 'h4':     return '### ' + inner() + '\n'
    case 'table': {
      const rows = Array.from(node.querySelectorAll('tr'))
      if (!rows.length) return ''
      const tableLines = []
      rows.forEach((row, i) => {
        const cells = Array.from(row.querySelectorAll('th, td'))
          .map(c => c.textContent.trim().replace(/\|/g, '\\|').replace(/\n+/g, ' '))
        if (!cells.length) return
        tableLines.push('| ' + cells.join(' | ') + ' |')
        if (i === 0) tableLines.push('| ' + cells.map(() => '---').join(' | ') + ' |')
      })
      return tableLines.join('\n') + '\n\n'
    }
    case 'thead':
    case 'tbody':
    case 'tfoot':  return inner()
    case 'ul':
    case 'ol':     return Array.from(node.childNodes).map(c => _walkNode(c, listDepth)).join('') + '\n'
    case 'li': {
      const prefix = '  '.repeat(listDepth) + '- '
      let text = ''
      let nested = ''
      for (const child of node.childNodes) {
        const ct = (child.tagName || '').toLowerCase()
        if (ct === 'ul' || ct === 'ol') {
          nested += _walkNode(child, listDepth + 1)
        } else {
          text += _walkNode(child, listDepth)
        }
      }
      return prefix + text.replace(/\n+$/, '') + '\n' + nested
    }
    default:       return inner()
  }
}

// ---------------------------------------------------------------------------
// 日期工具
// ---------------------------------------------------------------------------

/**
 * 计算指定偏移周的周信息（offset=0 本周，-1 上周）
 * 复用 TasksView 中相同的周计算逻辑，确保 weekNo 一致
 */
function getWeekInfo(offsetWeeks = 0) {
  const now = new Date()
  const target = new Date(now)
  target.setDate(target.getDate() + offsetWeeks * 7)
  const day = target.getDay()
  const diff = target.getDate() - day + (day === 0 ? -6 : 1)
  const monday = new Date(target)
  monday.setDate(diff)
  monday.setHours(0, 0, 0, 0)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  sunday.setHours(23, 59, 59, 999)
  const yearStart = new Date(monday.getFullYear(), 0, 1)
  const weekNo = Math.ceil(((monday - yearStart) / 86400000 + yearStart.getDay() + 1) / 7)
  const weekKey = `${monday.getFullYear()}-W${String(weekNo).padStart(2, '0')}`
  return { weekNo, weekKey, monday, sunday, year: monday.getFullYear() }
}

/** 判断 ISO 时间字符串是否在 [from, to] 范围内 */
function inRange(isoStr, from, to) {
  if (!isoStr) return false
  const d = new Date(isoStr)
  return d >= from && d <= to
}

/**
 * 根据 range 字符串返回 { from, to, weekInfo }
 * 对外导出，供 aiService 使用
 */
export function resolveDateRange(range) {
  if (range === 'last-week') {
    const wi = getWeekInfo(-1)
    return { from: wi.monday, to: wi.sunday, weekInfo: wi }
  }
  if (range === 'this-month') {
    const now = new Date()
    const from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0)
    const to   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
    return { from, to, weekInfo: getWeekInfo(0) }
  }
  // default: this-week
  const wi = getWeekInfo(0)
  return { from: wi.monday, to: wi.sunday, weekInfo: wi }
}

// ---------------------------------------------------------------------------
// 周报
// ---------------------------------------------------------------------------

/**
 * buildWeeklyReportContext
 * 读取本周（或上周）任务、专项进展、新增资料、周复盘笔记。
 * 任务以 week 字段匹配（与 TasksView 逻辑一致）。
 *
 * @param {object} stores        - { tasksStore, projectsStore, materialsStore, stylesStore }
 * @param {object} options
 *   @param {string} options.range          - 'this-week' | 'last-week'（月报应使用独立 builder）
 *   @param {string} options.projectFilter  - 专项名称过滤，空字符串表示不限
 */
export function buildWeeklyReportContext(stores, options = {}) {
  const { tasksStore, projectsStore, materialsStore, stylesStore } = stores
  const range         = options.range         || 'this-week'
  const projectFilter = options.projectFilter || ''

  const { from, to, weekInfo } = resolveDateRange(range)

  // 任务：用 week 字段匹配（同 TasksView 逻辑）
  let tasks = tasksStore.items.filter(t => t.week === weekInfo.weekNo)
  if (projectFilter) tasks = tasks.filter(t => t.project === projectFilter)

  const doneTasks  = tasks.filter(t => t.status === 'done')
  const doingTasks = tasks.filter(t => t.status === 'doing')
  const todoTasks  = tasks.filter(t => t.status === 'todo')

  // 周复盘笔记（内容可能是 HTML，转为纯文本供 AI 使用）
  const weekReview = htmlToText(tasksStore.getWeekReview(weekInfo.weekKey))

  // 本期有进展记录的专项（按进展 created_at 筛选）
  const projectUpdates = []
  for (const p of projectsStore.items) {
    if (projectFilter && p.name !== projectFilter) continue
    const updates = p.updates.filter(u => inRange(u.created_at, from, to))
      .map(u => ({ ...u, content: htmlToText(u.content) }))
    if (updates.length > 0) {
      projectUpdates.push({ projectName: p.name, updates })
    }
  }

  // 相关资料：本周新增（保持原有逻辑）
  let materials
  if (projectFilter) {
    materials = materialsStore.items.filter(m =>
      m.project === projectFilter ||
      (m.tags || []).some(tag => tag.includes(projectFilter) || projectFilter.includes(tag))
    )
  } else {
    materials = materialsStore.items.filter(m => inRange(m.created_at, from, to))
  }
  materials = materials.map(m => ({ ...m, raw_content: htmlToText(m.raw_content) }))

  return {
    type: 'weekly',
    weekNo: weekInfo.weekNo,
    weekKey: weekInfo.weekKey,
    rangeLabel: range,
    dateFrom: from,
    dateTo: to,
    projectFilter,
    tasks: { done: doneTasks, doing: doingTasks, todo: todoTasks, all: tasks },
    weekReview,
    projectUpdates,
    materials,
    styleRefs: stylesStore.items,
  }
}

// ---------------------------------------------------------------------------
// 月报（独立 builder，与周报逻辑不同）
// ---------------------------------------------------------------------------

/**
 * buildMonthlyReportContext
 * 按"本月发生的变动 / 完成 / 更新"组织，而不是只统计本月新建内容。
 *
 * 数据读取规则：
 * - 任务：本月 updated_at 有变化的任务（涵盖状态切换、内容编辑）
 * - 专项进展：本月 created_at 新增的进展条目
 *   （Update 模型只有 created_at，无 updated_at）
 * - 资料：本月 created_at 新增的资料
 *   （Material 模型只有 created_at，无 updated_at）
 *
 * @param {object} stores
 * @param {object} options
 *   @param {string} options.projectFilter - 专项名称过滤
 */
export function buildMonthlyReportContext(stores, options = {}) {
  const { tasksStore, projectsStore, materialsStore, stylesStore } = stores
  const projectFilter = options.projectFilter || ''

  const now  = new Date()
  const from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0)
  const to   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)

  // 任务：本月 updated_at 变化（捕捉状态切换、备注更新等）
  let tasks = tasksStore.items.filter(t => inRange(t.updated_at, from, to))
  if (projectFilter) tasks = tasks.filter(t => t.project === projectFilter)

  const doneTasks  = tasks.filter(t => t.status === 'done')
  const doingTasks = tasks.filter(t => t.status === 'doing')
  const todoTasks  = tasks.filter(t => t.status === 'todo')

  // 专项进展：本月新增（created_at，因 Update 模型无 updated_at）
  const projectUpdates = []
  for (const p of projectsStore.items) {
    if (projectFilter && p.name !== projectFilter) continue
    const updates = p.updates.filter(u => inRange(u.created_at, from, to))
      .map(u => ({ ...u, content: htmlToText(u.content) }))
    if (updates.length > 0) {
      projectUpdates.push({ projectName: p.name, updates })
    }
  }

  // 资料：本月新增（created_at，因 Material 模型无 updated_at）
  let materials = materialsStore.items.filter(m => inRange(m.created_at, from, to))
  if (projectFilter) {
    materials = materialsStore.items.filter(m =>
      inRange(m.created_at, from, to) &&
      (m.project === projectFilter ||
       (m.tags || []).some(tag => tag.includes(projectFilter) || projectFilter.includes(tag)))
    )
  }
  materials = materials.map(m => ({ ...m, raw_content: htmlToText(m.raw_content) }))

  return {
    type: 'monthly',
    month: now.getMonth() + 1,
    year: now.getFullYear(),
    dateFrom: from,
    dateTo: to,
    projectFilter,
    tasks: { done: doneTasks, doing: doingTasks, todo: todoTasks, all: tasks },
    projectUpdates,
    materials,
    styleRefs: stylesStore.items,
    // 供 AI 参考：说明各数据字段的筛选口径
    dataNote: {
      tasks: '按 updated_at 筛选（涵盖本月内发生状态变更或编辑的任务）',
      projectUpdates: '按 created_at 筛选（本月新增进展条目）',
      materials: '按 created_at 筛选（本月新增资料）',
    },
  }
}

// ---------------------------------------------------------------------------
// 专项报告
// ---------------------------------------------------------------------------

/**
 * buildProjectReportContext
 * 默认读取完整历史；传入 focusRange 时，按需聚焦对应时间范围。
 *
 * @param {number|string} projectId
 * @param {object}        stores
 * @param {object}        options
 *   @param {{ from: Date, to: Date } | null} options.focusRange
 *     - null（默认）：读取完整历史
 *     - 传入日期范围：updates/judgements/tasks 均只含该范围内的记录
 *     - latestJudgement 始终取整体最新条目（不受 focusRange 限制）
 */
export function buildProjectReportContext(projectId, stores, options = {}) {
  const { tasksStore, projectsStore, materialsStore, stylesStore } = stores
  const focusRange = options.focusRange || null

  const project = projectsStore.getById(Number(projectId))
  if (!project) return { type: 'project', project: null }

  // 关联任务（按 project name 匹配）
  const allTasks = tasksStore.items.filter(t => t.project === project.name)
  const scopedTasks = focusRange
    ? allTasks.filter(t => inRange(t.updated_at, focusRange.from, focusRange.to))
    : allTasks

  const doneTasks  = scopedTasks.filter(t => t.status === 'done')
  const doingTasks = scopedTasks.filter(t => t.status === 'doing')
  const todoTasks  = scopedTasks.filter(t => t.status === 'todo')

  // 进展时间线（按 created_at 聚焦，content 转为纯文本供 AI 使用）
  const scopedUpdates = (focusRange
    ? project.updates.filter(u => inRange(u.created_at, focusRange.from, focusRange.to))
    : project.updates
  ).map(u => ({ ...u, content: htmlToText(u.content) }))

  // 判断历史（按 created_at 聚焦，content 转为纯文本供 AI 使用）
  // latestJudgement 始终取整体最新，不受聚焦限制（反映当前状态）
  const scopedJudgements = (focusRange
    ? project.judgements.filter(j => inRange(j.created_at, focusRange.from, focusRange.to))
    : project.judgements
  ).map(j => ({ ...j, content: htmlToText(j.content) }))

  // 相关资料：不受 focusRange 限制（资料是静态背景，全量更有价值）
  const materials = materialsStore.items
    .filter(m =>
      m.project === project.name ||
      (m.tags || []).some(tag => tag.includes(project.name) || project.name.includes(tag))
    )
    .map(m => ({ ...m, raw_content: htmlToText(m.raw_content) }))

  const latestJ = project.judgements[0]

  return {
    type: 'project',
    project,
    isFocused: focusRange !== null,
    focusRange,
    // 当前最新判断（始终为全局最新，代表当下状态）
    latestJudgement: latestJ ? { ...latestJ, content: htmlToText(latestJ.content) } : null,
    // 判断历史（focusRange 下可能只含聚焦期内的条目）
    allJudgements: scopedJudgements,
    // 进展时间线（focusRange 下仅含聚焦期内条目）
    updates: scopedUpdates,
    tasks: { done: doneTasks, doing: doingTasks, todo: todoTasks, all: scopedTasks },
    materials,
    styleRefs: stylesStore.items,
  }
}

// ---------------------------------------------------------------------------
// 复盘
// ---------------------------------------------------------------------------

/**
 * buildReviewContext
 * 复盘专用 builder，明确区分"未完成原因主来源"和"执行过程参考"。
 *
 * 数据分层：
 * - weekReview（主来源）：用户在任务页手写的周回顾内容
 *   → 未完成原因分析应优先读取此字段
 * - incompleteTasksWithNotes（次要参考）：有 note 字段的未完成任务
 *   → note 是执行过程中的随手记录，不代表未完成原因，仅供参考
 *
 * @param {object} stores
 * @param {object} options
 *   @param {string} options.range         - 'this-week' | 'last-week'
 *   @param {string} options.projectFilter
 */
export function buildReviewContext(stores, options = {}) {
  const { tasksStore, projectsStore, stylesStore } = stores
  const range         = options.range         || 'this-week'
  const projectFilter = options.projectFilter || ''

  const { from, to, weekInfo } = resolveDateRange(range)

  let tasks = tasksStore.items.filter(t => t.week === weekInfo.weekNo)
  if (projectFilter) tasks = tasks.filter(t => t.project === projectFilter)

  const doneTasks  = tasks.filter(t => t.status === 'done')
  const doingTasks = tasks.filter(t => t.status === 'doing')
  const todoTasks  = tasks.filter(t => t.status === 'todo')

  // 周复盘笔记：未完成原因分析的主来源
  const weekReview = htmlToText(tasksStore.getWeekReview(weekInfo.weekKey))

  // 未完成任务中有执行备注的条目（次要参考，不是原因来源）
  const incompleteTasksWithNotes = [...doingTasks, ...todoTasks].filter(t => t.note)

  // 本期专项进展（用于"专项推进情况"部分）
  const projectUpdates = []
  for (const p of projectsStore.items) {
    if (projectFilter && p.name !== projectFilter) continue
    const updates = p.updates.filter(u => inRange(u.created_at, from, to))
      .map(u => ({ ...u, content: htmlToText(u.content) }))
    if (updates.length > 0) {
      projectUpdates.push({ projectName: p.name, updates })
    }
  }

  return {
    type: 'review',
    weekNo: weekInfo.weekNo,
    weekKey: weekInfo.weekKey,
    rangeLabel: range,
    dateFrom: from,
    dateTo: to,
    projectFilter,
    tasks: { done: doneTasks, doing: doingTasks, todo: todoTasks, all: tasks },
    // 未完成原因分析：主来源
    weekReview,
    incompleteAnalysisPrimarySource: 'weekReview',
    // 执行过程参考：task.note（次要，不代表未完成原因）
    incompleteTasksWithNotes,
    projectUpdates,
    styleRefs: stylesStore.items,
  }
}

// ---------------------------------------------------------------------------
// 自由生成
// ---------------------------------------------------------------------------

/**
 * buildFreeformContext
 * 提供与用户所选专项 / 时间范围相关的全量上下文。
 *
 * 设计原则：
 * - structureGuide 原样保留，不做任何字段映射或关键词匹配
 * - 数据全量提供（任务、判断、进展、资料），由真实 AI 根据 structureGuide 自主组织
 * - 不在 context builder 层预先决定"哪个 section 用哪些数据"
 *
 * @param {object} filters
 *   @param {number|string} filters.projectId   - 专项 id，无则所有专项
 *   @param {string}        filters.range       - 时间范围
 *   @param {string}        filters.structureGuide - 用户输入的结构指引（原样保留）
 * @param {object} stores
 */
export function buildFreeformContext(filters, stores) {
  const { tasksStore, projectsStore, materialsStore, stylesStore } = stores
  const { projectId, range = 'this-week', structureGuide = '' } = filters

  const { from, to, weekInfo } = resolveDateRange(range)
  const project = projectId ? projectsStore.getById(Number(projectId)) : null

  // 任务：有专项时全量（不受时间范围限制），无专项时取本期内有变化的任务
  let tasks
  if (project) {
    tasks = tasksStore.items.filter(t => t.project === project.name)
  } else if (range === 'this-month') {
    tasks = tasksStore.items.filter(t => inRange(t.updated_at, from, to))
  } else {
    tasks = tasksStore.items.filter(t => t.week === weekInfo.weekNo)
  }

  // 专项进展：有专项时全量，无专项时按本期 created_at 筛选
  const projectUpdates = []
  const projectsToScan = project ? [project] : projectsStore.items
  for (const p of projectsToScan) {
    const raw = project
      ? p.updates
      : p.updates.filter(u => inRange(u.created_at, from, to))
    const updates = raw.map(u => ({ ...u, content: htmlToText(u.content) }))
    if (updates.length > 0) {
      projectUpdates.push({ projectName: p.name, updates })
    }
  }

  // 资料：有专项时取专项相关资料（全量），无专项时取本期新增
  let materials
  if (project) {
    materials = materialsStore.items.filter(m =>
      m.project === project.name ||
      (m.tags || []).some(tag => tag.includes(project.name) || project.name.includes(tag))
    )
  } else {
    materials = materialsStore.items.filter(m => inRange(m.created_at, from, to))
  }

  // 专项判断历史（有专项时全量提供，为 AI 提供背景）
  const judgements = (project ? project.judgements : [])
    .map(j => ({ ...j, content: htmlToText(j.content) }))

  materials = materials.map(m => ({ ...m, raw_content: htmlToText(m.raw_content) }))

  return {
    type: 'freeform',
    project,
    rangeLabel: range,
    dateFrom: from,
    dateTo: to,
    // structureGuide 原样透传，不在此处做任何字段映射
    structureGuide,
    tasks,
    // 判断历史（有专项时提供全量，无专项时为空数组）
    judgements,
    projectUpdates,
    materials,
    styleRefs: stylesStore.items,
  }
}
