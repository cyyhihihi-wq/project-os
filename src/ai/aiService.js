/**
 * AI Service — 入口层
 * 调用链：AIView → generateDocument() → buildContext() → buildMessages() → callDeepSeek()
 *
 * 职责：
 * 1. 根据文档类型选择对应 context builder
 * 2. 将 context 序列化为 system prompt + user prompt
 * 3. 调用 DeepSeek API
 * 4. 若无 API Key 或请求失败，fallback 到 mockGenerator
 */

import {
  buildWeeklyReportContext,
  buildMonthlyReportContext,
  buildProjectReportContext,
  buildReviewContext,
  buildFreeformContext,
  resolveDateRange,
} from './contextBuilders.js'
import { callDeepSeek } from './deepseekClient.js'
import { generateFromContext } from './mockGenerator.js'

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `你是一名专业的工作文档整理助手。

你的任务是：
根据输入的工作记录、项目进展和资料信息，整理生成结构清晰、逻辑明确的工作文档。

你的角色不是内容创作者，而是信息整理者。

核心原则：
1. 只能使用输入数据中的信息
2. 不允许编造事实、数据或事件
3. 可以进行信息归纳、逻辑重排和语言优化
4. 如果某个部分缺乏信息，应明确说明：（输入数据未提供相关信息）

文档风格要求：
- 信息密度高
- 逻辑清晰
- 表达客观理性
- 避免空洞总结
- 避免情绪化语言
- 使用简洁书面表达
- 不使用营销或宣传语气

文档结构规则：
文档通常遵循以下逻辑：结论/总览 → 现状 → 问题或挑战 → 方案/策略 → 风险或限制 → 推进计划
但请根据输入信息决定实际章节结构，不要为了完整结构而编造内容。

信息表达方式：
当信息存在数据对比、多方案比较、风险分类、策略结构拆解时，可以使用 Markdown 表格。
如果只是简单描述，不需要使用表格。

判断表达：
当输入信息足够支持时，可以提出总结性判断或归纳结论，但必须明确基于已有信息。

输出要求：
- 使用 Markdown 格式
- 结构清晰，可以使用标题、列表或表格
- 不输出任何解释
- 只输出最终文档正文`

// ---------------------------------------------------------------------------
// Context 序列化：将结构化 context 转为可读的 prompt 文本
// ---------------------------------------------------------------------------

function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 序列化任务列表，兼容 { done, doing, todo } 结构体和原始数组 */
function serializeTasks(tasks) {
  if (!tasks) return ''

  let done, doing, todo
  if (Array.isArray(tasks)) {
    done  = tasks.filter(t => t.status === 'done')
    doing = tasks.filter(t => t.status === 'doing')
    todo  = tasks.filter(t => t.status === 'todo')
  } else {
    done  = tasks.done  || []
    doing = tasks.doing || []
    todo  = tasks.todo  || []
  }

  if (done.length + doing.length + todo.length === 0) return ''

  let s = ''

  if (done.length > 0) {
    s += `\n已完成（${done.length} 项）：\n`
    for (const t of done) {
      const proj = t.project ? `[${t.project}] ` : ''
      const note = t.note    ? `（${t.note}）`   : ''
      const due  = t.due     ? ` 截止 ${t.due}`  : ''
      s += `- ${proj}${t.title}${due}${note}\n`
    }
  }
  if (doing.length > 0) {
    s += `\n进行中（${doing.length} 项）：\n`
    for (const t of doing) {
      const proj = t.project ? `[${t.project}] ` : ''
      const note = t.note    ? `（${t.note}）`   : ''
      const due  = t.due     ? ` 截止 ${t.due}`  : ''
      s += `- ${proj}${t.title}${due}${note}\n`
    }
  }
  if (todo.length > 0) {
    s += `\n待开始（${todo.length} 项）：\n`
    for (const t of todo) {
      const proj = t.project ? `[${t.project}] ` : ''
      const due  = t.due     ? ` 截止 ${t.due}`  : ''
      s += `- ${proj}${t.title}${due}\n`
    }
  }
  return s
}

/** 序列化跨专项进展列表 */
function serializeProjectUpdates(projectUpdates) {
  if (!projectUpdates || projectUpdates.length === 0) return ''
  let s = ''
  for (const pu of projectUpdates) {
    s += `\n**${pu.projectName}**\n`
    for (const u of pu.updates) {
      s += `- ${fmtDate(u.created_at)} · ${u.title}\n`
      if (u.content) {
        s += `  ${u.content.slice(0, 300)}${u.content.length > 300 ? '...' : ''}\n`
      }
      if (u.tags && u.tags.length > 0) s += `  标签：${u.tags.join('、')}\n`
    }
  }
  return s
}

/** 序列化资料列表 */
function serializeMaterials(materials) {
  if (!materials || materials.length === 0) return ''
  let s = ''
  for (const m of materials) {
    const summary = (m.ai_summary || m.raw_content || '').slice(0, 150)
    s += `- 【${m.type}】${m.title}：${summary}${summary.length >= 150 ? '...' : ''}\n`
  }
  return s
}

/** 序列化文风参考 */
function serializeStyleRefs(styleRefs) {
  if (!styleRefs || styleRefs.length === 0) return ''
  return styleRefs.map(s => `- ${s.name}：${s.summary}`).join('\n') + '\n'
}

/**
 * 将 context 对象组装为 DeepSeek messages 数组
 * user prompt 按模板分四个主节：文档类型、时间范围、任务记录、项目进展、相关资料、写作要求
 * @param {object} context
 * @returns {Array<{ role: string, content: string }>}
 */
function buildMessages(context) {
  const typeLabels = {
    weekly:   '周报',
    monthly:  '月报',
    project:  '专项报告',
    review:   '工作复盘',
    freeform: '工作文档（自由生成）',
  }

  // ── 【文档类型】 ────────────────────────────────────────────
  const docTypeLabel = typeLabels[context.type] || '工作文档'
  let docTypeSection = docTypeLabel
  if (context.project) {
    docTypeSection += `\n专项：${context.project.name}（状态：${context.project.status}）`
  }
  if (context.projectFilter) {
    docTypeSection += `\n专项范围：${context.projectFilter}`
  }
  if (context.structureGuide) {
    docTypeSection += `\n结构指引：${context.structureGuide}`
  }

  // ── 【时间范围】 ────────────────────────────────────────────
  let timeRangeSection = ''
  if (context.weekNo)  timeRangeSection = `第 ${context.weekNo} 周`
  if (context.month)   timeRangeSection = `${context.year} 年 ${context.month} 月`
  if (context.isFocused && context.focusRange) {
    timeRangeSection += `\n聚焦区间：${fmtDate(context.focusRange.from)} 至 ${fmtDate(context.focusRange.to)}`
  }
  if (!timeRangeSection) timeRangeSection = '（未指定）'

  // ── 【任务记录】 ────────────────────────────────────────────
  const taskLines = []

  const taskText = serializeTasks(context.tasks)
  if (taskText) {
    taskLines.push(taskText)
  }

  // 复盘：周回顾是未完成原因的主来源
  if (context.type === 'review') {
    taskLines.push('\n周复盘笔记（未完成原因的主要依据）：')
    taskLines.push(context.weekReview || '（本周暂无复盘笔记）')
    if (context.incompleteTasksWithNotes?.length > 0) {
      taskLines.push('\n未完成任务备注（仅作参考）：')
      for (const t of context.incompleteTasksWithNotes) {
        taskLines.push(`- ${t.title}：${t.note}`)
      }
    }
  }

  // 周报：附周复盘笔记
  if (context.type === 'weekly' && context.weekReview) {
    taskLines.push('\n周复盘笔记：')
    taskLines.push(context.weekReview)
  }

  // 月报：数据口径说明
  if (context.type === 'monthly' && context.dataNote) {
    taskLines.push('\n数据说明：')
    for (const [k, v] of Object.entries(context.dataNote)) {
      taskLines.push(`- ${k}：${v}`)
    }
  }

  const taskSection = taskLines.length > 0
    ? taskLines.join('\n')
    : '（输入数据未提供相关信息）'

  // ── 【项目进展】 ────────────────────────────────────────────
  const projLines = []

  // 专项报告：当前判断 + 历史判断 + 单专项进展时间线
  if (context.latestJudgement) {
    projLines.push(`当前判断（${fmtDate(context.latestJudgement.created_at)}）：`)
    projLines.push(context.latestJudgement.content)
  }
  if (context.allJudgements?.length > 1) {
    projLines.push('\n历史判断：')
    for (const j of context.allJudgements.slice(1)) {
      const snippet = j.content.slice(0, 100)
      projLines.push(`- ${fmtDate(j.created_at)}：${snippet}${j.content.length > 100 ? '...' : ''}`)
    }
  }
  // 自由生成：判断历史全量
  if (context.type === 'freeform' && context.judgements?.length > 0) {
    projLines.push('\n专项判断历史：')
    for (const j of context.judgements) {
      projLines.push(`- ${fmtDate(j.created_at)}：${j.content}`)
    }
  }
  // 单专项进展时间线
  if (context.updates?.length > 0) {
    projLines.push('\n进展时间线：')
    for (const u of context.updates) {
      projLines.push(`- ${fmtDate(u.created_at)} · **${u.title}**`)
      if (u.content) {
        projLines.push(`  ${u.content.slice(0, 300)}${u.content.length > 300 ? '...' : ''}`)
      }
      if (u.tags?.length > 0) projLines.push(`  标签：${u.tags.join('、')}`)
    }
  }
  // 跨专项进展（周报 / 月报 / 复盘 / 自由生成）
  const projectUpdateText = serializeProjectUpdates(context.projectUpdates)
  if (projectUpdateText) {
    projLines.push('\n各专项进展：' + projectUpdateText)
  }

  const projSection = projLines.length > 0
    ? projLines.join('\n')
    : '（输入数据未提供相关信息）'

  // ── 【相关资料】 ────────────────────────────────────────────
  const materialLines = []

  const materialText = serializeMaterials(context.materials)
  if (materialText) materialLines.push(materialText)

  const styleText = serializeStyleRefs(context.styleRefs)
  if (styleText) {
    materialLines.push('\n文风参考（请参照其写作风格和语气）：\n' + styleText)
  }

  const materialSection = materialLines.length > 0
    ? materialLines.join('\n')
    : '（输入数据未提供相关信息）'

  // ── 组装完整 user prompt ───────────────────────────────────
  const userPrompt = `请根据以下信息生成一份工作文档。

【文档类型】
${docTypeSection}

【时间范围】
${timeRangeSection}

【任务记录】
${taskSection}

【项目进展】
${projSection}

【相关资料】
${materialSection}

写作要求：
- 只使用提供的数据
- 不编造信息
- 可以归纳总结
- 优先保持逻辑清晰
- 当存在对比或结构关系时可使用表格`

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user',   content: userPrompt },
  ]
}

// ---------------------------------------------------------------------------
// Context builder 选择
// ---------------------------------------------------------------------------

function buildContext(params, stores) {
  const { docType, sourceProject, sourceRange, structureGuide } = params

  switch (docType) {
    case 'weekly': {
      return buildWeeklyReportContext(stores, {
        range: sourceRange,
        projectFilter: sourceProject,
      })
    }

    case 'monthly': {
      return buildMonthlyReportContext(stores, {
        projectFilter: sourceProject,
      })
    }

    case 'project': {
      const project = stores.projectsStore.items.find(p => p.name === sourceProject)
      if (!project) return { type: 'project', project: null }

      // 仅当用户明确选择非默认范围时，才启用聚焦过滤
      let focusRange = null
      if (sourceRange && sourceRange !== 'this-week') {
        const { from, to } = resolveDateRange(sourceRange)
        focusRange = { from, to }
      }
      return buildProjectReportContext(project.id, stores, { focusRange })
    }

    case 'review': {
      return buildReviewContext(stores, {
        range: sourceRange,
        projectFilter: sourceProject,
      })
    }

    case 'free':
    default: {
      const project = sourceProject
        ? stores.projectsStore.items.find(p => p.name === sourceProject)
        : null
      return buildFreeformContext(
        { projectId: project?.id, range: sourceRange, structureGuide },
        stores,
      )
    }
  }
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * 生成文档
 * 优先调用 DeepSeek API；无 API Key 时 fallback 到 mockGenerator（结果附注说明）；
 * API 请求失败时抛出错误（由 View 层展示）。
 *
 * @param {object} params - { docType, sourceProject, sourceRange, structureGuide }
 * @param {object} stores - { tasksStore, projectsStore, materialsStore, stylesStore }
 * @returns {Promise<{ doc: string, context: object, source: 'deepseek'|'mock' }>}
 */
export async function generateDocument(params, stores) {
  const context  = buildContext(params, stores)
  const messages = buildMessages(context)

  // 调用 /api/ai 代理；失败时抛出，由 View 层展示错误
  // 本地开发需使用 `vercel dev` 启动，否则 /api/ai 不可用
  try {
    const doc = await callDeepSeek(messages)
    return { doc, context, source: 'deepseek' }
  } catch (err) {
    throw err
  }
}

/**
 * 返回当前参数将读取哪些数据的简要描述（UI 提示用）
 */
export function describeDataSources(params, stores) {
  const { docType, sourceProject } = params
  const projectLabel = sourceProject ? `「${sourceProject}」专项` : '所有专项'

  switch (docType) {
    case 'weekly':
      return `本周任务（按 week 字段）、${projectLabel}本周进展更新、本周新增资料、周复盘笔记`

    case 'monthly': {
      const now = new Date()
      return `${now.getMonth() + 1}月有变动的任务（按 updated_at）、${projectLabel}本月新增进展、本月新增资料`
    }

    case 'project': {
      const p = sourceProject
        ? stores.projectsStore.items.find(p => p.name === sourceProject)
        : null
      if (!p) return '请先选择具体专项'
      const taskCount      = stores.tasksStore.items.filter(t => t.project === p.name).length
      const updateCount    = p.updates.length
      const judgementCount = p.judgements.length
      const focusHint = (params.sourceRange && params.sourceRange !== 'this-week')
        ? `（聚焦${params.sourceRange === 'last-week' ? '上周' : '本月'}）`
        : '（完整历史）'
      return `当前判断、进展时间线（${updateCount} 条）、关联任务（${taskCount} 项）、判断历史（${judgementCount} 条）、相关资料${focusHint}`
    }

    case 'review':
      return `本周任务、周复盘笔记（未完成原因主来源）、${projectLabel}本周进展`

    case 'free':
      return `${projectLabel}全量任务与判断历史、进展时间线、相关资料、文风参考`

    default:
      return '任务记录、专项进展、资料库、文风参考'
  }
}
