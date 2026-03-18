<script setup>
import { watch, onBeforeUnmount } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'

const props = defineProps({
  modelValue: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue'])

const editor = useEditor({
  content: props.modelValue,
  extensions: [
    StarterKit,
    Highlight,
    Table.configure({ resizable: false }),
    TableRow,
    TableCell,
    TableHeader,
    TaskList,
    TaskItem.configure({ nested: true }),
  ],
  onUpdate({ editor }) {
    emit('update:modelValue', editor.getHTML())
  },
})

watch(
  () => props.modelValue,
  (val) => {
    if (editor.value && editor.value.getHTML() !== val) {
      editor.value.commands.setContent(val ?? '', false)
    }
  },
)

onBeforeUnmount(() => editor.value?.destroy())
</script>

<template>
  <div class="rich-editor">
    <div v-if="editor" class="rich-editor-toolbar">
      <button
        type="button" class="rich-btn" :class="{ active: editor.isActive('bold') }"
        @mousedown.prevent="editor.chain().focus().toggleBold().run()"
        title="加粗"
      ><strong>B</strong></button>
      <button
        type="button" class="rich-btn mark-btn" :class="{ active: editor.isActive('highlight') }"
        @mousedown.prevent="editor.chain().focus().toggleHighlight().run()"
        title="高亮"
      >H</button>
      <span class="rich-sep" />
      <button
        type="button" class="rich-btn" :class="{ active: editor.isActive('bulletList') }"
        @mousedown.prevent="editor.chain().focus().toggleBulletList().run()"
        title="无序列表"
      >⁃</button>
      <button
        type="button" class="rich-btn" :class="{ active: editor.isActive('orderedList') }"
        @mousedown.prevent="editor.chain().focus().toggleOrderedList().run()"
        title="有序列表"
      >1.</button>
      <button
        type="button" class="rich-btn"
        :disabled="!editor.can().sinkListItem('listItem')"
        @mousedown.prevent="editor.chain().focus().sinkListItem('listItem').run()"
        title="增加缩进（Tab）"
      >→</button>
      <button
        type="button" class="rich-btn"
        :disabled="!editor.can().liftListItem('listItem')"
        @mousedown.prevent="editor.chain().focus().liftListItem('listItem').run()"
        title="减少缩进（Shift+Tab）"
      >←</button>
      <span class="rich-sep" />
      <button
        type="button" class="rich-btn" :class="{ active: editor.isActive('taskList') }"
        @mousedown.prevent="editor.chain().focus().toggleTaskList().run()"
        title="待办列表"
      >☑</button>
    </div>
    <EditorContent :editor="editor" class="rich-editor-content" />
  </div>
</template>

<style>
/* 表格粘贴样式（全局，供 rich-content 展示区复用） */
.rich-editor-content table,
.rich-content table {
  border-collapse: collapse;
  width: 100%;
  margin: 8px 0;
  font-size: 13px;
}
.rich-editor-content th,
.rich-editor-content td,
.rich-content th,
.rich-content td {
  border: 1px solid var(--color-border, #e0e0e0);
  padding: 5px 10px;
  text-align: left;
  vertical-align: top;
}
.rich-editor-content th,
.rich-content th {
  background: var(--color-bg, #f5f5f5);
  font-weight: 600;
}

/* Task list (checkbox) */
.rich-editor-content ul[data-type="taskList"],
.rich-content ul[data-type="taskList"] {
  list-style: none;
  padding-left: 4px;
}
.rich-editor-content ul[data-type="taskList"] li,
.rich-content ul[data-type="taskList"] li {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}
.rich-editor-content ul[data-type="taskList"] li > label,
.rich-content ul[data-type="taskList"] li > label {
  flex-shrink: 0;
  margin-top: 2px;
}
.rich-editor-content ul[data-type="taskList"] li > div,
.rich-content ul[data-type="taskList"] li > div {
  flex: 1;
}
.rich-editor-content ul[data-type="taskList"] li[data-checked="true"] > div,
.rich-content ul[data-type="taskList"] li[data-checked="true"] > div {
  text-decoration: line-through;
  opacity: 0.55;
}
</style>
