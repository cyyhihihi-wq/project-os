<script setup>
import { computed } from 'vue'
import { marked } from 'marked'

const props = defineProps({
  content: { type: String, default: '' },
})

// breaks: true 使单个换行变为 <br>，更符合 textarea 输入习惯
marked.use({ breaks: true })

const html = computed(() => {
  if (!props.content) return ''
  return marked.parse(props.content)
})
</script>

<template>
  <div class="markdown-content" v-html="html"></div>
</template>
