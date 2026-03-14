<script setup>
import { ref, computed } from 'vue'
import { SYSTEM_TAGS } from '../../data/tags.js'
import { useTagsStore } from '../../stores/tags.js'

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  scopeType: { type: String, required: true },  // 'library' | 'project'
  scopeId: { type: String, required: true },
})
const emit = defineEmits(['update:modelValue'])

const tagsStore = useTagsStore()

const scopedCustomTags = computed(() =>
  tagsStore.getCustomTags(props.scopeType, props.scopeId)
)

const newTagInput = ref('')
const inputError = ref('')

function isSelected(name) {
  return props.modelValue.includes(name)
}

function toggle(name) {
  const current = [...props.modelValue]
  const idx = current.indexOf(name)
  if (idx === -1) {
    current.push(name)
  } else {
    current.splice(idx, 1)
  }
  emit('update:modelValue', current)
}

function createTag() {
  const name = newTagInput.value.trim()
  inputError.value = ''

  if (!name) return

  if (name.length < 2 || name.length > 20) {
    inputError.value = '标签长度须 2–20 字'
    return
  }

  const tag = tagsStore.addCustomTag(name, props.scopeType, props.scopeId)
  if (!tag) {
    inputError.value = '标签已存在'
    return
  }

  // Auto-select the newly created tag
  const current = [...props.modelValue, tag.name]
  emit('update:modelValue', current)
  newTagInput.value = ''
}
</script>

<template>
  <div class="tag-picker">
    <!-- Layer 1: System tags -->
    <div class="tag-picker-section">
      <div class="text-xs text-secondary" style="margin-bottom:6px">系统标签</div>
      <div class="flex" style="flex-wrap:wrap;gap:6px">
        <button
          v-for="t in SYSTEM_TAGS"
          :key="t.name"
          class="tag"
          :style="{
            cursor: 'pointer',
            background: isSelected(t.name) ? 'var(--color-primary)' : '',
            color: isSelected(t.name) ? '#fff' : '',
            borderColor: isSelected(t.name) ? 'var(--color-primary)' : '',
          }"
          @click.prevent="toggle(t.name)"
        >{{ t.name }}</button>
      </div>
    </div>

    <!-- Layer 2: Scoped custom tags (only if any exist) -->
    <div v-if="scopedCustomTags.length > 0" class="tag-picker-section" style="margin-top:10px">
      <div class="text-xs text-secondary" style="margin-bottom:6px">自定义标签</div>
      <div class="flex" style="flex-wrap:wrap;gap:6px">
        <button
          v-for="t in scopedCustomTags"
          :key="t.id"
          class="tag"
          :style="{
            cursor: 'pointer',
            background: isSelected(t.name) ? 'var(--color-primary)' : '',
            color: isSelected(t.name) ? '#fff' : '',
            borderColor: isSelected(t.name) ? 'var(--color-primary)' : '',
          }"
          @click.prevent="toggle(t.name)"
        >{{ t.name }}</button>
      </div>
    </div>

    <!-- Layer 3: Create new tag -->
    <div style="margin-top:10px">
      <div class="flex gap-8" style="align-items:center">
        <input
          type="text"
          v-model="newTagInput"
          placeholder="新标签（回车创建）"
          style="flex:1;font-size:12px;padding:4px 8px"
          @keydown.enter.prevent="createTag"
        />
        <button class="small" @click.prevent="createTag" style="white-space:nowrap">创建</button>
      </div>
      <div v-if="inputError" class="text-xs" style="color:var(--color-danger);margin-top:4px">{{ inputError }}</div>
    </div>

    <!-- Selected preview -->
    <div v-if="modelValue.length > 0" style="margin-top:8px">
      <span
        v-for="name in modelValue"
        :key="name"
        class="tag primary"
        style="margin-right:4px;cursor:pointer"
        @click="toggle(name)"
      >{{ name }} ×</span>
    </div>
  </div>
</template>
