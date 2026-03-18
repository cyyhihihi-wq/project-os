import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    '[supabase] 环境变量缺失！请在 Vercel Dashboard → Settings → Environment Variables 中添加：\n' +
    '  VITE_SUPABASE_URL\n' +
    '  VITE_SUPABASE_ANON_KEY\n' +
    `当前值：URL=${supabaseUrl}, KEY=${supabaseAnonKey ? '已设置' : '未设置'}`
  )
}

export const supabase = createClient(
  supabaseUrl ?? '',
  supabaseAnonKey ?? ''
)

// 仅用于 Step 1 验证连接，确认后可删除
export async function testConnection() {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .limit(1)

  console.log('Supabase connection test:', { data, error })
  return { data, error }
}
