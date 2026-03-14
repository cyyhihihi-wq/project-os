<script setup>
import { ref } from 'vue'

const props = defineProps({
  label: { type: String, default: '附件（支持拖拽）' },
  accept: { type: String, default: '' },
})

const emit = defineEmits(['files-changed'])

const dragOver = ref(false)
const files = ref([])

function addFiles(fileList) {
  if (!fileList?.length) return
  for (const f of fileList) {
    if (!files.value.find(existing => existing.name === f.name && existing.size === f.size)) {
      files.value.push(f)
    }
  }
  emit('files-changed', files.value)
}

function handleDrop(e) {
  dragOver.value = false
  addFiles(e.dataTransfer?.files)
}

function handleInput(e) {
  addFiles(e.target.files)
  e.target.value = ''
}

function removeFile(index) {
  files.value.splice(index, 1)
  emit('files-changed', files.value)
}

defineExpose({ files, addFiles })
</script>

<template>
  <div
    class="file-uploader"
    :class="{ 'file-uploader--active': dragOver }"
    @dragover.prevent="dragOver = true"
    @dragleave="dragOver = false"
    @drop.prevent="handleDrop"
  >
    <label class="text-xs text-secondary">{{ label }}</label>
    <div class="file-uploader-zone" @click="$refs.fileInput.click()">
      <span class="text-sm text-secondary">点击选择或拖拽文件到此处</span>
      <input ref="fileInput" type="file" multiple style="display:none" :accept="accept" @change="handleInput" />
    </div>
    <div v-if="files.length" class="file-uploader-list">
      <div v-for="(f, i) in files" :key="i" class="file-uploader-item">
        <span class="text-xs">{{ f.name }}</span>
        <button class="file-uploader-remove" @click.stop="removeFile(i)">&times;</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.file-uploader {
  margin-top: 4px;
}
.file-uploader--active .file-uploader-zone {
  border-color: var(--color-primary);
  background: var(--color-primary-light);
}
.file-uploader-zone {
  margin-top: 4px;
  padding: 14px;
  border: 2px dashed var(--color-border);
  border-radius: var(--radius);
  text-align: center;
  cursor: pointer;
  transition: all 0.15s;
}
.file-uploader-zone:hover {
  border-color: var(--color-primary);
}
.file-uploader-list {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.file-uploader-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
}
.file-uploader-remove {
  border: none;
  background: none;
  padding: 0 2px;
  font-size: 14px;
  cursor: pointer;
  color: var(--color-text-secondary);
  line-height: 1;
}
.file-uploader-remove:hover {
  color: var(--color-danger);
  background: none;
}
</style>
