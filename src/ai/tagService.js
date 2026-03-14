/**
 * AI 标签推荐服务（Tag Prompt）
 * 独立于 organizeService，用于只需要标签建议而不需要整理全文的场景。
 *
 * 底层复用 deepseekClient.js。
 * 返回结构：{ tags: string[] }
 */

import { callDeepSeek } from './deepseekClient.js'

// ---------------------------------------------------------------------------
// System Prompt — Tag
// ---------------------------------------------------------------------------

const TAG_SYSTEM_PROMPT = `根据输入内容推荐最合适的标签。

规则：
1. 优先使用系统已有标签：决策、数据、实验、会议、外部信息、思路、难点
2. 推荐 2-3 个标签
3. 不要编造不存在的信息
4. 标签只用于分类，不做内容描述

输出必须为 JSON 格式，不要附加任何说明文字：
{
  "tags": ["标签1", "标签2"]
}`

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function extractJson(raw) {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()
  const start = raw.indexOf('{')
  const end   = raw.lastIndexOf('}')
  if (start !== -1 && end !== -1) return raw.slice(start, end + 1)
  return raw
}

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

/**
 * 根据内容推荐标签
 *
 * @param {string} content - 需要打标签的文本内容（纯文本或 HTML 均可）
 * @returns {Promise<{ tags: string[] }>}
 *
 * @throws 错误对象附带 code 字段（来自 deepseekClient 或 'BAD_JSON'）
 */
export async function suggestTags(content) {
  // 剥离 HTML
  const plain = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

  const messages = [
    { role: 'system', content: TAG_SYSTEM_PROMPT },
    { role: 'user',   content: `请为以下内容推荐标签：\n\n${plain}` },
  ]

  const raw = await callDeepSeek(messages)

  const jsonStr = extractJson(raw)
  let result
  try {
    result = JSON.parse(jsonStr)
  } catch {
    const err = new Error(`标签推荐返回格式异常：${raw.slice(0, 120)}`)
    err.code = 'BAD_JSON'
    throw err
  }

  if (!Array.isArray(result.tags)) {
    const err = new Error('标签推荐返回数据缺少 tags 数组')
    err.code = 'BAD_JSON'
    throw err
  }

  return result
}
