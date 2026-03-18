/**
 * 云端双写辅助函数（Step 4）
 *
 * 职责：封装 Supabase 写操作，统一处理失败提示。
 * 调用方：各业务 store 的 add / update / remove。
 * 调用方式：fire-and-forget（不 await），本地写入不被阻塞。
 *
 * 失败处理规则：
 * - 本地写入已完成，Supabase 写入失败时设置 syncStatus.error
 * - 旧整数 ID 记录在 UUID 列上操作会报类型错误，走相同的失败路径
 * - console.error 保留作调试补充，不替代用户可见提示
 *
 * 子表（project_updates / project_judgements）均有 user_id 列（v2-final 冻结确认）。
 */
import { supabase } from './supabase.js'
import { syncStatus } from './syncStatus.js'
import { useAuthStore } from '../stores/auth.js'

const SYNC_ERROR_MSG = '已保存到本地，云端同步失败。其他设备暂时看不到这次改动，可稍后刷新重试。'

function getUserId() {
  return useAuthStore().user?.id ?? null
}

function handleError(table, op, err) {
  if (err && typeof err === 'object') {
    console.error(`[cloud] ${table} ${op} failed:`, {
      message: err.message,
      code: err.code,
      details: err.details,
      hint: err.hint,
    })
  } else {
    console.error(`[cloud] ${table} ${op} failed:`, err)
  }
  syncStatus.error = SYNC_ERROR_MSG
}

/**
 * 插入新记录，自动注入 user_id。
 * 适用于所有表，包括 project_updates / project_judgements（均有 user_id）。
 */
export async function syncCreate(table, data) {
  const userId = getUserId()
  if (!userId) return
  const payload = { ...data, user_id: userId }
  const { error } = await supabase.from(table).insert(payload)
  if (error) {
    console.error(`[cloud] ${table} insert failed — payload:`, JSON.stringify(payload, null, 2))
    handleError(table, 'insert', error)
  }
}

/**
 * 更新已有记录。
 * 用 id + user_id 双重定位；旧整数 ID 在 UUID 列上会触发类型错误。
 * 更新 0 行（记录不在云端）也视为同步失败，显示 banner。
 */
export async function syncUpdate(table, id, changes) {
  const userId = getUserId()
  if (!userId) return
  const { data, error } = await supabase
    .from(table)
    .update(changes)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
  if (error || !data?.length) {
    handleError(table, 'update', error || 'no matching record in cloud')
  }
}

/**
 * 删除记录。
 * 用 id + user_id 双重定位；失败或类型错误走相同 banner 路径。
 */
export async function syncDelete(table, id) {
  const userId = getUserId()
  if (!userId) return
  const { error } = await supabase
    .from(table)
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
  if (error) handleError(table, 'delete', error)
}

/**
 * week_reviews 专用写入：先查再写，不依赖 UNIQUE(user_id, week_label) DB 约束。
 *
 * 原因：冻结方案未明确此约束是否已建立，Supabase upsert 依赖 DB 层约束才能
 * 正确执行，在约束未确认前使用 check-then-write 更安全。
 *
 * 建议在 Supabase SQL Editor 执行以下语句添加约束（与代码逻辑无关，可随时添加）：
 *   ALTER TABLE week_reviews
 *     ADD CONSTRAINT week_reviews_user_week_unique UNIQUE (user_id, week_label);
 * 约束添加后此函数仍能正常工作（查到后直接 update），无需改代码。
 */
export async function syncWeekReview(weekLabel, content) {
  const userId = getUserId()
  if (!userId) return

  const now = new Date().toISOString()

  // 查询当前用户此 week_label 是否已有记录
  const { data: existing, error: queryError } = await supabase
    .from('week_reviews')
    .select('id')
    .eq('user_id', userId)
    .eq('week_label', weekLabel)
    .maybeSingle()

  if (queryError) {
    handleError('week_reviews', 'query', queryError)
    return
  }

  if (existing) {
    // 已有记录 → update
    const { error } = await supabase
      .from('week_reviews')
      .update({ content, updated_at: now })
      .eq('id', existing.id)
      .eq('user_id', userId)
    if (error) handleError('week_reviews', 'update', error)
  } else {
    // 无记录 → insert
    const { error } = await supabase
      .from('week_reviews')
      .insert({ user_id: userId, week_label: weekLabel, content, created_at: now, updated_at: now })
    if (error) handleError('week_reviews', 'insert', error)
  }
}
