import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // 加载 .env.local 里的全部变量（含非 VITE_ 前缀的服务端 key）
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      vue(),
      // 本地开发：把 /api/ai 请求直接转发到 DeepSeek，模拟 Vercel Serverless Function
      // 生产环境由 api/ai.js 处理，此插件不影响线上行为
      {
        name: 'local-api-proxy',
        configureServer(server) {
          server.middlewares.use('/api/ai', async (req, res) => {
            const apiKey = env.DEEPSEEK_API_KEY
            if (!apiKey) {
              res.statusCode = 500
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: '本地开发缺少 DEEPSEEK_API_KEY，请在 .env.local 中添加' }))
              return
            }

            let rawBody = ''
            for await (const chunk of req) rawBody += chunk

            let upstream
            try {
              upstream = await fetch('https://api.deepseek.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${apiKey}`,
                },
                body: rawBody,
              })
            } catch (err) {
              res.statusCode = 502
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: `上游请求失败：${err.message}` }))
              return
            }

            const data = await upstream.json().catch(() => null)
            res.statusCode = upstream.status
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(data ?? { error: 'DeepSeek 返回内容无法解析' }))
          })
        },
      },
    ],
  }
})
