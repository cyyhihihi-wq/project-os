/**
 * AI 整理服务（Organize Prompt）
 * 用于 QuickCapture / 资料库 / 专项进展的「保存并 AI 整理」。
 *
 * 与文档生成（aiService.js）使用完全独立的 Prompt 体系，底层共用 deepseekClient.js。
 * 所有函数返回结构化 JSON，不返回 Markdown 长文档。
 *
 * 返回结构统一为：
 *   { title: string, content: string, suggestedTags: string[] }
 */

import { callDeepSeek } from './deepseekClient.js'

// ---------------------------------------------------------------------------
// System Prompt — Organize
// ---------------------------------------------------------------------------

const ORGANIZE_SYSTEM_PROMPT = `你是一名工作记录整理助手。

你的任务是把用户输入的原始内容整理为适合系统存档的结构化信息。

原则：
1. 保留原始信息，不允许删减关键事实
2. 可以进行语言整理和逻辑重组
3. 可以做有限推论，但必须基于已有信息
4. 不允许编造事实或新增事件
5. 重点是结构清晰，而不是缩写摘要

整理目标：
- 提炼一个清晰标题
- 整理成结构完整的正文
- 保留关键信息

输出必须为 JSON 格式，不要附加任何说明文字、引导语或代码块标记。`

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/** 剥离 HTML 标签，输出纯文本给 AI */
function stripHtml(html) {
  if (!html) return ''
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

/** 从模型返回中提取 JSON 字符串，兼容 ```json ... ``` 包裹 */
function extractJson(raw) {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()
  const start = raw.indexOf('{')
  const end   = raw.lastIndexOf('}')
  if (start !== -1 && end !== -1) return raw.slice(start, end + 1)
  return raw
}

/**
 * 调用 DeepSeek 并解析 JSON 结果
 * 调用方负责构造 userPrompt，本函数只负责调用和解析。
 */
async function callOrganize(userPrompt) {
  const messages = [
    { role: 'system', content: ORGANIZE_SYSTEM_PROMPT },
    { role: 'user',   content: userPrompt },
  ]

  const raw = await callDeepSeek(messages)  // 无 key / 网络错误时直接上抛

  const jsonStr = extractJson(raw)
  let result
  try {
    result = JSON.parse(jsonStr)
  } catch {
    const err = new Error(`AI 返回格式异常，无法解析 JSON。原始内容：${raw.slice(0, 200)}`)
    err.code = 'BAD_JSON'
    throw err
  }

  if (!result.title) {
    const err = new Error('AI 返回数据缺少 title 字段，整理失败。')
    err.code = 'BAD_JSON'
    throw err
  }

  return result
}

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

/**
 * 整理专项进展（新增 / 编辑时调用）
 *
 * @param {string} rawContent - 原始内容（可含 HTML）
 * @param {string} [projectName] - 所在专项名（可选，提供上下文）
 * @returns {Promise<{ title: string, content: string, suggestedTags: string[] }>}
 */
export async function organizeProgress(rawContent, projectName) {
  const plain = stripHtml(rawContent)
  const contextHint = projectName ? `所属专项：${projectName}\n\n` : ''

  const userPrompt = `${contextHint}请将以下专项进展原始记录整理为结构化内容：

${plain}

输出 JSON（不要附加任何说明文字）：
{
  "title": "适合时间线展示的标题（20字以内，概括核心事件）",
  "content": "整理后的正文（保留所有关键信息，语言清晰书面，可适当分段，不删减重要细节）",
  "suggestedTags": ["标签1", "标签2"]
}`

  return callOrganize(userPrompt)
}

/**
 * 整理资料库条目（新增 / 编辑时调用）
 *
 * @param {string} rawContent - 原始内容（可含 HTML）
 * @param {string} [currentTitle] - 用户填写的标题（可选，供参考）
 * @returns {Promise<{ title: string, content: string, suggestedTags: string[] }>}
 */
export async function organizeMaterial(rawContent, currentTitle) {
  const plain = stripHtml(rawContent)
  const titleHint = currentTitle ? `当前标题（可参考）：${currentTitle}\n\n` : ''

  const userPrompt = `${titleHint}请将以下资料内容整理为结构化存档：

${plain}

输出 JSON（不要附加任何说明文字）：
{
  "title": "简明的资料标题（30字以内，准确反映内容主题）",
  "content": "整理后的正文（保留关键信息，结构清晰，不缩写为过短摘要）",
  "suggestedTags": ["标签1", "标签2"]
}`

  return callOrganize(userPrompt)
}

/**
 * 整理快速记录（QuickCapture 的「保存并 AI 整理」）
 *
 * @param {string} text - 原始文本输入（纯文本）
 * @param {'progress'|'material'|'idea'} captureType - 记录类型
 * @param {string} [projectName] - 关联专项名（progress 类型时有效）
 * @returns {Promise<{ title: string, content: string, suggestedTags: string[] }>}
 */
export async function organizeCapture(text, captureType, projectName) {
  if (captureType === 'progress') {
    const contextHint = projectName ? `所属专项：${projectName}\n\n` : ''
    const userPrompt = `${contextHint}请将以下专项进展快速记录整理为结构化内容：

${text}

输出 JSON（不要附加任何说明文字）：
{
  "title": "适合时间线展示的标题（20字以内）",
  "content": "整理后的正文（保留关键信息，语言清晰书面）",
  "suggestedTags": ["标签1", "标签2"]
}`
    return callOrganize(userPrompt)
  } else {
    const typeLabel = captureType === 'idea' ? '想法碎片' : '材料记录'
    const userPrompt = `请将以下${typeLabel}整理为结构化存档：

${text}

输出 JSON（不要附加任何说明文字）：
{
  "title": "简明标题（30字以内）",
  "content": "整理后的正文（保留关键信息，结构清晰，不过度压缩）",
  "suggestedTags": ["标签1", "标签2"]
}`
    return callOrganize(userPrompt)
  }
}
