<script setup>
/**
 * AutoTextarea
 * 自动根据内容扩展高度，最小 ~8 行，超过 45vh 后内部滚动。
 * 通过 v-model 绑定值。所有其他 attrs（placeholder、@blur、@keydown 等）
 * 透传给底层 <textarea>。
 */
import { ref, watch, nextTick, onMounted } from 'vue'

const props = defineProps({
  modelValue: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue'])

const el = ref(null)

function resize() {
  const t = el.value
  if (!t) return
  t.style.height = 'auto'
  const max = window.innerHeight * 0.45
  t.style.height = Math.min(t.scrollHeight, max) + 'px'
}

function onInput(e) {
  emit('update:modelValue', e.target.value)
  resize()
}

// 响应外部赋值（如清空、切换专项）
watch(() => props.modelValue, () => nextTick(resize))
onMounted(() => nextTick(resize))
</script>

<template>
  <textarea
    ref="el"
    :value="modelValue"
    class="auto-textarea"
    @input="onInput"
  />
</template>
