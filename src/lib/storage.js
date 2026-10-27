/**
 * Supabase Storage helpers — project update attachments
 *
 * Bucket:  project-attachments  (public)
 * Path:    {userId}/{attId}/{originalFilename}
 *
 * 附件对象结构（云端版本）：
 *   { id, name, type, size, path, url }
 *
 * 兼容旧本地 Base64 格式：
 *   { id, name, type, size, data }   — 不上传，仅本地下载
 */
import { supabase } from './supabase.js'

const BUCKET = 'project-attachments'

/**
 * 上传文件到 Supabase Storage。
 * 返回云端附件对象 { id, name, type, size, path, url }。
 */
export async function uploadAttachment(userId, file) {
  const attId = crypto.randomUUID()
  // 路径中只保留安全字符，保证兼容性
  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')
  const path = `${userId}/${attId}/${safeName}`

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { cacheControl: '31536000', upsert: false })

  if (error) throw new Error(error.message)

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)

  return {
    id: attId,
    name: file.name,        // 显示用原始名称
    type: file.type || 'application/octet-stream',
    size: file.size,
    path,
    url: data.publicUrl,
  }
}

/**
 * 从 Supabase Storage 删除附件。
 * 静默失败——本地记录已经删了，存储失败不影响使用。
 */
export async function deleteAttachment(path) {
  if (!path) return
  const { error } = await supabase.storage.from(BUCKET).remove([path])
  if (error) console.warn('[storage] delete failed:', error.message)
}

/**
 * 把附件数组中的 Base64 data 字段去掉（上传云端时不写入 DB）。
 * 已有 url/path 的附件不受影响。
 */
export function sanitizeForCloud(attachments) {
  return (attachments || []).map(({ data: _d, ...rest }) => rest)
}
