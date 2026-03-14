import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '../lib/supabase.js'

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null)
  const appReady = ref(false)

  async function initialize() {
    const { data: { session } } = await supabase.auth.getSession()
    user.value = session?.user ?? null
    appReady.value = true

    supabase.auth.onAuthStateChange((_event, session) => {
      user.value = session?.user ?? null
    })
  }

  async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  async function signUp(email, password) {
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) throw error
    // 如果 Supabase 开启了邮件验证，signUp 后 session 为 null
    // 返回 session 存在与否供调用方判断
    return { needsConfirmation: !data.session }
  }

  async function signOut() {
    await supabase.auth.signOut()
    user.value = null
  }

  return { user, appReady, initialize, signIn, signUp, signOut }
})
