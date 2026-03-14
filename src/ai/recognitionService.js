/**
 * AI 内容识别服务（Document / Image Recognition Prompt）
 * 用于将上传文档或图片中的内容转录为结构化 Markdown 文本。
 *
 * 适用场景：
 * - 图片中的文字（OCR 识别后的原始文本）
 * - 截图内容
 * - 文档原始文本
 * - 表格截图（还原为 Markdown 表格）
 *
 * 注意：本服务接收已提取的文本内容。
 * 图片 / 文件的实际读取由调用方（文件上传组件）负责，本服务只做结构化转录。
 *
 * 底层复用 deepseekClient.js。
 * 返回：string（Markdown 格式的结构化文本）
 */

import { callDeepSeek } from './deepseekClient.js'

// ---------------------------------------------------------------------------
// System Prompt — Recognition
// ---------------------------------------------------------------------------

const RECOGNITION_SYSTEM_PROMPT = `你是一名文档识别和结构化整理助手。

你的任务是：
从用户提供的文档或图片原始内容中识别信息，并转录为结构化文本。

规则：
1. 尽可能完整识别文本内容，不遗漏信息
2. 如果存在表格，使用 Markdown 表格格式还原
3. 保持原始信息结构，不改变内容含义
4. 不编造或补充不存在的信息
5. 如果内容不清晰或无法识别，标注：（此处内容无法识别）

输出要求：
- 使用 Markdown 格式
- 表格必须使用 Markdown 表格格式
- 不添加解释
- 只输出转录后的内容正文`

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

/**
 * 识别并结构化文档 / 图片中的文本内容
 *
 * @param {string} rawText - 从文件或图片中提取的原始文本
 * @param {object} [options]
 * @param {string} [options.hint] - 可选提示，例如文件名或内容类型，帮助 AI 理解上下文
 * @returns {Promise<string>} Markdown 格式的结构化文本
 *
 * @throws 错误对象附带 code 字段（来自 deepseekClient）
 */
export async function recognizeContent(rawText, options = {}) {
  const hint = options.hint ? `文件信息：${options.hint}\n\n` : ''

  const userPrompt = `${hint}请识别并转录以下内容为结构化文本：

${rawText}`

  const messages = [
    { role: 'system', content: RECOGNITION_SYSTEM_PROMPT },
    { role: 'user',   content: userPrompt },
  ]

  // 直接返回模型输出的 Markdown 文本，不做 JSON 解析
  return callDeepSeek(messages)
}
