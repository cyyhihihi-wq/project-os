import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
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
