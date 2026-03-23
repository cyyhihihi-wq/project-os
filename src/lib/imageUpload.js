import { supabase } from './supabase.js'

/** 上传图片 File 到 Supabase Storage，返回公开 URL。失败时 throw。 */
export async function uploadImageToStorage(file) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未登录，无法上传图片')

  const ext = file.name?.split('.').pop()?.toLowerCase() ||
    file.type.split('/')[1] || 'png'
  const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

  const { error } = await supabase.storage
    .from('project-images')
    .upload(path, file, { contentType: file.type, upsert: false })

  if (error) throw error

  const { data } = supabase.storage
    .from('project-images')
    .getPublicUrl(path)

  return data.publicUrl
}
