/**
 * Vercel Serverless Function — AI 代理
 *
 * 职责：接收前端请求，注入 DEEPSEEK_API_KEY，转发到 DeepSeek API。
 * DeepSeek API Key 只存在 Vercel 服务端环境变量，不暴露给前端。
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'DEEPSEEK_API_KEY is not configured on the server' })
  }

  let upstreamResponse
  try {
    upstreamResponse = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(req.body),
    })
  } catch (err) {
    return res.status(502).json({ error: `上游请求失败：${err.message}` })
  }

  const data = await upstreamResponse.json().catch(() => null)
  if (!data) {
    return res.status(502).json({ error: 'DeepSeek 返回内容无法解析' })
  }

  res.status(upstreamResponse.status).json(data)
}
