<script setup>
import { ref, computed, onMounted } from 'vue'
import { useProjectsStore } from '../../stores/projects.js'
import { useTasksStore } from '../../stores/tasks.js'
import { useDocsStore, PERIOD_LABELS } from '../../stores/docs.js'
import { htmlToText } from '../../ai/contextBuilders.js'

const emit = defineEmits(['close'])

const projectsStore = useProjectsStore()
const tasksStore = useTasksStore()
const docsStore = useDocsStore()

// ── 持久化 key ──
const RULES_KEY = 'work_export_rules'
const DEFAULT_RULES = `规则一：项目进展重要性高于任务，优先在报告中体现。
规则二：B站-周边业务支持专项，可根据标签（如"决策"/"数据"/"实验"）聚合同类工作。`

// ── 通用规则 ──
const rulesText = ref(DEFAULT_RULES)
const includeRules = ref(true)
const editingRules = ref(false)

function saveRules() {
  localStorage.setItem(RULES_KEY, rulesText.value)
  editingRules.value = false
}

function resetRules() {
  rulesText.value = DEFAULT_RULES
  localStorage.setItem(RULES_KEY, DEFAULT_RULES)
}

// ── 导出格式 ──
const exportFormat = ref('html') // 'html' | 'txt'

// ── 日期范围 ──
const dateStart = ref('')
const dateEnd = ref('')

// ── 专项选择 ──
const selectedProjectIds = ref([])
const allProjectIds = computed(() => projectsStore.items.map(p => p.id))
const allSelected = computed(
  () => allProjectIds.value.length > 0 &&
    allProjectIds.value.every(id => selectedProjectIds.value.includes(id))
)

function toggleAllProjects() {
  selectedProjectIds.value = allSelected.value ? [] : [...allProjectIds.value]
}
function toggleProject(id) {
  const idx = selectedProjectIds.value.indexOf(id)
  if (idx === -1) selectedProjectIds.value.push(id)
  else selectedProjectIds.value.splice(idx, 1)
}

// ── 导出范围 ──
const includeUpdates = ref(true)
const includeTasks = ref(true)
const includeDocs = ref(true)

// ── 文档：周期性自动匹配，阶段性手动选择 ──
const selectedMilestoneDocIds = ref([])

// 在当前日期范围内自动匹配的周期性文档
const matchedPeriodicDocs = computed(() =>
  docsStore.matchPeriodic(dateStart.value, dateEnd.value)
)
// 阶段性文档列表（全部，供手动勾选）
const milestoneDocs = computed(() => docsStore.milestones)

function toggleMilestoneDoc(id) {
  const idx = selectedMilestoneDocIds.value.indexOf(id)
  if (idx === -1) selectedMilestoneDocIds.value.push(id)
  else selectedMilestoneDocIds.value.splice(idx, 1)
}

// 初始化
onMounted(() => {
  selectedProjectIds.value = [...allProjectIds.value]
  // 阶段性文档默认不选（需手动圈定）
  selectedMilestoneDocIds.value = []
  const saved = localStorage.getItem(RULES_KEY)
  if (saved !== null) rulesText.value = saved
})

// ── 辅助 ──
const STATUS_LABEL = { active: '进行中', done: '已完成', paused: '暂停' }
const TASK_STATUS_LABEL = { todo: '待办', doing: '进行中', done: '已完成' }

function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}
function fmtDateTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${fmtDate(iso)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
function noDateFilter() { return !dateStart.value && !dateEnd.value }
function inDateRange(isoStr) {
  if (!isoStr) return false
  const d = new Date(isoStr)
  if (dateStart.value && d < new Date(dateStart.value + 'T00:00:00')) return false
  if (dateEnd.value && d > new Date(dateEnd.value + 'T23:59:59')) return false
  return true
}
function taskInRange(t) {
  if (noDateFilter()) return true
  return inDateRange(t.created_at) || inDateRange(t.updated_at) || (t.completed_at && inDateRange(t.completed_at))
}

// HTML 转纯文本，图片替换为 [见图N] 占位
function htmlToTextWithImages(html, imgCounter) {
  if (!html) return ''
  const modified = html.replace(/<img[^>]*>/gi, () => {
    imgCounter.count++
    return `<span>[见图${imgCounter.count}]</span>`
  })
  return htmlToText(modified)
}

// 按选中专项过滤任务
function getTasksToExport() {
  const selectedProjects = projectsStore.items.filter(p => selectedProjectIds.value.includes(p.id))
  const selectedProjectNames = new Set(selectedProjects.map(p => p.name))
  return tasksStore.items.filter(t => {
    if (t.status === 'doing') return false  // 进行中未完成，不导出
    if (!taskInRange(t)) return false
    if (t.project || t.project_id) {
      if (t.project_id && selectedProjectIds.value.includes(t.project_id)) return true
      if (t.project && selectedProjectNames.has(t.project)) return true
      return false
    }
    return true
  })
}

// ══════════════════════════════════════
//  TXT 生成
// ══════════════════════════════════════
function generateTxt() {
  const SEP1 = '═'.repeat(52)
  const SEP2 = '─'.repeat(52)
  const lines = []
  const imgCounter = { count: 0 }

  // 头部
  const rangeLabel = noDateFilter() ? '全部（未指定范围）' : `${dateStart.value || '最早'} 至 ${dateEnd.value || '今天'}`
  const scopeLabel = [includeUpdates.value && '专项进展', includeTasks.value && '任务'].filter(Boolean).join(' + ')

  lines.push(SEP1)
  lines.push('  工 作 内 容 导 出')
  lines.push(SEP1)
  lines.push(`  导出时间：${fmtDateTime(new Date().toISOString())}`)
  lines.push(`  日期范围：${rangeLabel}`)
  lines.push(`  包含内容：${scopeLabel}`)
  lines.push(SEP1)

  // 通用规则
  if (includeRules.value && rulesText.value.trim()) {
    lines.push('')
    lines.push('【通用规则（供 AI 参考）】')
    lines.push(SEP2)
    rulesText.value.trim().split('\n').forEach(l => lines.push(l))
    lines.push(SEP2)
  }

  // ── 专项进展 ──
  if (includeUpdates.value) {
    const selectedProjects = projectsStore.items.filter(p => selectedProjectIds.value.includes(p.id))
    for (const project of selectedProjects) {
      const updates = (project.updates || [])
        .filter(u => noDateFilter() || inDateRange(u.created_at))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      const latestJudgement = (project.judgements || [])[0]

      // 无内容则跳过
      if (!latestJudgement && updates.length === 0) continue

      lines.push('')
      lines.push('')
      lines.push(`【专项：${project.name}】  ${STATUS_LABEL[project.status] || project.status}`)
      lines.push(SEP2)

      // 当前判断
      if (latestJudgement) {
        lines.push('')
        lines.push(`▌ 当前判断（${fmtDate(latestJudgement.created_at)}）`)
        const text = htmlToTextWithImages(latestJudgement.content, imgCounter)
        if (text) text.split('\n').forEach(l => lines.push('  ' + l))
      }

      // 进展时间线
      if (updates.length > 0) {
        lines.push('')
        lines.push(`▌ 进展时间线（共 ${updates.length} 条${noDateFilter() ? '' : '，已按日期筛选'}）`)
        for (const u of updates) {
          lines.push('')
          const prefix = u.highlight ? '[⭐核心进展]' : '[进展]'
          const tagsStr = (u.tags || []).length > 0 ? `  | 标签：${u.tags.join('、')}` : ''
          lines.push(`${prefix}  ${fmtDate(u.created_at)}  ${u.title}${tagsStr}`)
          const body = htmlToTextWithImages(u.content, imgCounter)
          if (body) body.split('\n').forEach(l => { if (l.trim()) lines.push('  ' + l) })
        }
      }
    }
  }

  // ── 任务 ──
  if (includeTasks.value) {
    const tasksToExport = getTasksToExport()
    if (tasksToExport.length > 0) {
      lines.push('')
      lines.push('')
      lines.push(SEP1)
      lines.push(`【任务列表】  共 ${tasksToExport.length} 条`)
      lines.push(SEP1)
      for (const status of ['todo', 'done']) {
        const group = tasksToExport.filter(t => t.status === status)
        if (!group.length) continue
        lines.push('')
        lines.push(`■ ${TASK_STATUS_LABEL[status]}（${group.length} 条）`)
        lines.push('')
        for (const t of group) {
          const projectStr = t.project ? `[${t.project}] ` : ''
          const doneStr = status === 'done' && t.completed_at ? `  ✓ 完成于 ${fmtDate(t.completed_at)}` : ''
          lines.push(`  ${projectStr}${t.title}${doneStr}`)
          if (t.note) {
            const noteText = htmlToText(t.note)
            if (noteText) {
              const brief = noteText.replace(/\n+/g, ' ').trim().slice(0, 120)
              lines.push(`  备注：${brief}${noteText.length > 120 ? '…' : ''}`)
            }
          }
          lines.push(`  创建：${fmtDate(t.created_at)}`)
          lines.push('')
        }
      }
    }
  }

  // ── 文档成果 ──
  if (includeDocs.value) {
    const docsToExport = [
      ...matchedPeriodicDocs.value,
      ...docsStore.items.filter(d => d.type === 'milestone' && selectedMilestoneDocIds.value.includes(d.id)),
    ]
    if (docsToExport.length > 0) {
      lines.push('')
      lines.push('')
      lines.push(SEP1)
      lines.push(`【文档成果】  共 ${docsToExport.length} 篇`)
      lines.push(SEP1)
      for (const doc of docsToExport) {
        lines.push('')
        const typeLabel = doc.type === 'milestone'
          ? `阶段性 · ${doc.date || ''}`
          : `${PERIOD_LABELS[doc.period_type] || doc.period_type} · ${[doc.period_start, doc.period_end].filter(Boolean).join(' ~ ')}`
        const projectStr = doc.project ? `  [${doc.project}]` : ''
        lines.push(`▌ ${doc.title}  （${typeLabel}）${projectStr}`)
        lines.push(SEP2)
        const body = htmlToTextWithImages(doc.content, imgCounter)
        if (body) body.split('\n').forEach(l => { if (l.trim()) lines.push('  ' + l) })
        else lines.push('  （无内容）')
      }
    }
  }

  // 图片提示
  if (imgCounter.count > 0) {
    lines.push('')
    lines.push(SEP2)
    lines.push(`  ⚠ 本文档含 ${imgCounter.count} 张图片，已用 [见图N] 标注位置。`)
    lines.push('  建议使用 HTML 格式导出以获取完整图片内容。')
    lines.push(SEP2)
  }

  lines.push('')
  lines.push(SEP1)
  lines.push('  — 导出结束 —')
  lines.push(SEP1)
  return lines.join('\n')
}

// ══════════════════════════════════════
//  HTML 生成
// ══════════════════════════════════════
function generateHtml() {
  const rangeLabel = noDateFilter() ? '全部' : `${dateStart.value || '最早'} 至 ${dateEnd.value || '今天'}`
  const scopeLabel = [includeUpdates.value && '专项进展', includeTasks.value && '任务'].filter(Boolean).join(' + ')
  const today = fmtDate(new Date().toISOString())

  const css = `
    *{box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;max-width:860px;margin:0 auto;padding:32px 20px;color:#1a1a1a;line-height:1.7;font-size:15px;background:#fff}
    h1{font-size:20px;font-weight:700;border-bottom:2px solid #222;padding-bottom:10px;margin:0 0 4px}
    h2{font-size:16px;font-weight:700;margin:36px 0 8px;padding-bottom:6px;border-bottom:1px solid #e0e0e0;color:#111}
    h3{font-size:14px;font-weight:600;color:#555;margin:14px 0 6px}
    p{margin:0 0 8px}
    .meta{color:#888;font-size:13px;margin-bottom:24px}
    .rules-box{background:#fffbeb;border:1px solid #fcd34d;border-radius:6px;padding:14px 16px;margin:20px 0 28px}
    .rules-box-title{font-size:13px;font-weight:700;color:#92400e;margin-bottom:8px}
    .rules-box pre{font-family:inherit;font-size:14px;white-space:pre-wrap;margin:0;color:#78350f;line-height:1.7}
    .project-block{margin-bottom:40px}
    .project-title{font-size:17px;font-weight:700;margin:0}
    .project-status{font-size:12px;padding:2px 8px;border-radius:12px;font-weight:600;vertical-align:middle;margin-left:8px}
    .status-active{background:#dbeafe;color:#1d4ed8}
    .status-done{background:#dcfce7;color:#15803d}
    .status-paused{background:#fef3c7;color:#b45309}
    .judgement-box{background:#f0f4ff;border-left:3px solid #6366f1;padding:10px 14px;border-radius:0 6px 6px 0;margin:10px 0 18px;font-size:14px}
    .update-card{border:1px solid #e8e8e8;border-radius:8px;margin-bottom:16px;overflow:hidden}
    .update-card.highlight{border-color:#fbbf24}
    .update-header{background:#f7f7f7;padding:8px 12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;color:#555}
    .update-card.highlight .update-header{background:#fffbeb}
    .update-body{padding:12px 14px;font-size:14px}
    .update-body img{max-width:100%;height:auto;border-radius:4px;margin:8px 0;display:block}
    .update-body p{margin:0 0 6px}
    .update-body ul,.update-body ol{margin:4px 0 8px;padding-left:20px}
    .badge-star{background:#f59e0b;color:#fff;font-size:11px;padding:2px 7px;border-radius:3px;font-weight:700}
    .badge-date{color:#777;font-size:12px}
    .badge-title{font-weight:600;color:#222;font-size:13px}
    .badge-tag{background:#eff6ff;color:#3b82f6;font-size:11px;padding:2px 6px;border-radius:3px;margin-right:3px}
    .no-content{color:#aaa;font-style:italic;font-size:13px;padding:6px 0}
    .task-section{margin-bottom:32px}
    .task-group-title{font-size:14px;font-weight:700;padding:6px 10px;border-radius:4px;margin-bottom:8px}
    .doing-title{background:#dbeafe;color:#1e40af}
    .todo-title{background:#f3f4f6;color:#374151}
    .done-title{background:#dcfce7;color:#166534}
    .task-item{padding:8px 10px;border-bottom:1px solid #f3f3f3;font-size:14px}
    .task-item:last-child{border-bottom:none}
    .task-project-badge{font-size:11px;background:#ede9fe;color:#6d28d9;padding:1px 6px;border-radius:3px;font-weight:600;margin-right:6px}
    .task-note{color:#777;font-size:12px;margin-top:2px}
    .task-meta{color:#bbb;font-size:11px;margin-top:2px}
    .task-done-mark{color:#16a34a;font-weight:600}
  `

  let body = ''

  // 头部
  body += `<h1>工作内容导出</h1>`
  body += `<div class="meta">导出时间：${fmtDateTime(new Date().toISOString())} &nbsp;|&nbsp; 日期范围：${rangeLabel} &nbsp;|&nbsp; 内容：${scopeLabel}</div>`

  // 通用规则
  if (includeRules.value && rulesText.value.trim()) {
    body += `<div class="rules-box">`
    body += `<div class="rules-box-title">通用规则（供 AI 参考）</div>`
    body += `<pre>${escapeHtml(rulesText.value.trim())}</pre>`
    body += `</div>`
  }

  // 专项进展
  if (includeUpdates.value) {
    const selectedProjects = projectsStore.items.filter(p => selectedProjectIds.value.includes(p.id))
    for (const project of selectedProjects) {
      const updates = (project.updates || [])
        .filter(u => noDateFilter() || inDateRange(u.created_at))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      const latestJudgement = (project.judgements || [])[0]

      if (!latestJudgement && updates.length === 0) continue

      const statusClass = `status-${project.status}`
      const statusLabel = STATUS_LABEL[project.status] || project.status

      body += `<div class="project-block">`
      body += `<h2><span class="project-title">${escapeHtml(project.name)}</span><span class="project-status ${statusClass}">${statusLabel}</span></h2>`

      // 当前判断
      if (latestJudgement) {
        body += `<h3>当前判断 <span style="color:#aaa;font-size:12px;font-weight:400">（${fmtDate(latestJudgement.created_at)}）</span></h3>`
        body += `<div class="judgement-box">${latestJudgement.content || '<em>（无内容）</em>'}</div>`
      }

      // 进展时间线
      if (updates.length > 0) {
        body += `<h3>进展时间线 <span style="color:#aaa;font-size:12px;font-weight:400">共 ${updates.length} 条</span></h3>`
        for (const u of updates) {
          const isHighlight = !!u.highlight
          const tagsHtml = (u.tags || []).map(t => `<span class="badge-tag">${escapeHtml(t)}</span>`).join('')
          body += `<div class="update-card${isHighlight ? ' highlight' : ''}">`
          body += `<div class="update-header">`
          if (isHighlight) body += `<span class="badge-star">⭐ 核心进展</span>`
          body += `<span class="badge-date">${fmtDate(u.created_at)}</span>`
          body += `<span class="badge-title">${escapeHtml(u.title || '')}</span>`
          if (tagsHtml) body += `<span>${tagsHtml}</span>`
          body += `</div>`
          body += `<div class="update-body">${u.content || '<em class="no-content">（无内容）</em>'}</div>`
          body += `</div>`
        }
      }

      body += `</div>`
    }
  }

  // 任务
  if (includeTasks.value) {
    const tasksToExport = getTasksToExport()
    if (tasksToExport.length > 0) {
      body += `<div class="task-section">`
      body += `<h2>任务列表 <span style="color:#aaa;font-size:13px;font-weight:400">共 ${tasksToExport.length} 条</span></h2>`
      const statusOrder = [
        { key: 'todo', label: '待办', cls: 'todo-title' },
        { key: 'done', label: '已完成', cls: 'done-title' },
      ]
      for (const { key, label, cls } of statusOrder) {
        const group = tasksToExport.filter(t => t.status === key)
        if (!group.length) continue
        body += `<div class="task-group-title ${cls}">${label}（${group.length} 条）</div>`
        body += `<div style="border:1px solid #eee;border-radius:6px;margin-bottom:12px">`
        for (const t of group) {
          const projBadge = t.project ? `<span class="task-project-badge">${escapeHtml(t.project)}</span>` : ''
          const doneStr = key === 'done' && t.completed_at
            ? `<span class="task-done-mark"> ✓ 完成于 ${fmtDate(t.completed_at)}</span>` : ''
          body += `<div class="task-item">`
          body += `${projBadge}${escapeHtml(t.title || '')}${doneStr}`
          if (t.note) {
            const noteText = htmlToText(t.note).replace(/\n+/g, ' ').trim().slice(0, 150)
            if (noteText) body += `<div class="task-note">备注：${escapeHtml(noteText)}${t.note.length > 150 ? '…' : ''}</div>`
          }
          body += `<div class="task-meta">创建：${fmtDate(t.created_at)}</div>`
          body += `</div>`
        }
        body += `</div>`
      }
      body += `</div>`
    }
  }

  // 文档成果
  if (includeDocs.value) {
    const docsToExport = [
      ...matchedPeriodicDocs.value,
      ...docsStore.items.filter(d => d.type === 'milestone' && selectedMilestoneDocIds.value.includes(d.id)),
    ]
    if (docsToExport.length > 0) {
      body += `<div class="task-section">`
      body += `<h2>文档成果 <span style="color:#aaa;font-size:13px;font-weight:400">共 ${docsToExport.length} 篇</span></h2>`
      for (const doc of docsToExport) {
        const typeLabel = doc.type === 'milestone'
          ? `阶段性 · ${doc.date || ''}`
          : `${PERIOD_LABELS[doc.period_type] || doc.period_type} · ${[doc.period_start, doc.period_end].filter(Boolean).join(' ~ ')}`
        body += `<div style="border:1px solid #e8e8e8;border-radius:8px;margin-bottom:16px;overflow:hidden">`
        body += `<div style="background:#f7f7f7;padding:8px 14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">`
        body += `<span style="font-weight:700;font-size:14px">${escapeHtml(doc.title)}</span>`
        body += `<span style="font-size:12px;color:#777">${escapeHtml(typeLabel)}</span>`
        if (doc.project) body += `<span style="font-size:11px;background:#ede9fe;color:#6d28d9;padding:1px 6px;border-radius:3px">${escapeHtml(doc.project)}</span>`
        body += `</div>`
        body += `<div style="padding:14px;font-size:14px;line-height:1.75">${doc.content || '<em style="color:#aaa">（无内容）</em>'}</div>`
        body += `</div>`
      }
      body += `</div>`
    }
  }

  const html = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>工作内容导出 ${today}</title>
<style>${css}</style>
</head>
<body>
${body}
</body>
</html>`
  return html
}

function escapeHtml(str) {
  if (!str) return ''
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ── 预览 ──
const previewText = ref('')
const showPreview = ref(false)
const previewEdited = ref(false) // 用户是否修改过预览内容

function preview() {
  // 两种格式都生成 TXT 供编辑；HTML 导出时另行生成（不受编辑影响，保留图片）
  previewText.value = generateTxt()
  previewEdited.value = false
  showPreview.value = true
}

function regeneratePreview() {
  previewText.value = generateTxt()
  previewEdited.value = false
}

// ── 下载 ──
function download() {
  localStorage.setItem(RULES_KEY, rulesText.value)

  let content, mime, ext
  if (exportFormat.value === 'html') {
    // HTML 始终重新生成（保留图片），文字预览仅供参考
    content = generateHtml()
    mime = 'text/html;charset=utf-8'
    ext = 'html'
  } else {
    // TXT：用预览框中的内容（用户可能已手动删改）
    content = showPreview.value ? previewText.value : generateTxt()
    mime = 'text/plain;charset=utf-8'
    ext = 'txt'
  }

  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const today = fmtDate(new Date().toISOString()).replace(/\//g, '-')
  a.download = `工作内容_${today}.${ext}`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  emit('close')
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div
      class="modal"
      style="max-width:520px;width:100%;max-height:88vh;overflow-y:auto;display:flex;flex-direction:column;gap:0"
    >
      <!-- 头部 -->
      <div class="flex-between" style="margin-bottom:16px">
        <h3 style="margin:0;font-size:16px">导出工作内容</h3>
        <button
          class="small"
          style="width:24px;height:24px;padding:0;display:flex;align-items:center;justify-content:center;font-size:16px"
          @click="emit('close')"
        >×</button>
      </div>

      <!-- 导出格式 -->
      <div class="mb-12">
        <div class="text-xs text-secondary" style="font-weight:600;margin-bottom:6px">导出格式</div>
        <div class="flex gap-12">
          <label
            class="flex gap-6"
            style="align-items:center;cursor:pointer;padding:8px 12px;border-radius:var(--radius);border:1px solid var(--color-border);flex:1"
            :style="{ borderColor: exportFormat==='html' ? 'var(--color-primary)' : '', background: exportFormat==='html' ? 'var(--color-primary-light)' : '' }"
          >
            <input type="radio" v-model="exportFormat" value="html" style="flex-shrink:0" />
            <div>
              <div class="text-sm" style="font-weight:600">HTML <span style="font-size:11px;color:var(--color-primary)">(推荐)</span></div>
              <div class="text-xs text-secondary">含图片，可上传给 ChatGPT</div>
            </div>
          </label>
          <label
            class="flex gap-6"
            style="align-items:center;cursor:pointer;padding:8px 12px;border-radius:var(--radius);border:1px solid var(--color-border);flex:1"
            :style="{ borderColor: exportFormat==='txt' ? 'var(--color-primary)' : '', background: exportFormat==='txt' ? 'var(--color-primary-light)' : '' }"
          >
            <input type="radio" v-model="exportFormat" value="txt" style="flex-shrink:0" />
            <div>
              <div class="text-sm" style="font-weight:600">TXT</div>
              <div class="text-xs text-secondary">纯文本，快速粘贴用</div>
            </div>
          </label>
        </div>
      </div>

      <!-- 日期范围 -->
      <div class="mb-12">
        <div class="text-xs text-secondary" style="font-weight:600;margin-bottom:6px">日期范围</div>
        <div class="flex gap-8" style="align-items:center">
          <input type="date" v-model="dateStart" style="flex:1;font-size:13px" />
          <span class="text-xs text-secondary" style="flex-shrink:0">至</span>
          <input type="date" v-model="dateEnd" style="flex:1;font-size:13px" />
          <button
            v-if="dateStart || dateEnd"
            class="small"
            style="flex-shrink:0;font-size:11px"
            @click="dateStart = ''; dateEnd = ''"
          >清除</button>
        </div>
        <div class="text-xs text-secondary" style="margin-top:4px">不填则导出全部</div>
      </div>

      <!-- 导出内容 -->
      <div class="mb-12">
        <div class="text-xs text-secondary" style="font-weight:600;margin-bottom:6px">导出内容</div>
        <div class="flex gap-16">
          <label class="flex gap-6" style="align-items:center;cursor:pointer">
            <input type="checkbox" v-model="includeUpdates" />
            <span class="text-sm">专项进展</span>
          </label>
          <label class="flex gap-6" style="align-items:center;cursor:pointer">
            <input type="checkbox" v-model="includeTasks" />
            <span class="text-sm">任务</span>
          </label>
          <label class="flex gap-6" style="align-items:center;cursor:pointer">
            <input type="checkbox" v-model="includeDocs" />
            <span class="text-sm">文档成果</span>
          </label>
        </div>
      </div>

      <!-- 文档成果选择（includeDocs 开启时显示） -->
      <div v-if="includeDocs && docsStore.items.length > 0" class="mb-12" style="border:1px solid var(--color-border);border-radius:var(--radius);overflow:hidden">
        <div style="padding:8px 12px;background:var(--color-bg);border-bottom:1px solid var(--color-border);font-size:12px;font-weight:600;color:var(--color-text-secondary)">
          文档成果配置
        </div>
        <div style="padding:10px 12px">
          <!-- 周期性：自动匹配 -->
          <div class="mb-8">
            <div class="flex-between">
              <span class="text-xs text-secondary">周期性文档（自动匹配日期范围）</span>
              <span
                class="text-xs"
                :style="{ color: matchedPeriodicDocs.length > 0 ? 'var(--color-primary)' : 'var(--color-text-secondary)' }"
              >已匹配 {{ matchedPeriodicDocs.length }} 篇</span>
            </div>
            <div v-if="matchedPeriodicDocs.length > 0" style="margin-top:6px">
              <div
                v-for="doc in matchedPeriodicDocs"
                :key="doc.id"
                class="text-xs text-secondary"
                style="padding:2px 0;padding-left:8px;border-left:2px solid var(--color-primary)"
              >
                {{ doc.title }}
                <span style="opacity:0.6">· {{ PERIOD_LABELS[doc.period_type] || doc.period_type }} · {{ [doc.period_start, doc.period_end].filter(Boolean).join(' ~ ') }}</span>
              </div>
            </div>
            <div v-else class="text-xs text-secondary" style="margin-top:4px;font-style:italic">
              {{ dateStart || dateEnd ? '当前日期范围内无匹配的周期性文档' : '未设置日期范围，将包含全部周期性文档' }}
            </div>
          </div>
          <!-- 阶段性：手动圈选 -->
          <div v-if="milestoneDocs.length > 0" style="border-top:1px solid var(--color-border);padding-top:8px">
            <div class="text-xs text-secondary" style="margin-bottom:6px">阶段性文档（手动圈选，以下文档默认不选）</div>
            <div style="max-height:120px;overflow-y:auto">
              <label
                v-for="doc in milestoneDocs"
                :key="doc.id"
                class="flex gap-8"
                style="align-items:center;cursor:pointer;padding:4px 0"
              >
                <input
                  type="checkbox"
                  :checked="selectedMilestoneDocIds.includes(doc.id)"
                  @change="toggleMilestoneDoc(doc.id)"
                />
                <span class="text-xs">{{ doc.title }}</span>
                <span class="text-xs text-secondary" style="margin-left:auto;flex-shrink:0">{{ doc.date || '-' }}</span>
              </label>
            </div>
          </div>
        </div>
      </div>
      <div v-else-if="includeDocs && docsStore.items.length === 0" class="mb-12">
        <div class="text-xs text-secondary" style="font-style:italic">暂无文档成果，请先在「文档」页面创建</div>
      </div>

      <!-- 专项选择 -->
      <div v-if="includeUpdates || includeTasks" class="mb-12">
        <div class="flex-between" style="margin-bottom:6px">
          <div class="text-xs text-secondary" style="font-weight:600">
            选择专项
            <span class="text-xs" style="font-weight:normal;margin-left:4px">（已选 {{ selectedProjectIds.length }}/{{ allProjectIds.length }}）</span>
          </div>
          <button class="small" style="font-size:11px" @click="toggleAllProjects">
            {{ allSelected ? '取消全选' : '全选' }}
          </button>
        </div>
        <div style="max-height:150px;overflow-y:auto;border:1px solid var(--color-border);border-radius:var(--radius)">
          <label
            v-for="p in projectsStore.items"
            :key="p.id"
            class="flex gap-8"
            style="align-items:center;cursor:pointer;padding:6px 10px;border-bottom:1px solid var(--color-border)"
            :style="{ background: selectedProjectIds.includes(p.id) ? 'var(--color-primary-light)' : '' }"
          >
            <input type="checkbox" :checked="selectedProjectIds.includes(p.id)" @change="toggleProject(p.id)" style="flex-shrink:0" />
            <span class="text-sm" style="flex:1">{{ p.name }}</span>
            <span
              class="tag"
              style="font-size:11px;flex-shrink:0"
              :style="{
                color: p.status === 'active' ? 'var(--color-primary)' : p.status === 'done' ? 'var(--color-success)' : 'var(--color-warning)',
                borderColor: p.status === 'active' ? 'var(--color-primary)' : p.status === 'done' ? 'var(--color-success)' : 'var(--color-warning)',
              }"
            >{{ STATUS_LABEL[p.status] }}</span>
          </label>
          <div v-if="!projectsStore.items.length" class="text-xs text-secondary" style="padding:12px;text-align:center">暂无专项</div>
        </div>
      </div>

      <!-- 通用规则 -->
      <div class="mb-12" style="border:1px solid var(--color-border);border-radius:var(--radius);overflow:hidden">
        <div
          class="flex-between"
          style="padding:8px 12px;background:var(--color-bg);border-bottom:1px solid var(--color-border)"
        >
          <div class="flex gap-8" style="align-items:center">
            <label class="flex gap-6" style="align-items:center;cursor:pointer">
              <input type="checkbox" v-model="includeRules" />
              <span class="text-xs text-secondary" style="font-weight:600">通用规则（导出时附在顶部）</span>
            </label>
          </div>
          <div class="flex gap-6">
            <button class="small" style="font-size:11px" @click="editingRules = !editingRules">
              {{ editingRules ? '完成' : '编辑' }}
            </button>
            <button class="small" style="font-size:11px;color:var(--color-secondary)" @click="resetRules">重置</button>
          </div>
        </div>

        <div
          v-if="editingRules"
          style="padding:10px"
        >
          <textarea
            v-model="rulesText"
            rows="4"
            style="font-size:13px;line-height:1.6;resize:vertical"
            placeholder="输入通用规则，导出时会附在内容顶部供 AI 参考..."
          ></textarea>
          <div class="flex gap-6" style="justify-content:flex-end;margin-top:6px">
            <button class="small primary" @click="saveRules">保存规则</button>
          </div>
        </div>
        <div
          v-else
          style="padding:10px 12px;font-size:12px;color:var(--color-secondary);line-height:1.65;white-space:pre-wrap"
          :style="{ opacity: includeRules ? 1 : 0.4 }"
        >{{ rulesText || '（暂无规则，点击编辑添加）' }}</div>
      </div>

      <!-- 操作按钮 -->
      <div class="flex gap-8" style="justify-content:flex-end;margin-top:4px">
        <button @click="emit('close')">取消</button>
        <button @click="preview">预览</button>
        <button
          class="primary"
          :disabled="!includeUpdates && !includeTasks && !includeDocs"
          @click="download"
        >下载 {{ exportFormat.toUpperCase() }}</button>
      </div>

      <!-- 预览区（可编辑） -->
      <div v-if="showPreview" style="margin-top:14px">
        <div class="flex-between" style="margin-bottom:6px">
          <div>
            <span class="text-xs text-secondary" style="font-weight:600">内容预览（可直接编辑删改）</span>
            <span
              v-if="exportFormat === 'html'"
              class="text-xs text-secondary"
              style="margin-left:6px;font-style:italic"
            >· HTML 下载时会另行生成含图片版本</span>
          </div>
          <div class="flex gap-6">
            <button class="small" style="font-size:11px" @click="regeneratePreview" title="放弃编辑，重新生成">重新生成</button>
            <button class="small" style="font-size:11px" @click="showPreview = false">收起</button>
          </div>
        </div>

        <!-- 可编辑文本框 -->
        <textarea
          v-model="previewText"
          @input="previewEdited = true"
          style="width:100%;height:280px;font-size:11px;line-height:1.65;font-family:monospace;resize:vertical;background:var(--color-bg);border:1px solid var(--color-border);border-radius:var(--radius);padding:12px;box-sizing:border-box"
          spellcheck="false"
        ></textarea>

        <div class="flex-between" style="margin-top:6px">
          <span
            v-if="previewEdited"
            class="text-xs"
            style="color:var(--color-warning)"
          >已编辑（TXT 格式将下载此版本）</span>
          <span v-else class="text-xs text-secondary">可删除不需要的段落后再下载</span>
          <button class="primary small" @click="download">下载 {{ exportFormat.toUpperCase() }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
