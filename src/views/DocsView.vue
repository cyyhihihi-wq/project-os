<script setup>
import { ref, computed } from 'vue'
import { useDocsStore, PERIOD_LABELS } from '../stores/docs.js'
import { useProjectsStore } from '../stores/projects.js'
import RichEditor from '../components/shared/RichEditor.vue'

const docsStore = useDocsStore()
const projectsStore = useProjectsStore()

// ── 筛选 ──
const activeFilter = ref('all') // 'all' | 'milestone' | 'periodic'

const filteredDocs = computed(() => {
  const sorted = docsStore.sorted
  if (activeFilter.value === 'all') return sorted
  return sorted.filter(d => d.type === activeFilter.value)
})

// ── 选中 ──
const selectedId = ref(null)
const selectedDoc = computed(() => docsStore.items.find(d => d.id === selectedId.value) || null)

function selectDoc(id) {
  selectedId.value = id
  isEditing.value = false
  isCreating.value = false
}

// ── 新建 / 编辑 状态 ──
const isCreating = ref(false)
const isEditing = ref(false)

const draft = ref(emptyDraft())

function emptyDraft() {
  return {
    title: '',
    type: 'milestone',
    date: '',
    period_type: 'monthly',
    period_start: '',
    period_end: '',
    project_id: null,
    project: '',
    content: '',
  }
}

function startCreate() {
  draft.value = emptyDraft()
  selectedId.value = null
  isCreating.value = true
  isEditing.value = false
}

function startEdit() {
  const d = selectedDoc.value
  if (!d) return
  draft.value = {
    title: d.title,
    type: d.type,
    date: d.date || '',
    period_type: d.period_type || 'monthly',
    period_start: d.period_start || '',
    period_end: d.period_end || '',
    project_id: d.project_id || null,
    project: d.project || '',
    content: d.content || '',
  }
  isEditing.value = true
  isCreating.value = false
}

function saveDoc() {
  if (!draft.value.title.trim()) {
    saveError.value = '请填写文档标题'
    return
  }
  if (draft.value.type === 'milestone' && !draft.value.date) {
    saveError.value = '请填写阶段时间'
    return
  }
  if (draft.value.type === 'periodic' && !draft.value.period_start) {
    saveError.value = '请填写周期开始时间'
    return
  }
  saveError.value = ''
  if (isCreating.value) {
    const newDoc = docsStore.add({ ...draft.value })
    selectedId.value = newDoc.id
    isCreating.value = false
  } else {
    docsStore.update(selectedId.value, { ...draft.value })
    isEditing.value = false
  }
}

function cancelEdit() {
  isEditing.value = false
  isCreating.value = false
  saveError.value = ''
  // 如果没有选中文档，自动选中第一个
  if (!selectedDoc.value && docsStore.items.length > 0) {
    selectedId.value = docsStore.items[0].id
  }
}

function deleteDoc() {
  if (!selectedDoc.value) return
  if (!window.confirm(`确定删除文档「${selectedDoc.value.title}」？此操作不可撤销。`)) return
  const remainList = docsStore.sorted.filter(d => d.id !== selectedId.value)
  docsStore.remove(selectedId.value)
  selectedId.value = remainList[0]?.id || null
}

// ── 表单关联专项 ──
function onProjectChange(e) {
  const id = e.target.value
  if (!id) {
    draft.value.project_id = null
    draft.value.project = ''
    return
  }
  const p = projectsStore.items.find(p => p.id === id)
  draft.value.project_id = p?.id || null
  draft.value.project = p?.name || ''
}

const saveError = ref('')

// ── 展示辅助 ──
function fmtDate(iso) {
  if (!iso) return ''
  return iso.slice(0, 10)
}

function getDocSubtitle(doc) {
  if (doc.type === 'milestone') {
    return doc.date ? `阶段 · ${doc.date}` : '阶段性'
  }
  const pl = PERIOD_LABELS[doc.period_type] || doc.period_type
  const range = [doc.period_start, doc.period_end].filter(Boolean).join(' ~ ')
  return range ? `${pl} · ${range}` : pl
}
</script>

<template>
  <div class="page-wide">
    <div class="projects-layout">

      <!-- ══ 左侧列表 ══ -->
      <div class="projects-left">
        <!-- 头部 -->
        <div class="card" style="padding:12px 14px;margin-bottom:8px">
          <div class="flex-between" style="margin-bottom:10px">
            <span style="font-weight:700;font-size:15px">文档成果</span>
            <button class="small primary" style="font-size:12px" @click="startCreate">+ 新建</button>
          </div>
          <!-- 筛选 tabs -->
          <div class="flex gap-4">
            <button
              v-for="tab in [
                { key: 'all', label: '全部' },
                { key: 'milestone', label: '阶段性' },
                { key: 'periodic', label: '周期性' },
              ]"
              :key="tab.key"
              class="small"
              style="font-size:12px;flex:1"
              :style="{
                background: activeFilter === tab.key ? 'var(--color-primary)' : '',
                color: activeFilter === tab.key ? '#fff' : '',
                borderColor: activeFilter === tab.key ? 'var(--color-primary)' : '',
              }"
              @click="activeFilter = tab.key"
            >{{ tab.label }}</button>
          </div>
        </div>

        <!-- 文档列表 -->
        <div v-if="filteredDocs.length === 0" class="text-xs text-secondary" style="text-align:center;padding:20px 0">
          {{ docsStore.items.length === 0 ? '还没有文档，点击「新建」创建第一篇' : '该分类下暂无文档' }}
        </div>

        <div
          v-for="doc in filteredDocs"
          :key="doc.id"
          class="card"
          style="padding:10px 14px;cursor:pointer;margin-bottom:6px;transition:border-color 0.15s"
          :style="{ borderColor: selectedId === doc.id ? 'var(--color-primary)' : '' }"
          @click="selectDoc(doc.id)"
        >
          <div class="text-sm" style="font-weight:600;margin-bottom:3px;word-break:break-all">{{ doc.title }}</div>
          <div class="text-xs text-secondary">{{ getDocSubtitle(doc) }}</div>
          <div v-if="doc.project" class="text-xs" style="margin-top:3px;color:var(--color-primary)">{{ doc.project }}</div>
        </div>
      </div>

      <!-- ══ 右侧内容区 ══ -->
      <div class="projects-right">

        <!-- 空状态 -->
        <div
          v-if="!selectedDoc && !isCreating"
          class="card"
          style="text-align:center;padding:60px 20px;color:var(--color-text-secondary)"
        >
          <div style="font-size:32px;margin-bottom:12px">📄</div>
          <div class="text-sm">选择左侧文档查看内容</div>
          <div class="text-xs" style="margin-top:6px">或点击「新建」创建第一篇</div>
        </div>

        <!-- 编辑 / 新建 表单 -->
        <div v-else-if="isEditing || isCreating" class="card" style="padding:24px">
          <!-- 表单头 -->
          <div class="flex-between" style="margin-bottom:24px">
            <span style="font-weight:700;font-size:16px">{{ isCreating ? '新建文档' : '编辑文档' }}</span>
            <button class="small" style="font-size:18px;padding:0 6px;line-height:1" @click="cancelEdit">×</button>
          </div>

          <!-- 标题 -->
          <div class="form-row">
            <label class="form-label">标题</label>
            <input
              v-model="draft.title"
              type="text"
              placeholder="给这篇文档起个名字…"
              style="font-size:15px;font-weight:600"
            />
          </div>

          <!-- 类型：分段控件样式 -->
          <div class="form-row">
            <label class="form-label">类型</label>
            <div class="type-toggle">
              <button
                type="button"
                class="type-btn"
                :class="{ active: draft.type === 'milestone' }"
                @click="draft.type = 'milestone'"
              >
                <span class="type-icon">📌</span>
                <span class="type-main">阶段性</span>
                <span class="type-sub">某个时间节点的判断或成果</span>
              </button>
              <button
                type="button"
                class="type-btn"
                :class="{ active: draft.type === 'periodic' }"
                @click="draft.type = 'periodic'"
              >
                <span class="type-icon">🔄</span>
                <span class="type-main">周期性</span>
                <span class="type-sub">周报 / 双周报 / 月报等</span>
              </button>
            </div>
          </div>

          <!-- 阶段性：日期 -->
          <div v-if="draft.type === 'milestone'" class="form-row">
            <label class="form-label">时间节点</label>
            <input v-model="draft.date" type="date" style="width:auto" />
          </div>

          <!-- 周期性：类型 + 起止 -->
          <div v-if="draft.type === 'periodic'" class="form-row">
            <label class="form-label">周期设置</label>
            <div class="period-inputs">
              <select v-model="draft.period_type" class="period-select">
                <option value="weekly">周报</option>
                <option value="biweekly">双周报</option>
                <option value="monthly">月报</option>
              </select>
              <div class="period-range">
                <input v-model="draft.period_start" type="date" />
                <span class="range-sep">→</span>
                <input v-model="draft.period_end" type="date" />
              </div>
            </div>
          </div>

          <!-- 关联专项 -->
          <div class="form-row">
            <label class="form-label">关联专项 <span style="font-weight:400;opacity:0.6">（可选）</span></label>
            <select :value="draft.project_id || ''" @change="onProjectChange" style="width:auto;min-width:160px">
              <option value="">不关联</option>
              <option v-for="p in projectsStore.items" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </div>

          <!-- 分割线 -->
          <div style="border-top:1px solid var(--color-border);margin:8px 0 20px"></div>

          <!-- 内容 -->
          <div>
            <label class="form-label" style="display:block;margin-bottom:8px">
              内容
              <span style="font-weight:400;opacity:0.6;margin-left:4px">可从飞书、Notion 等直接粘贴</span>
            </label>
            <RichEditor v-model="draft.content" :enableImagePaste="true" />
          </div>

          <!-- 错误 -->
          <div v-if="saveError" style="margin-top:12px;padding:8px 12px;background:#fef2f2;border:1px solid #fca5a5;border-radius:var(--radius);font-size:13px;color:var(--color-danger)">
            {{ saveError }}
          </div>

          <!-- 操作 -->
          <div class="flex gap-8" style="justify-content:flex-end;margin-top:20px">
            <button @click="cancelEdit">取消</button>
            <button class="primary" @click="saveDoc">{{ isCreating ? '创建文档' : '保存修改' }}</button>
          </div>
        </div>

        <!-- 查看模式 -->
        <div v-else-if="selectedDoc" class="card">
          <!-- 头部 -->
          <div class="flex-between" style="margin-bottom:14px">
            <div style="flex:1;min-width:0">
              <h2 style="font-size:17px;font-weight:700;margin:0 0 6px;word-break:break-all">{{ selectedDoc.title }}</h2>
              <div class="flex gap-8" style="align-items:center;flex-wrap:wrap">
                <!-- 类型徽章 -->
                <span
                  class="tag"
                  :style="{
                    color: selectedDoc.type === 'milestone' ? 'var(--color-warning)' : 'var(--color-primary)',
                    borderColor: selectedDoc.type === 'milestone' ? 'var(--color-warning)' : 'var(--color-primary)',
                  }"
                >
                  {{ selectedDoc.type === 'milestone' ? '阶段性' : (PERIOD_LABELS[selectedDoc.period_type] || '周期性') }}
                </span>
                <!-- 时间 -->
                <span class="text-xs text-secondary">
                  <template v-if="selectedDoc.type === 'milestone'">{{ selectedDoc.date || '-' }}</template>
                  <template v-else>
                    {{ [selectedDoc.period_start, selectedDoc.period_end].filter(Boolean).join(' ~ ') || '-' }}
                  </template>
                </span>
                <!-- 关联专项 -->
                <span v-if="selectedDoc.project" class="text-xs" style="color:var(--color-primary)">
                  专项：{{ selectedDoc.project }}
                </span>
              </div>
            </div>
            <div class="flex gap-6" style="flex-shrink:0;margin-left:12px">
              <button class="small" @click="startEdit">编辑</button>
              <button class="small" style="color:var(--color-danger);border-color:var(--color-danger)" @click="deleteDoc">删除</button>
            </div>
          </div>

          <div style="border-top:1px solid var(--color-border);padding-top:14px">
            <!-- 有内容 -->
            <div
              v-if="selectedDoc.content && selectedDoc.content.replace(/<[^>]+>/g,'').trim()"
              class="rich-content"
              v-html="selectedDoc.content"
              style="font-size:14px;line-height:1.75"
            ></div>
            <!-- 无内容 -->
            <div v-else class="text-xs text-secondary" style="text-align:center;padding:24px 0">
              暂无内容，点击「编辑」添加
            </div>
          </div>
        </div>

      </div>
    </div>
  </div>
</template>

<style scoped>
.projects-layout {
  display: flex;
  gap: 20px;
  align-items: flex-start;
}
.projects-left {
  flex: 0 0 260px;
  min-width: 0;
}
.projects-right {
  flex: 1;
  min-width: 0;
}

/* ── 表单行 ── */
.form-row {
  display: grid;
  grid-template-columns: 88px 1fr;
  gap: 8px 14px;
  align-items: start;
  margin-bottom: 18px;
}
.form-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-secondary);
  padding-top: 8px;
  line-height: 1.4;
}

/* ── 类型切换 ── */
.type-toggle {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.type-btn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  padding: 12px 14px;
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius);
  background: var(--color-surface);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s, background 0.15s;
}
.type-btn:hover {
  border-color: var(--color-primary);
  background: var(--color-primary-light);
}
.type-btn.active {
  border-color: var(--color-primary);
  background: var(--color-primary-light);
}
.type-icon {
  font-size: 16px;
  margin-bottom: 2px;
}
.type-main {
  font-size: 14px;
  font-weight: 700;
  color: var(--color-text);
}
.type-btn.active .type-main {
  color: var(--color-primary);
}
.type-sub {
  font-size: 12px;
  color: var(--color-text-secondary);
  line-height: 1.4;
}

/* ── 周期输入组 ── */
.period-inputs {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.period-select {
  width: auto;
  font-size: 13px;
  font-weight: 600;
}
.period-range {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.period-range input {
  width: auto;
  flex-shrink: 0;
}
.range-sep {
  font-size: 12px;
  color: var(--color-text-secondary);
  flex-shrink: 0;
}
</style>
