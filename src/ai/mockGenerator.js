/**
 * Mock AI Generator
 * 根据 context 对象中的真实数据生成文档草稿文本。
 * 不调用任何外部 API，输出基于系统中实际存在的任务、进展、资料内容。
 * 待接入真实 API 时，替换此模块即可，其余层不变。
 */

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

function truncate(str, len = 80) {
  if (!str) return ''
  return str.length > len ? str.slice(0, len) + '...' : str
}

/** 按 project 字段分组任务，返回 { projectName: [task, ...] } */
function groupByProject(tasks) {
  const groups = {}
  for (const t of tasks) {
    const key = t.project || '其他事项'
    if (!groups[key]) groups[key] = []
    groups[key].push(t)
  }
  return groups
}

/** 根据文风参考生成末尾备注 */
function styleNote(styleRefs) {
  if (!styleRefs || styleRefs.length === 0) return ''
  return `\n*文风参考：${styleRefs.map(s => s.name).join('、')}*`
}

const footer = '\n\n---\n*本文档由 AI 基于系统记录自动生成，请核实后使用。*'

// ---------------------------------------------------------------------------
// 各文档类型生成函数
// ---------------------------------------------------------------------------

function generateWeekly(ctx) {
  const { weekNo, tasks, weekReview, projectUpdates, materials } = ctx
  const { done, doing, todo, all } = tasks

  let doc = `# 第 ${weekNo} 周工作周报\n\n`
  doc += `**概述：** 本周共 ${all.length} 项任务——已完成 ${done.length} 项，进行中 ${doing.length} 项，待开始 ${todo.length} 项。\n\n`

  // 已完成（按专项分组）
  if (done.length > 0) {
    doc += `## 本周完成\n\n`
    const groups = groupByProject(done)
    for (const [proj, items] of Object.entries(groups)) {
      if (proj !== '其他事项') doc += `**${proj}**\n`
      for (const t of items) {
        const note = t.note ? `（${t.note}）` : ''
        doc += `- ${t.title}${note}\n`
      }
      doc += '\n'
    }
  }

  // 进行中
  if (doing.length > 0) {
    doc += `## 进行中\n\n`
    for (const t of doing) {
      const note = t.note ? `：${t.note}` : ''
      const due  = t.due  ? `（截止 ${t.due}）` : ''
      doc += `- **${t.title}**${due}${note}\n`
    }
    doc += '\n'
  }

  // 待完成
  if (todo.length > 0) {
    doc += `## 本周待完成\n\n`
    for (const t of todo) {
      const due = t.due ? `（截止 ${t.due}）` : ''
      doc += `- ${t.title}${due}\n`
    }
    doc += '\n'
  }

  // 未完成原因分析（doing / todo 中有 note 的任务）
  const withBlocker = [...doing, ...todo].filter(t => t.note)
  if (withBlocker.length > 0) {
    doc += `## 未完成说明\n\n`
    for (const t of withBlocker) {
      doc += `- **${t.title}**：${t.note}\n`
    }
    doc += '\n'
  }

  // 专项进展
  if (projectUpdates.length > 0) {
    doc += `## 专项进展\n\n`
    for (const pu of projectUpdates) {
      doc += `**${pu.projectName}**\n`
      for (const u of pu.updates) {
        doc += `- ${u.title}：${truncate(u.content, 80)}\n`
      }
      doc += '\n'
    }
  }

  // 周复盘备注
  if (weekReview) {
    doc += `## 本周复盘\n\n${weekReview}\n\n`
  }

  // 相关资料
  if (materials.length > 0) {
    doc += `## 相关资料\n\n`
    for (const m of materials) {
      const summary = m.ai_summary || m.raw_content
      doc += `- **${m.title}**（${m.type}）：${truncate(summary, 70)}\n`
    }
    doc += '\n'
  }

  if (all.length === 0 && projectUpdates.length === 0) {
    doc += `> 本周暂无任务或专项进展记录。\n\n`
  }

  doc += footer
  doc += styleNote(ctx.styleRefs)
  return doc
}

// ---------------------------------------------------------------------------

function generateMonthly(ctx) {
  const { tasks, projectUpdates, materials } = ctx
  const { done, doing, todo, all } = tasks
  const now = new Date()

  let doc = `# ${now.getMonth() + 1}月工作月报\n\n`
  doc += `**概述：** 本月共 ${all.length} 项任务——已完成 ${done.length} 项，进行中 ${doing.length} 项，待开始 ${todo.length} 项。\n\n`

  if (done.length > 0) {
    doc += `## 本月完成事项\n\n`
    const groups = groupByProject(done)
    for (const [proj, items] of Object.entries(groups)) {
      if (proj !== '其他事项') doc += `**${proj}**\n`
      for (const t of items) {
        const note = t.note ? `（${t.note}）` : ''
        doc += `- ${t.title}${note}\n`
      }
      doc += '\n'
    }
  }

  if (doing.length > 0) {
    doc += `## 持续推进中\n\n`
    for (const t of doing) {
      const note = t.note ? `：${t.note}` : ''
      doc += `- **${t.title}**${note}\n`
    }
    doc += '\n'
  }

  if (projectUpdates.length > 0) {
    doc += `## 各专项进展\n\n`
    for (const pu of projectUpdates) {
      doc += `**${pu.projectName}**\n`
      for (const u of pu.updates) {
        doc += `- ${u.title}（${fmtDate(u.created_at)}）：${truncate(u.content, 80)}\n`
      }
      doc += '\n'
    }
  }

  if (materials.length > 0) {
    doc += `## 相关资料\n\n`
    for (const m of materials) {
      const summary = m.ai_summary || m.raw_content
      doc += `- **${m.title}**：${truncate(summary, 70)}\n`
    }
    doc += '\n'
  }

  if (all.length === 0 && projectUpdates.length === 0) {
    doc += `> 本月暂无任务或进展记录。\n\n`
  }

  doc += footer
  doc += styleNote(ctx.styleRefs)
  return doc
}

// ---------------------------------------------------------------------------

function generateProjectReport(ctx) {
  if (!ctx.project) {
    return '未找到指定专项，请在"生成设定"中选择具体专项后再生成专项报告。'
  }

  const { project, latestJudgement, allJudgements, updates, tasks, materials } = ctx
  const { done, doing, todo, all } = tasks

  let doc = `# ${project.name} · 专项报告\n\n`

  // 当前判断
  if (latestJudgement) {
    doc += `## 当前判断\n\n`
    doc += `${latestJudgement.content}\n`
    doc += `*（${fmtDate(latestJudgement.created_at)} 更新）*\n\n`
  }

  // 历史判断（超过1条时展示）
  if (allJudgements.length > 1) {
    doc += `## 判断历史\n\n`
    for (const j of allJudgements.slice(1)) {
      doc += `- ${fmtDate(j.created_at)}：${truncate(j.content, 80)}\n`
    }
    doc += '\n'
  }

  // 进展时间线
  if (updates.length > 0) {
    doc += `## 进展时间线\n\n`
    for (const u of updates) {
      const tags = (u.tags || []).length > 0 ? ` [${u.tags.join('、')}]` : ''
      doc += `**${fmtDate(u.created_at)} · ${u.title}**${tags}\n\n`
      doc += `${u.content}\n\n`
    }
  }

  // 关联任务
  if (all.length > 0) {
    doc += `## 关联任务\n\n`
    doc += `共 ${all.length} 项：已完成 ${done.length} / 进行中 ${doing.length} / 待开始 ${todo.length}\n\n`
    if (doing.length > 0) {
      doc += `**进行中**\n`
      for (const t of doing) {
        const note = t.note ? `（${t.note}）` : ''
        const due  = t.due  ? ` 截止 ${t.due}` : ''
        doc += `- ${t.title}${note}${due}\n`
      }
      doc += '\n'
    }
    if (todo.length > 0) {
      doc += `**待开始**\n`
      for (const t of todo) {
        const due = t.due ? ` 截止 ${t.due}` : ''
        doc += `- ${t.title}${due}\n`
      }
      doc += '\n'
    }
    if (done.length > 0) {
      doc += `**已完成**\n`
      for (const t of done) doc += `- ${t.title}\n`
      doc += '\n'
    }
  } else {
    doc += `## 关联任务\n\n暂无关联任务记录。\n\n`
  }

  // 相关资料
  if (materials.length > 0) {
    doc += `## 相关资料\n\n`
    for (const m of materials) {
      const summary = m.ai_summary || m.raw_content
      doc += `- **${m.title}**（${m.type}）：${truncate(summary, 70)}\n`
    }
    doc += '\n'
  }

  doc += footer
  doc += styleNote(ctx.styleRefs)
  return doc
}

// ---------------------------------------------------------------------------

/**
 * 复盘报告：使用周报数据 + 复盘视角
 * 关注"已完成了什么 / 未完成原因 / 下一步"
 */
function generateReview(ctx) {
  const { weekNo, tasks, weekReview, projectUpdates, materials } = ctx
  const { done, doing, todo, all } = tasks
  const label = weekNo ? `第 ${weekNo} 周` : '本期'

  let doc = `# ${label}复盘\n\n`

  // 完成情况
  doc += `## 完成情况\n\n`
  if (done.length > 0) {
    doc += `**已完成（${done.length} 项）**\n`
    for (const t of done) {
      const note = t.note ? `（${t.note}）` : ''
      doc += `- ${t.title}${note}\n`
    }
    doc += '\n'
  }
  if (doing.length + todo.length > 0) {
    doc += `**未完成（${doing.length + todo.length} 项）**\n`
    for (const t of [...doing, ...todo]) {
      doc += `- ${t.title}${t.status === 'doing' ? '（进行中）' : '（未开始）'}\n`
    }
    doc += '\n'
  }
  if (all.length === 0) {
    doc += `> 暂无任务记录。\n\n`
  }

  // 未完成原因
  const withNote = [...doing, ...todo].filter(t => t.note)
  if (withNote.length > 0) {
    doc += `## 未完成原因分析\n\n`
    for (const t of withNote) {
      doc += `- **${t.title}**：${t.note}\n`
    }
    doc += '\n'
  }

  // 专项进展
  if (projectUpdates.length > 0) {
    doc += `## 专项进展\n\n`
    for (const pu of projectUpdates) {
      doc += `**${pu.projectName}**\n`
      for (const u of pu.updates) {
        doc += `- ${u.title}：${truncate(u.content, 80)}\n`
      }
      doc += '\n'
    }
  }

  // 周复盘笔记（用户手写的）
  if (weekReview) {
    doc += `## 本周复盘笔记\n\n${weekReview}\n\n`
  }

  // 相关资料
  if (materials.length > 0) {
    doc += `## 参考资料\n\n`
    for (const m of materials) {
      doc += `- **${m.title}**（${m.type}）\n`
    }
    doc += '\n'
  }

  doc += footer
  doc += styleNote(ctx.styleRefs)
  return doc
}

// ---------------------------------------------------------------------------

/**
 * 自由生成：根据 structureGuide 或默认结构
 */
function generateFreeform(ctx) {
  const { project, tasks, projectUpdates, materials, structureGuide } = ctx
  const title = project ? `${project.name} · 专项小结` : '工作小结'

  let doc = `# ${title}\n\n`

  if (structureGuide) {
    // 将结构指引拆成段落标题
    const sections = structureGuide
      .split(/[/\/\n,，、]/)
      .map(s => s.trim())
      .filter(Boolean)

    for (const section of sections) {
      doc += `## ${section}\n\n`
      const lower = section

      if (/背景|概述|简介/.test(lower)) {
        if (project) {
          const j = project.judgements?.[0]
          doc += j
            ? `${project.name} 当前状态：${truncate(j.content, 100)}\n\n`
            : `${project.name}专项处于进行中阶段。\n\n`
        } else {
          doc += `（请补充背景说明）\n\n`
        }

      } else if (/问题|风险|难点|阻碍/.test(lower)) {
        const blocked = tasks.filter(t => t.note && t.status !== 'done')
        if (blocked.length > 0) {
          for (const t of blocked) doc += `- **${t.title}**：${t.note}\n`
          doc += '\n'
        } else {
          doc += `暂无记录在案的风险或阻碍。\n\n`
        }

      } else if (/实验|方案|设计/.test(lower)) {
        const relevant = projectUpdates.flatMap(pu => pu.updates)
        if (relevant.length > 0) {
          for (const u of relevant) doc += `- ${u.title}：${truncate(u.content, 80)}\n`
          doc += '\n'
        } else {
          doc += `（待补充）\n\n`
        }

      } else if (/结果|成果|进展|完成/.test(lower)) {
        const done = tasks.filter(t => t.status === 'done')
        if (done.length > 0) {
          for (const t of done) {
            const note = t.note ? `（${t.note}）` : ''
            doc += `- ${t.title}${note}\n`
          }
          doc += '\n'
        } else {
          doc += `暂无已完成事项。\n\n`
        }

      } else if (/下一步|计划|待完成|后续/.test(lower)) {
        const pending = tasks.filter(t => t.status !== 'done')
        if (pending.length > 0) {
          for (const t of pending) {
            const due = t.due ? `（截止 ${t.due}）` : ''
            doc += `- ${t.title}${due}\n`
          }
          doc += '\n'
        } else {
          doc += `暂无待完成事项。\n\n`
        }

      } else if (/资料|参考|附件/.test(lower)) {
        if (materials.length > 0) {
          for (const m of materials) doc += `- ${m.title}（${m.type}）\n`
          doc += '\n'
        } else {
          doc += `暂无相关资料。\n\n`
        }

      } else {
        doc += `（待补充）\n\n`
      }
    }
  } else {
    // 默认结构：任务进展 + 专项进展 + 资料
    const done  = tasks.filter(t => t.status === 'done')
    const doing = tasks.filter(t => t.status === 'doing')
    const todo  = tasks.filter(t => t.status === 'todo')

    if (tasks.length > 0) {
      doc += `## 任务进展\n\n`
      if (done.length) {
        doc += `**已完成**\n`
        for (const t of done) doc += `- ${t.title}${t.note ? '（' + t.note + '）' : ''}\n`
        doc += '\n'
      }
      if (doing.length) {
        doc += `**进行中**\n`
        for (const t of doing) doc += `- ${t.title}${t.note ? '：' + t.note : ''}\n`
        doc += '\n'
      }
      if (todo.length) {
        doc += `**待开始**\n`
        for (const t of todo) doc += `- ${t.title}\n`
        doc += '\n'
      }
    }

    if (projectUpdates.length > 0) {
      doc += `## 专项动态\n\n`
      for (const pu of projectUpdates) {
        doc += `**${pu.projectName}**\n`
        for (const u of pu.updates) doc += `- ${u.title}：${truncate(u.content, 70)}\n`
        doc += '\n'
      }
    }

    if (materials.length > 0) {
      doc += `## 参考资料\n\n`
      for (const m of materials) {
        const summary = m.ai_summary || m.raw_content
        doc += `- **${m.title}**：${truncate(summary, 60)}\n`
      }
      doc += '\n'
    }

    if (tasks.length === 0 && projectUpdates.length === 0) {
      doc += `> 所选范围内暂无任务或进展记录。\n\n`
    }
  }

  doc += footer
  doc += styleNote(ctx.styleRefs)
  return doc
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

/**
 * 根据 context.type 分发到对应生成函数
 * @param {object} context - 由 contextBuilders 生成的上下文对象
 * @returns {string} 生成的文档文本
 */
export function generateFromContext(context) {
  switch (context.type) {
    case 'weekly':  return generateWeekly(context)
    case 'monthly': return generateMonthly(context)
    case 'project': return generateProjectReport(context)
    case 'review':  return generateReview(context)
    case 'freeform': return generateFreeform(context)
    default: return '未知文档类型。'
  }
}
