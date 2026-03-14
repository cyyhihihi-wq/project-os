/**
 * DeepSeek API Client
 * 前端不再直接调用 DeepSeek，改为请求本站 /api/ai 代理。
 * API Key 存放在服务端环境变量，前端不可见。
 *
 * @throws 错误对象附带 code 字段：
 *   'NETWORK_ERROR' — 网络请求失败（含本地开发时 /api/ai 不可用）
 *   'HTTP_{status}' — 代理或 DeepSeek 返回非 2xx 状态码
 *   'BAD_RESPONSE'  — 返回结构异常
 */

const MODEL = 'deepseek-chat'

export async function callDeepSeek(messages) {
  let response
  try {
    response = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, messages, stream: false }),
    })
  } catch (networkErr) {
    const err = new Error(`网络请求失败：${networkErr.message}`)
    err.code = 'NETWORK_ERROR'
    throw err
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    const err = new Error(`AI 服务错误 ${response.status}：${body.slice(0, 200)}`)
    err.code = `HTTP_${response.status}`
    throw err
  }

  let data
  try {
    data = await response.json()
  } catch {
    const err = new Error('AI 服务返回内容无法解析为 JSON')
    err.code = 'BAD_RESPONSE'
    throw err
  }

  const text = data?.choices?.[0]?.message?.content
  if (!text) {
    const err = new Error('AI 服务返回数据结构异常（choices[0].message.content 为空）')
    err.code = 'BAD_RESPONSE'
    throw err
  }

  return text
}
