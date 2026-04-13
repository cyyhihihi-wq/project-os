<script setup>
import { ref, watch, onBeforeUnmount } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Image from '@tiptap/extension-image'
import { uploadImageToStorage } from '../../lib/imageUpload.js'

const props = defineProps({
  modelValue: { type: String, default: '' },
  // 仅在项目进展编辑器启用，其余 RichEditor 场景不受影响
  enableImagePaste: { type: Boolean, default: false },
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
    Image.configure({ inline: true }),
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

// ── 图片粘贴（仅 enableImagePaste=true 时生效） ───────────────────────────────

const uploadStatus = ref(null) // { type: 'loading'|'warn'|'error', message }

function showStatus(type, message) {
  uploadStatus.value = { type, message }
  // loading 保持到操作完成；warn/error 提示用户手动关闭（不自动消失）；其他 4s 消失
  if (type !== 'loading' && type !== 'warn' && type !== 'error') {
    setTimeout(() => { uploadStatus.value = null }, 4000)
  }
}

/**
 * 创建视觉明显的图片占位符（替代纯文本 [图片]）
 * 存入 Tiptap HTML，inline styles 保证在展示区也能正确渲染
 */
function makePlaceholder(doc, n) {
  const span = doc.createElement('span')
  span.style.cssText = [
    'display:inline-flex',
    'align-items:center',
    'gap:4px',
    'background:#fff3e0',
    'border:1px dashed #f97316',
    'color:#c2410c',
    'padding:2px 10px',
    'border-radius:4px',
    'font-size:12px',
    'font-weight:600',
    'cursor:default',
    'user-select:none',
  ].join(';')
  span.textContent = `📷 图${n}（来源受限，请截图后粘贴到此位置）`
  return span
}

/** base64 data URL → File 对象 */
function dataURLtoFile(dataUrl) {
  const [header, b64] = dataUrl.split(',')
  const mime = header.match(/:(.*?);/)?.[1] || 'image/png'
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new File([bytes], `paste-${Date.now()}.${mime.split('/')[1] || 'png'}`, { type: mime })
}

/**
 * 批量替换编辑器 HTML 中的 objectURL → 永久 URL，只做一次 setContent。
 */
function applyReplacements(replacements) {
  if (!replacements.length) return
  let html = editor.value?.getHTML() || ''
  for (const { from, to } of replacements) html = html.replaceAll(from, to)
  editor.value?.commands.setContent(html, true)
}

/**
 * 纯截图粘贴（无 HTML，只有图片 File）。
 * objectURL 预览 → 并发上传 → 一次性替换永久 URL。
 */
async function pasteScreenshot(files) {
  showStatus('loading', files.length > 1 ? `正在上传 ${files.length} 张图片…` : '图片上传中…')
  const tasks = files.map(file => ({ file, objectUrl: URL.createObjectURL(file) }))
  for (const { objectUrl } of tasks) {
    editor.value?.chain().focus().setImage({ src: objectUrl }).run()
  }
  const settled = await Promise.allSettled(
    tasks.map(({ file, objectUrl }) =>
      uploadImageToStorage(file).then(url => ({ from: objectUrl, to: url }))
    )
  )
  const replacements = []
  let hasErrors = false
  for (const [i, r] of settled.entries()) {
    URL.revokeObjectURL(tasks[i].objectUrl)
    if (r.status === 'fulfilled') replacements.push(r.value)
    else { console.error('[RichEditor] 图片上传失败:', r.reason); hasErrors = true }
  }
  applyReplacements(replacements)
  uploadStatus.value = hasErrors ? { type: 'error', message: '部分图片上传失败，请重试' } : null
  if (hasErrors) setTimeout(() => { uploadStatus.value = null }, 4000)
}

/**
 * 图文混排粘贴（HTML 中含非 https 图片）。
 *
 * 处理优先级：
 * 1. https:// 外链  → 直接保留
 * 2. data:image/    → base64 转 File → objectURL → 上传
 * 3. blob:/cid:/其他不可访问 → 优先从 clipboardImageFiles 按顺序取文件替代；
 *                             文件耗尽后降级为视觉占位符（橙框提示）
 *
 * @param {string} html - 剪贴板 HTML
 * @param {File[]} clipboardImageFiles - 剪贴板中收集到的图片 File 对象（按顺序）
 */
async function pasteHtmlWithImages(html, clipboardImageFiles = []) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const imgs = [...doc.querySelectorAll('img')]
  const uploadTasks = [] // { objectUrl, file }
  let placeholderCount = 0
  // 消费队列：按位置匹配不可访问图片
  const fileQueue = [...clipboardImageFiles]

  for (const img of imgs) {
    const src = img.getAttribute('src') || ''

    if (/^https?:\/\//i.test(src)) continue // 外链保留

    if (/^data:image\//i.test(src)) {        // base64 → objectURL → 上传
      try {
        const file = dataURLtoFile(src)
        const objectUrl = URL.createObjectURL(file)
        img.setAttribute('src', objectUrl)
        uploadTasks.push({ objectUrl, file })
      } catch {
        img.replaceWith(makePlaceholder(doc, ++placeholderCount))
      }
      continue
    }

    // blob:/cid:/file:/其他 → 跨域不可访问
    // 策略 1：剪贴板中有文件数据，按位置取用（飞书图文混排走此路径）
    if (fileQueue.length > 0) {
      const file = fileQueue.shift()
      const objectUrl = URL.createObjectURL(file)
      img.setAttribute('src', objectUrl)
      uploadTasks.push({ objectUrl, file })
    } else {
      // 策略 2：无可用文件，插入视觉占位符，引导用户补充
      img.replaceWith(makePlaceholder(doc, ++placeholderCount))
    }
  }

  // 插入处理后的 HTML（img src 全为 objectURL / https，或已替换为占位符）
  editor.value?.chain().focus().insertContent(doc.body.innerHTML).run()

  if (!uploadTasks.length) {
    if (placeholderCount > 0) {
      showStatus('warn',
        `${placeholderCount} 张图片来源受浏览器限制，已在文中标记📷位置。` +
        `请在飞书中右键单张图片→复制，再点击对应位置粘贴补充。`
      )
    }
    return
  }

  showStatus('loading', uploadTasks.length > 1 ? `正在上传 ${uploadTasks.length} 张图片…` : '图片上传中…')

  const settled = await Promise.allSettled(
    uploadTasks.map(({ file, objectUrl }) =>
      uploadImageToStorage(file).then(url => ({ from: objectUrl, to: url }))
    )
  )

  const replacements = []
  let hasErrors = false
  for (const [i, r] of settled.entries()) {
    URL.revokeObjectURL(uploadTasks[i].objectUrl)
    if (r.status === 'fulfilled') replacements.push(r.value)
    else { console.error('[RichEditor] 图片上传失败:', r.reason); hasErrors = true }
  }

  applyReplacements(replacements)
  if (hasErrors || placeholderCount > 0) {
    showStatus('warn', [
      hasErrors ? '部分图片上传失败，请重试' : '',
      placeholderCount > 0
        ? `${placeholderCount} 张图片来源受限，已标记📷位置，请截图后逐一补充`
        : '',
    ].filter(Boolean).join('；'))
  } else {
    uploadStatus.value = null
  }
}

/**
 * capture 阶段拦截粘贴 — 仅 enableImagePaste=true 时生效。
 * 规则：event.preventDefault() 必须在第一个 await 之前同步调用。
 */
async function onPaste(event) {
  if (!props.enableImagePaste) return

  const clipboard = event.clipboardData
  if (!clipboard) return

  // 同步采集全部数据（必须在任何 await 之前完成）
  const html = clipboard.getData('text/html')
  const imageFiles = []
  for (const item of clipboard.items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const f = item.getAsFile()
      if (f) imageFiles.push(f)
    }
  }

  // ── A: 有 HTML 且含图片 → 统一走图片处理流程 ─────────────────────────
  // 注意：imageFiles 也一并传入，用于替代 HTML 里不可访问的 blob:/cid: 图片
  if (html && html.trim() && /<img\b/i.test(html)) {
    event.preventDefault()
    await pasteHtmlWithImages(html, imageFiles)
    return
  }

  // ── B: 无 HTML，只有图片文件（纯截图）──────────────────────────────
  if (imageFiles.length > 0) {
    event.preventDefault()
    await pasteScreenshot(imageFiles)
    return
  }

  // C: 纯文字 / 纯 HTML 文字 → 完全不拦截
}
</script>

<template>
  <div class="rich-editor" @paste.capture="onPaste">
    <!-- 状态栏：在编辑器外，不写入 HTML 正文 -->
    <div
      v-if="uploadStatus"
      class="upload-status-bar"
      :class="'status-' + uploadStatus.type"
      style="display:flex;align-items:flex-start;gap:8px;justify-content:space-between"
    >
      <span style="flex:1;line-height:1.5">{{ uploadStatus.message }}</span>
      <!-- warn/error 提供手动关闭按钮 -->
      <button
        v-if="uploadStatus.type === 'warn' || uploadStatus.type === 'error'"
        style="flex-shrink:0;border:none;background:none;cursor:pointer;font-size:14px;line-height:1;padding:0;opacity:0.6"
        @mousedown.prevent="uploadStatus = null"
        title="关闭"
      >×</button>
    </div>

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
/* 表格（全局，供 rich-content 展示区复用） */
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

/* Task list */
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

/* Image */
.rich-editor-content img,
.rich-content img {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
  margin: 4px 0;
  display: block;
}
</style>

<style scoped>
.upload-status-bar {
  padding: 5px 10px;
  font-size: 12px;
  border-radius: 4px;
  margin-bottom: 6px;
}
.status-loading { background: #eff6ff; color: #3b82f6; }
.status-warn    { background: #fffbeb; color: #d97706; }
.status-error   { background: #fef2f2; color: #dc2626; }
</style>
