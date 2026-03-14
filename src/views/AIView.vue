<script setup>
import { ref, computed } from 'vue'
import { useTasksStore } from '../stores/tasks.js'
import { useProjectsStore } from '../stores/projects.js'
import { useMaterialsStore } from '../stores/materials.js'
import { useStylesStore } from '../stores/styles.js'
import { useAiDocumentsStore } from '../stores/aiDocuments.js'
import FileUploader from '../components/shared/FileUploader.vue'
import TagPicker from '../components/shared/TagPicker.vue'
import MarkdownContent from '../components/shared/MarkdownContent.vue'
import RichEditor from '../components/shared/RichEditor.vue'
import { generateDocument, describeDataSources } from '../ai/aiService.js'
import { organizeMaterial } from '../ai/organizeService.js'
import { extractTextFromFile, textToPreviewHtml } from '../utils/fileExtractor.js'
import { marked } from 'marked'

const tasksStore   = useTasksStore()
const projectsStore = useProjectsStore()
const materialsStore = useMaterialsStore()
const stylesStore = useStylesStore()
const aiDocumentsStore = useAiDocumentsStore()

const activeTab = ref('generate')

// -- Doc Generation --
const docType = ref('weekly')
const sourceProject = ref('')
const sourceRange = ref('this-week')
const structureGuide = ref('')
const generating = ref(false)
const generatedDoc = ref('')
const generateError = ref('')

const docTypes = [
  { value: 'weekly',  label: '周报' },
  { value: 'monthly', label: '月报' },
  { value: 'project', label: '专项报告' },
  { value: 'review',  label: '复盘' },
  { value: 'free',    label: '自由生成' },
]

// 动态提示：当前设定会读取哪些数据
const dataSourceHint = computed(() =>
  describeDataSources(
    { docType: docType.value, sourceProject: sourceProject.value },
    { tasksStore, projectsStore, materialsStore, stylesStore },
  )
)

async function generateDoc() {
  generating.value = true
  generateError.value = ''
  try {
    const { doc } = await generateDocument(
      {
        docType: docType.value,
        sourceProject: sourceProject.value,
        sourceRange: sourceRange.value,
        structureGuide: structureGuide.value,
      },
      { tasksStore, projectsStore, materialsStore, stylesStore },
    )
    generatedDoc.value = doc
  } catch (e) {
    generateError.value = e.message || '生成失败，请重试。'
  } finally {
    generating.value = false
  }
}

// -- AI 文档保存 --
const saving = ref(false)

function extractDocTitle(md, type) {
  const match = md.match(/^#{1,3}\s+(.+)$/m)
  if (match) return match[1].trim()
  const labels = { weekly: '周报', monthly: '月报', project: '专项报告', review: '复盘', free: '工作文档' }
  const today = new Date().toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
  return `${labels[type] || '工作文档'} ${today}`
}

async function saveDoc() {
  if (!generatedDoc.value) return
  saving.value = true
  await aiDocumentsStore.saveDocument({
    title: extractDocTitle(generatedDoc.value, docType.value),
    content_md: generatedDoc.value,
    content_html: marked.parse(generatedDoc.value),
  })
  saving.value = false
}

function loadHistoryDoc(doc) {
  generatedDoc.value = doc.content_md
}

// -- Materials --
const materialSearch = ref('')
const materialTagFilter = ref('')
const expandedMaterialId = ref(null)
const showAddMaterial = ref(false)

// rawContent = 唯一正文状态源
// newMaterialFromImport = true 时用 v-html 展示（文件导入，可能含表格），
//                          false 时用 RichEditor（手动输入，Tiptap HTML）
const newMaterial = ref({
  title: '', rawContent: '', type: '快速记录',
  tags: [], project: '', project_id: null, file_name: '', file_type: '',
})
const newMaterialFromImport = ref(false)
const newMaterialTime = ref('')

function startAddMaterial() {
  const now = new Date()
  const fmt = d => d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0') + 'T' +
    String(d.getHours()).padStart(2, '0') + ':' +
    String(d.getMinutes()).padStart(2, '0')
  newMaterialTime.value = fmt(now)
  newMaterialFromImport.value = false
  addMaterialError.value = ''
  showAddMaterial.value = true
}

// Add material loading/error
const addMaterialLoading = ref(false)
const addMaterialError = ref('')

// Edit material
const editingMaterialId = ref(null)
const materialEditDraft = ref({ title: '', type: '', tags: [], created_at: '', raw_content: '' })
const editMaterialLoading = ref(false)
const editMaterialError = ref('')

function startEditMaterial(m) {
  editingMaterialId.value = m.id
  const d = m.created_at ? new Date(m.created_at) : new Date()
  materialEditDraft.value = {
    title: m.title,
    type: m.type,
    tags: [...(m.tags || [])],
    raw_content: m.raw_content || '',
    created_at: d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0') + 'T' +
      String(d.getHours()).padStart(2, '0') + ':' +
      String(d.getMinutes()).padStart(2, '0'),
  }
}

function saveMaterialEdit(id) {
  const iso = materialEditDraft.value.created_at
    ? new Date(materialEditDraft.value.created_at).toISOString()
    : undefined
  materialsStore.update(id, {
    title: materialEditDraft.value.title.trim(),
    type: materialEditDraft.value.type,
    tags: materialEditDraft.value.tags,
    raw_content: materialEditDraft.value.raw_content,
    ...(iso ? { created_at: iso } : {}),
  })
  editingMaterialId.value = null
}

async function saveMaterialEditWithAI(id) {
  const contentText = materialEditDraft.value.raw_content?.replace(/<[^>]+>/g, '').trim()
  if (!contentText) return
  editMaterialLoading.value = true
  editMaterialError.value = ''
  try {
    const result = await organizeMaterial(materialEditDraft.value.raw_content, materialEditDraft.value.title)
    const iso = materialEditDraft.value.created_at
      ? new Date(materialEditDraft.value.created_at).toISOString()
      : undefined
    materialsStore.update(id, {
      title: result.title,
      type: materialEditDraft.value.type,
      tags: result.suggestedTags || materialEditDraft.value.tags,
      raw_content: materialEditDraft.value.raw_content,
      ai_summary: result.content || '',
      ...(iso ? { created_at: iso } : {}),
    })
    editingMaterialId.value = null
  } catch (err) {
    editMaterialError.value = err.message || 'AI 整理失败，请重试'
  } finally {
    editMaterialLoading.value = false
  }
}

async function addMaterial(withAI = false) {
  const iso = newMaterialTime.value ? new Date(newMaterialTime.value).toISOString() : new Date().toISOString()
  const rawContent = newMaterial.value.rawContent
  const emptyForm = {
    title: '', rawContent: '', type: '快速记录',
    tags: [], project: '', project_id: null, file_name: '', file_type: '',
  }

  if (!withAI) {
    if (!newMaterial.value.title.trim()) {
      addMaterialError.value = '请填写标题后再保存'
      return
    }
    const _addProject = newMaterial.value.project_id ? projectsStore.getById(newMaterial.value.project_id) : null
    materialsStore.add({
      title: newMaterial.value.title,
      type: newMaterial.value.type,
      tags: newMaterial.value.tags,
      project: _addProject?.name || '',
      project_id: newMaterial.value.project_id || null,
      raw_content: rawContent,
      ai_summary: '',
      created_at: iso,
      file_name: newMaterial.value.file_name || '',
      file_type: newMaterial.value.file_type || '',
    })
    newMaterial.value = emptyForm
    newMaterialFromImport.value = false
    showAddMaterial.value = false
    return
  }

  // withAI: 内容不为空才允许调用
  const contentText = rawContent.replace(/<[^>]+>/g, '').trim()
  if (!contentText) return

  addMaterialLoading.value = true
  addMaterialError.value = ''
  try {
    const result = await organizeMaterial(rawContent, newMaterial.value.title)
    const _aiProject = newMaterial.value.project_id ? projectsStore.getById(newMaterial.value.project_id) : null
    materialsStore.add({
      title: result.title,
      type: newMaterial.value.type,
      tags: result.suggestedTags || newMaterial.value.tags,
      project: _aiProject?.name || '',
      project_id: newMaterial.value.project_id || null,
      raw_content: rawContent,
      ai_summary: result.content || '',
      created_at: iso,
      file_name: newMaterial.value.file_name || '',
      file_type: newMaterial.value.file_type || '',
    })
    newMaterial.value = emptyForm
    newMaterialFromImport.value = false
    showAddMaterial.value = false
  } catch (err) {
    addMaterialError.value = err.message || 'AI 整理失败，请重试或使用普通保存'
  } finally {
    addMaterialLoading.value = false
  }
}

async function onMaterialFiles(fileList) {
  addMaterialError.value = ''
  for (const f of fileList) {
    const result = await extractTextFromFile(f)
    if (!result.success) {
      addMaterialError.value = `导入失败：${result.error}`
      continue
    }
    const content = result.contentHtml || textToPreviewHtml(result.contentText || '')
    // 写入唯一正文源 rawContent；多文件追加
    newMaterial.value.rawContent = (newMaterial.value.rawContent ? newMaterial.value.rawContent + '\n' : '') + content
    // 标记为文件导入（显示层用 v-html，Tiptap 无法承载表格）
    newMaterialFromImport.value = true
    if (!newMaterial.value.title) newMaterial.value.title = f.name.replace(/\.[^.]+$/, '')
    if (!newMaterial.value.file_name) {
      newMaterial.value.file_name = f.name
      newMaterial.value.file_type = result.fileType
      newMaterial.value.type = '导入文档'
    }
  }
}


function deleteMaterial(id) {
  materialsStore.remove(id)
  if (expandedMaterialId.value === id) expandedMaterialId.value = null
  if (editingMaterialId.value === id) editingMaterialId.value = null
}

// -- Style references --
const uploadingStyle = ref(false)
const styleUploadError = ref('')
const styleFileInput = ref(null)
const editingStyleId = ref(null)
const editingStyleName = ref('')

function startRenameStyle(s) {
  editingStyleId.value = s.id
  editingStyleName.value = s.name
}

function saveStyleRename(id) {
  if (!editingStyleName.value.trim()) return
  stylesStore.update(id, { name: editingStyleName.value.trim() })
  editingStyleId.value = null
}

function removeStyleRef(id) {
  stylesStore.remove(id)
  if (editingStyleId.value === id) editingStyleId.value = null
}

async function uploadStyleRef() {
  const file = styleFileInput.value?.files?.[0]
  if (!file) {
    styleUploadError.value = '请先选择文件'
    return
  }
  uploadingStyle.value = true
  styleUploadError.value = ''
  const result = await extractTextFromFile(file)
  if (!result.success) {
    styleUploadError.value = `解析失败：${result.error}`
    uploadingStyle.value = false
    return
  }
  try {
    const plainText = result.contentText || ''
    const preview = plainText.slice(0, 300).replace(/\n+/g, ' ')
    stylesStore.add({
      name: file.name,
      summary: preview ? `内容预览：${preview}` : '（文档内容为空）',
      file_type: result.fileType,
    })
    styleFileInput.value.value = ''
  } catch (err) {
    styleUploadError.value = err.message
  } finally {
    uploadingStyle.value = false
  }
}

// -- Filtered materials --
const filteredMaterials = computed(() => {
  return materialsStore.items.filter(m => {
    if (materialSearch.value) {
      const q = materialSearch.value
      const rawText = (m.raw_content || '').replace(/<[^>]+>/g, '')
      if (!m.title.includes(q) && !(m.ai_summary || '').includes(q) && !rawText.includes(q)) return false
    }
    if (materialTagFilter.value && !(m.tags || []).includes(materialTagFilter.value)) return false
    return true
  })
})

const allTags = computed(() => {
  const tags = new Set()
  materialsStore.items.forEach(m => (m.tags || []).forEach(t => tags.add(t)))
  return [...tags]
})

function fmtTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()}`
}
</script>

<template>
  <div class="page">
    <!-- Tabs -->
    <div class="tabs">
      <button class="tab" :class="{ active: activeTab === 'generate' }" @click="activeTab = 'generate'">文档生成</button>
      <button class="tab" :class="{ active: activeTab === 'materials' }" @click="activeTab = 'materials'">资料库</button>
      <button class="tab" :class="{ active: activeTab === 'style' }" @click="activeTab = 'style'">文风参考</button>
    </div>

    <!-- Document Generation -->
    <div v-if="activeTab === 'generate'">
      <div class="card">
        <div class="card-title">生成设定</div>
        <div class="flex gap-12 mb-12">
          <div style="flex:1">
            <label class="text-xs text-secondary">文档类型</label>
            <select v-model="docType">
              <option v-for="dt in docTypes" :key="dt.value" :value="dt.value">{{ dt.label }}</option>
            </select>
          </div>
          <div style="flex:1">
            <label class="text-xs text-secondary">时间范围</label>
            <select v-model="sourceRange">
              <option value="this-week">本周</option>
              <option value="last-week">上周</option>
              <option value="this-month">本月</option>
              <option value="custom">自定义</option>
            </select>
          </div>
          <div style="flex:1">
            <label class="text-xs text-secondary">专项</label>
            <select v-model="sourceProject">
              <option value="">所有专项</option>
              <option v-for="p in projectsStore.names" :key="p" :value="p">{{ p }}</option>
            </select>
          </div>
        </div>

        <div class="mb-12">
          <label class="text-xs text-secondary">结构指引（可选）</label>
          <textarea v-model="structureGuide" placeholder="例如：背景 / 问题 / 实验设计 / 结果 / 下一步" rows="2"></textarea>
        </div>

        <div class="text-xs text-secondary mb-12">
          将读取：{{ dataSourceHint }}
        </div>

        <div v-if="generateError" class="text-xs mb-8" style="color:var(--color-danger)">{{ generateError }}</div>

        <button class="primary" @click="generateDoc" :disabled="generating">
          {{ generating ? '生成中...' : '生成文档' }}
        </button>
      </div>

      <div v-if="generatedDoc" class="card mt-16">
        <div class="flex-between mb-12">
          <div class="card-title" style="margin:0">生成结果</div>
          <div class="flex gap-8">
            <button class="small primary" @click="saveDoc" :disabled="saving">
              {{ saving ? '保存中...' : '保存到工作台' }}
            </button>
            <button class="small" @click="navigator.clipboard.writeText(generatedDoc)">复制</button>
            <button class="small" @click="generatedDoc = ''">清除</button>
          </div>
        </div>
        <div style="background:var(--color-bg);padding:16px;border-radius:var(--radius)">
          <MarkdownContent :content="generatedDoc" />
        </div>
      </div>

      <!-- 历史 AI 文档 -->
      <div v-if="aiDocumentsStore.loadError" class="card mt-16">
        <div class="text-sm" style="color:var(--color-danger)">{{ aiDocumentsStore.loadError }}</div>
      </div>
      <div v-else-if="aiDocumentsStore.documents.length" class="card mt-16">
        <div class="card-title">最近生成文档</div>
        <div
          v-for="doc in aiDocumentsStore.documents"
          :key="doc.id"
          class="flex-between mb-8"
          style="padding:8px 12px;border:1px solid var(--color-border);border-radius:var(--radius);cursor:pointer"
          @click="loadHistoryDoc(doc)"
        >
          <span class="text-sm">{{ doc.title }}</span>
          <span class="text-xs text-secondary">{{ fmtTime(doc.created_at) }}</span>
        </div>
      </div>
    </div>

    <!-- Materials Manager -->
    <div v-if="activeTab === 'materials'">
      <div class="card">
        <div class="flex-between mb-12">
          <div class="card-title" style="margin:0">资料库</div>
          <button class="small" @click="startAddMaterial">+ 添加资料</button>
        </div>

        <div class="flex gap-12 mb-12">
          <input type="text" v-model="materialSearch" placeholder="搜索..." style="flex:2" />
          <select v-model="materialTagFilter" style="flex:1">
            <option value="">全部标签</option>
            <option v-for="tag in allTags" :key="tag" :value="tag">{{ tag }}</option>
          </select>
        </div>

        <!-- Add material form -->
        <div v-if="showAddMaterial" style="padding:16px;border-radius:var(--radius);margin-bottom:16px;background:var(--color-bg)" @dragover.prevent @drop.prevent>
          <div class="mb-8">
            <label class="text-xs text-secondary">标题</label>
            <input type="text" v-model="newMaterial.title" />
          </div>
          <div class="flex gap-12 mb-8">
            <div style="flex:1">
              <label class="text-xs text-secondary">类型</label>
              <select v-model="newMaterial.type">
                <option>快速记录</option>
                <option>上传文件</option>
                <option>想法记录</option>
                <option>行业资料</option>
              </select>
            </div>
            <div style="flex:1">
              <label class="text-xs text-secondary">关联专项</label>
              <select v-model="newMaterial.project_id">
                <option :value="null">不关联</option>
                <option v-for="p in projectsStore.items" :key="p.id" :value="p.id">{{ p.name }}</option>
              </select>
            </div>
            <div style="flex:1">
              <label class="text-xs text-secondary">标签</label>
              <TagPicker v-model="newMaterial.tags" scope-type="library" scope-id="library" />
            </div>
          </div>
          <!-- 文件导入后：v-html 展示（rawContent 可能含表格，Tiptap 会丢弃） -->
          <div v-if="newMaterialFromImport" class="mb-8">
            <div class="flex-between mb-4">
              <label class="text-xs text-secondary">已导入内容预览</label>
              <button class="small" style="font-size:11px" @click="newMaterial.rawContent = ''; newMaterial.file_name = ''; newMaterial.file_type = ''; newMaterialFromImport = false">清除导入</button>
            </div>
            <div class="rich-content" style="max-height:300px;overflow-y:auto;padding:12px;border:1px solid var(--color-border);border-radius:var(--radius);background:var(--color-surface)" v-html="newMaterial.rawContent" />
          </div>
          <!-- 无导入内容时：RichEditor 手动输入，绑定唯一正文源 rawContent -->
          <div v-else class="mb-8">
            <label class="text-xs text-secondary">内容</label>
            <RichEditor v-model="newMaterial.rawContent" />
          </div>
          <div class="mb-8">
            <FileUploader label="导入文件（txt / md / docx / pdf，支持拖拽）" accept=".txt,.md,.docx,.pdf" @files-changed="onMaterialFiles" />
          </div>
          <div v-if="addMaterialError" class="text-xs mb-8" style="color:var(--color-danger);background:#fff0f0;border:1px solid var(--color-danger);border-radius:4px;padding:6px 10px">{{ addMaterialError }}</div>
          <div class="flex gap-8" style="align-items:center;justify-content:flex-end">
            <label class="text-xs text-secondary" style="flex-shrink:0">记录时间</label>
            <input type="datetime-local" v-model="newMaterialTime" style="width:auto;flex:1;font-size:12px" />
            <button class="small" @click="newMaterial = { title: '', rawContent: '', type: '快速记录', tags: [], project: '', project_id: null, file_name: '', file_type: '' }; newMaterialFromImport = false; showAddMaterial = false; addMaterialError = ''" :disabled="addMaterialLoading">取消</button>
            <button class="small" @click="addMaterial(false)" :disabled="addMaterialLoading">保存</button>
            <button class="small primary" @click="addMaterial(true)" :disabled="addMaterialLoading">
              {{ addMaterialLoading ? 'AI 整理中...' : '保存并 AI 整理' }}
            </button>
          </div>
        </div>

        <!-- Material list -->
        <div v-for="m in filteredMaterials" :key="m.id" class="mb-8" style="padding:12px;border:1px solid var(--color-border);border-radius:var(--radius)">
          <!-- Header row: click to expand/collapse -->
          <div class="flex-between" style="cursor:pointer" @click="expandedMaterialId = expandedMaterialId === m.id ? null : m.id">
            <div>
              <strong class="text-sm">{{ m.title }}</strong>
              <span class="text-xs text-secondary" style="margin-left:8px">{{ fmtTime(m.created_at) }}</span>
              <span class="tag" style="margin-left:8px">{{ m.type }}</span>
            </div>
            <div class="flex gap-8">
              <span v-for="tag in (m.tags || [])" :key="tag" class="tag primary">{{ tag }}</span>
            </div>
          </div>

          <!-- Expanded content -->
          <div v-if="expandedMaterialId === m.id" class="mt-8">
            <!-- Edit mode -->
            <div v-if="editingMaterialId === m.id">
              <div class="mb-8">
                <label class="text-xs text-secondary">标题</label>
                <input type="text" v-model="materialEditDraft.title" />
              </div>
              <div class="flex gap-12 mb-8">
                <div style="flex:1">
                  <label class="text-xs text-secondary">类型</label>
                  <select v-model="materialEditDraft.type">
                    <option>快速记录</option>
                    <option>上传文件</option>
                    <option>想法记录</option>
                    <option>行业资料</option>
                  </select>
                </div>
                <div style="flex:1">
                  <label class="text-xs text-secondary">标签</label>
                  <TagPicker v-model="materialEditDraft.tags" scope-type="library" scope-id="library" />
                </div>
              </div>
              <div class="mb-8">
                <label class="text-xs text-secondary">内容</label>
                <RichEditor v-model="materialEditDraft.raw_content" />
              </div>
              <div v-if="editMaterialError" class="text-xs mb-8" style="color:var(--color-danger)">{{ editMaterialError }}</div>
              <div class="flex gap-8" style="align-items:center">
                <label class="text-xs text-secondary" style="flex-shrink:0">记录时间</label>
                <input type="datetime-local" v-model="materialEditDraft.created_at" style="width:auto;flex:1;font-size:12px" />
                <button class="small" @click="editingMaterialId = null; editMaterialError = ''" :disabled="editMaterialLoading">取消</button>
                <button class="small" @click="saveMaterialEdit(m.id)" :disabled="editMaterialLoading">保存</button>
                <button class="small primary" @click="saveMaterialEditWithAI(m.id)" :disabled="editMaterialLoading">
                  {{ editMaterialLoading ? 'AI 整理中...' : 'AI 整理后保存' }}
                </button>
              </div>
            </div>
            <!-- Read mode -->
            <div v-else>
              <div v-if="m.ai_summary" class="text-secondary mb-8"><MarkdownContent :content="m.ai_summary" /></div>
              <div v-if="m.raw_content" class="mb-8 rich-content"><MarkdownContent :content="m.raw_content" /></div>
              <div v-if="m.file_name" class="text-xs text-secondary mb-8">来源：{{ m.file_name }}</div>
              <div class="flex gap-8">
                <button class="small" @click.stop="startEditMaterial(m)">编辑</button>
                <button class="small" style="color:var(--color-danger)" @click.stop="deleteMaterial(m.id)">删除</button>
              </div>
            </div>
          </div>
        </div>

        <div v-if="filteredMaterials.length === 0" class="text-sm text-secondary">暂无资料</div>
      </div>
    </div>

    <!-- Style Reference -->
    <div v-if="activeTab === 'style'">
      <div class="card">
        <div class="card-title">文风参考</div>
        <p class="text-sm text-secondary mb-12">上传 3-4 篇示例文档，AI 会自动分析文风特征并在生成文档时参考。</p>

        <div v-for="s in stylesStore.items" :key="s.id" class="mb-12" style="padding:12px;border:1px solid var(--color-border);border-radius:var(--radius)">
          <div class="flex-between">
            <!-- Name: editable or read -->
            <div v-if="editingStyleId === s.id" class="flex gap-8" style="flex:1;margin-right:8px">
              <input type="text" v-model="editingStyleName" @keydown.enter="saveStyleRename(s.id)" style="flex:1" />
              <button class="small primary" @click="saveStyleRename(s.id)">保存</button>
              <button class="small" @click="editingStyleId = null">取消</button>
            </div>
            <strong v-else class="text-sm">{{ s.name }}</strong>
            <div class="flex gap-8">
              <span class="text-xs text-secondary">{{ fmtTime(s.created_at) }}</span>
              <button v-if="editingStyleId !== s.id" class="small" @click="startRenameStyle(s)">重命名</button>
              <button class="small" style="color:var(--color-danger)" @click="removeStyleRef(s.id)">删除</button>
            </div>
          </div>
          <div class="text-sm text-secondary mt-8">{{ s.summary }}</div>
        </div>

        <div class="flex gap-8 mt-12" style="align-items:center">
          <input ref="styleFileInput" type="file" accept=".txt,.md,.docx,.pdf" style="font-size:13px" />
          <button class="small primary" @click="uploadStyleRef" :disabled="uploadingStyle || stylesStore.items.length >= 4">
            {{ uploadingStyle ? '解析中...' : '上传并分析' }}
          </button>
        </div>
        <div v-if="styleUploadError" class="text-xs mt-8" style="color:var(--color-danger)">{{ styleUploadError }}</div>
        <div v-if="stylesStore.items.length >= 4" class="text-xs text-secondary mt-8">已达上限（最多 4 篇）</div>
      </div>
    </div>
  </div>
</template>
