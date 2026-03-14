import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '../lib/supabase.js'
import { syncStatus } from '../lib/syncStatus.js'
import { useAuthStore } from './auth.js'

const SYNC_ERROR_MSG = '已保存到本地，云端同步失败。其他设备暂时看不到这次改动，可稍后刷新重试。'

export const useAiDocumentsStore = defineStore('aiDocuments', () => {
  const documents = ref([])
  const loadError = ref('')   // 加载失败时的可见提示，区别于写入失败的 syncStatus

  // 登录后加载历史文档，按创建时间倒序
  async function loadDocuments(userId) {
    loadError.value = ''
    const { data, error } = await supabase
      .from('ai_documents')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[cloud] ai_documents load error:', error)
      loadError.value = '历史文档加载失败，请稍后重试'
      return
    }
    documents.value = data
  }

  // 保存新文档，写入 Supabase，同时追加到本地 store
  async function saveDocument(doc) {
    const userId = useAuthStore().user?.id
    if (!userId) return

    const now = new Date().toISOString()
    const record = {
      id: crypto.randomUUID(),
      user_id: userId,
      title: doc.title,
      content_md: doc.content_md,
      content_html: doc.content_html,
      created_at: now,
      updated_at: now,
    }

    const { error } = await supabase.from('ai_documents').insert(record)
    if (error) {
      console.error('[cloud] ai_documents insert error:', error)
      syncStatus.error = SYNC_ERROR_MSG
      return
    }

    // 写入成功后追加到本地 store（无需再 loadDocuments）
    documents.value.unshift(record)
  }

  // 更新文档内容
  async function updateDocument(doc) {
    const userId = useAuthStore().user?.id
    if (!userId) return

    const now = new Date().toISOString()
    const changes = {
      title: doc.title,
      content_md: doc.content_md,
      content_html: doc.content_html,
      updated_at: now,
    }

    const { error } = await supabase
      .from('ai_documents')
      .update(changes)
      .eq('id', doc.id)
      .eq('user_id', userId)

    if (error) {
      console.error('[cloud] ai_documents update error:', error)
      syncStatus.error = SYNC_ERROR_MSG
      return
    }

    const idx = documents.value.findIndex(d => d.id === doc.id)
    if (idx !== -1) documents.value[idx] = { ...documents.value[idx], ...changes }
  }

  // 删除文档
  async function deleteDocument(id) {
    const userId = useAuthStore().user?.id
    if (!userId) return

    const { error } = await supabase
      .from('ai_documents')
      .delete()
      .eq('id', id)
      .eq('user_id', userId)

    if (error) {
      console.error('[cloud] ai_documents delete error:', error)
      syncStatus.error = SYNC_ERROR_MSG
      return
    }

    documents.value = documents.value.filter(d => d.id !== id)
  }

  return { documents, loadError, loadDocuments, saveDocument, updateDocument, deleteDocument }
})
