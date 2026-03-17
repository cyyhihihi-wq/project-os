<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth.js'

const router = useRouter()
const authStore = useAuthStore()

const email = ref('632982306@qq.com')
const password = ref('')
const isRegister = ref(false)
const loading = ref(false)
const errorMsg = ref('')
const infoMsg = ref('')

function switchMode() {
  isRegister.value = !isRegister.value
  errorMsg.value = ''
  infoMsg.value = ''
}

async function submit() {
  if (!email.value.trim() || !password.value) return
  loading.value = true
  errorMsg.value = ''
  infoMsg.value = ''

  try {
    if (isRegister.value) {
      const { needsConfirmation } = await authStore.signUp(email.value.trim(), password.value)
      if (needsConfirmation) {
        infoMsg.value = '账号已创建，请查收邮件完成验证后再登录'
        isRegister.value = false
      } else {
        router.push('/')
      }
    } else {
      await authStore.signIn(email.value.trim(), password.value)
      router.push('/')
    }
  } catch (err) {
    errorMsg.value = err.message || '操作失败，请重试'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="auth-wrap">
    <div class="auth-box">
      <h2 class="auth-title">我的工作台</h2>

      <form @submit.prevent="submit" class="auth-form">
        <input
          v-model="email"
          type="email"
          placeholder="邮箱"
          autocomplete="email"
          required
        />
        <input
          v-model="password"
          type="password"
          placeholder="密码"
          autocomplete="current-password"
          required
        />

        <p v-if="errorMsg" class="auth-error">{{ errorMsg }}</p>
        <p v-if="infoMsg" class="auth-info">{{ infoMsg }}</p>

        <button type="submit" class="primary auth-submit" :disabled="loading">
          {{ loading ? '请稍候...' : (isRegister ? '创建账号' : '进入工作台') }}
        </button>
      </form>

      <p class="auth-toggle">
        {{ isRegister ? '已有账号？' : '还没有账号？' }}
        <a href="#" @click.prevent="switchMode">
          {{ isRegister ? '直接登录' : '创建一个' }}
        </a>
      </p>
    </div>
  </div>
</template>

<style scoped>
.auth-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: var(--color-bg, #f5f5f5);
}

.auth-box {
  width: 320px;
  padding: 36px 32px 28px;
  background: var(--color-surface, #fff);
  border: 1px solid var(--color-border, #e0e0e0);
  border-radius: 8px;
}

.auth-title {
  margin: 0 0 24px;
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text, #1a1a1a);
}

.auth-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.auth-form input {
  width: 100%;
  box-sizing: border-box;
}

.auth-submit {
  width: 100%;
  margin-top: 4px;
}

.auth-error {
  margin: 0;
  font-size: 13px;
  color: var(--color-danger, #d32f2f);
}

.auth-info {
  margin: 0;
  font-size: 13px;
  color: var(--color-secondary, #666);
}

.auth-toggle {
  margin: 16px 0 0;
  font-size: 13px;
  color: var(--color-secondary, #666);
  text-align: center;
}

.auth-toggle a {
  color: var(--color-primary, #1976d2);
  text-decoration: none;
}
</style>
