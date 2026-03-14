# PROJECT_CONTEXT.md

> 供 AI 协作时快速理解项目状态，请在每轮重大变更后更新。
> 最后更新：2026-03-14（AI 整理统一接入 DeepSeek）

## 1. 项目目标

个人工作系统 MVP，帮助用户管理日常任务、专项跟踪和 AI 辅助文档生成。

- **任务页**：按周管理任务，支持状态流转（todo → doing → done）、周复盘
- **专项页**：项目级管理，含当前判断、进展时间线、关联任务、删除专项（级联清空）
- **AI 页**：文档生成（接 DeepSeek API）、资料库管理、文风参考管理
- **快速记录**：跨页面浮动按钮，一键记录进展/资料/想法

核心原则：最小输入、清晰展示、AI 只整理/生成不创造事实。

## 2. 当前技术栈

| 层级 | 技术 |
|------|------|
| 框架 | Vue 3 + Composition API |
| 构建 | Vite |
| 状态管理 | Pinia |
| 路由 | Vue Router（hash 模式） |
| 持久化 | localStorage（通过 adapter 抽象） |
| 样式 | 纯 CSS（CSS 变量，无 UI 框架） |
| 富文本编辑器 | Tiptap v2（@tiptap/vue-3 + starter-kit + extension-highlight） |
| AI | DeepSeek API（OpenAI 兼容接口，deepseek-chat 模型，非流式） |

## 3. 当前实现进度

### 页面/组件

| 页面/组件 | 状态 | 说明 |
|-----------|------|------|
| TasksView | ✅ | 周概览、任务输入、状态分栏、任务详情编辑、周复盘 |
| ProjectsView | ✅ | 左右布局、专项列表、当前判断、进展时间线、关联任务、删除专项 |
| AIView | ✅ | 文档生成（接 DeepSeek）、资料库（富文本）、文风参考 |
| App.vue (QuickCapture) | ✅ | 浮动按钮 + 弹窗，支持保存到专项进展/资料库 |
| AutoTextarea | ✅ | 自动扩展高度，min ~8行/max 45vh，用于任务备注等 |
| RichEditor | ✅ | Tiptap 富文本编辑器组件，工具栏含加粗/高亮/有序无序列表/缩进 |
| MarkdownContent | ✅ | Markdown 渲染组件（marked + breaks:true），用于 AI 生成结果展示 |
| FileUploader | ✅ | 共享拖拽上传组件 |
| TagPicker | ✅ | 系统标签 + 作用域自定义标签选择器 |

### 核心能力

| 能力 | 状态 |
|------|------|
| 页面结构与路由 | ✅ |
| 基础 CRUD 与状态切换 | ✅ |
| 数据层（Pinia + localStorage Adapter） | ✅ |
| 标签系统（系统标签 + 作用域自定义标签） | ✅ |
| 专项删除（含级联清空关联数据） | ✅ |
| 所有带时间记录支持手动编辑时间戳 | ✅ |
| 富文本编辑（RichEditor，部分字段已切换） | ✅ |
| AI 文档生成（DeepSeek API，含 fallback） | ✅ |
| AI 上下文构建（5 种文档类型） | ✅ |
| AI 整理（QuickCapture / 资料库 / 专项进展） | ✅（organizeService.js，返回 JSON，失败明确报错） |

## 4. 富文本编辑器（Tiptap）

### 已切换为 RichEditor 的字段

| 页面 | 字段 | 操作类型 |
|------|------|---------|
| ProjectsView | 当前判断（新增/编辑） | 输入 |
| ProjectsView | 进展时间线（新增/AI结果确认/编辑） | 输入 |
| AIView | 资料库内容（新增/编辑） | 输入 |
| TasksView | 周回顾 | 输入（实时保存，无 blur 触发） |

### 仍使用 AutoTextarea 的字段

| 页面 | 字段 | 说明 |
|------|------|------|
| TasksView | 任务备注（task.note） | 下一轮再迁移 |

### 展示层

- 富文本字段展示全部使用 `<div class="rich-content" v-html="..." />`
- AI 生成结果（Markdown 格式）仍使用 `<MarkdownContent>`，不受影响

### 数据存储格式

- 富文本字段存 **HTML 字符串**（Tiptap 的 `getHTML()` 输出）
- 旧的纯文本/Markdown 数据会原样显示（不做迁移，接受视觉降级）

### AI 上下文中的 HTML 处理

`htmlToText()` 函数（`src/ai/contextBuilders.js` 导出）：结构化递归转换，保留列表层级、段落分隔、加粗标记，供 AI prompt 使用。

以下字段进入 AI context 前均经过 `htmlToText()`：
- 所有 `projectUpdates[].updates[].content`（进展内容）
- `weekReview`（周复盘）
- `latestJudgement.content` / `allJudgements[].content`（专项判断）
- `materials[].raw_content`（资料内容）

## 5. AI 模块架构

```
AIView → generateDocument() → buildContext() → buildMessages() → callDeepSeek()
                                    ↓
                           contextBuilders.js（5 个 builder）
                                    ↓（内容经 htmlToText 转换）
                           deepseekClient.js（fetch，非流式）
```

### 文件说明

| 文件 | 职责 |
|------|------|
| `src/ai/aiService.js` | 文档生成入口：选 builder、序列化 context、调用 API、fallback 逻辑 |
| `src/ai/organizeService.js` | AI 整理入口：QuickCapture / 资料库 / 专项进展三类整理，返回 JSON |
| `src/ai/contextBuilders.js` | 5 个 builder + `htmlToText` + `resolveDateRange` |
| `src/ai/deepseekClient.js` | 纯 HTTP 客户端，不含业务逻辑（两个服务共用） |
| `src/ai/mockGenerator.js` | Mock fallback，仅文档生成无 API Key 时使用 |

### 5 种文档类型对应 builder

| docType | Builder | 数据来源特点 |
|---------|---------|------------|
| `weekly` | buildWeeklyReportContext | 任务按 week 字段，进展/资料按 created_at |
| `monthly` | buildMonthlyReportContext | 任务按 **updated_at**（捕捉状态变更），其余按 created_at |
| `project` | buildProjectReportContext | 支持 focusRange（非 this-week 时启用）；latestJudgement 不受限 |
| `review` | buildReviewContext | weekReview 为未完成原因**主来源**，task.note 仅次要参考 |
| `free` | buildFreeformContext | structureGuide 原样透传，不做关键词映射 |

### API 配置

- **Key 位置**：项目根目录 `.env`（已配置，内含真实 key）
- **环境变量名**：`VITE_DEEPSEEK_API_KEY`
- **Fallback 逻辑**：无 key → mock（结果前附警告）；其他错误 → 向 View 层抛出

### 当前状态

API 已配置，dev server 已启动（port 5174），**AI 功能待用户实际测试确认**。

## 6. 时间戳编辑

所有带时间的记录（专项判断、进展时间线、资料库条目）均支持手动编辑时间。

### Store 层变更

| Store | 方法 | 变更 |
|-------|------|------|
| projectsStore | `addJudgement(id, content, createdAt?)` | 新增可选 createdAt 参数 |
| projectsStore | `updateJudgement(id, jid, content, createdAt?)` | 新增可选 createdAt 参数 |
| projectsStore | `addProjectUpdate(id, data)` | 透传 `data.created_at` |
| materialsStore | `add(data)` | 透传 `data.created_at` |
| materialsStore | `update(id, changes)` | 通过 Object.assign 支持 created_at 变更 |

### View 层实现

- 表单打开时默认填充当前时间（`datetime-local` 格式）
- 编辑现有记录时预填该记录的原始时间
- 用户可手动修改，保存时转换为 ISO 字符串

## 7. 标签系统

### 概述

标签分两类：**系统标签**（全局固定 7 个）和**自定义标签**（作用域隔离）。

系统标签（`src/data/tags.js`）：决策 / 数据 / 实验 / 会议 / 外部信息 / 思路 / 难点

### 自定义标签作用域

| 作用域 | scope_type | scope_id |
|--------|-----------|----------|
| 资料库 | `library` | `"library"` |
| 专项 | `project` | 专项的 id（字符串化） |

### TagPicker 集成位置

| 视图 | 表单 |
|------|------|
| AIView — 添加/编辑资料 | `newMaterial.tags` / `materialEditDraft.tags` |
| ProjectsView — 新增进展 | `progressTags` |
| ProjectsView — AI 整理结果 | `aiResult.tags` |
| ProjectsView — 编辑时间线条目 | `updateEditDraft.tags` |

## 8. 数据架构

### 分层

```
Vue 组件 → Pinia Store → Storage Adapter → localStorage
```

### 数据 Key

| Store | localStorage Key |
|-------|-----------------|
| tasks | `work_tasks` |
| tasks（周复盘） | `work_week_reviews` |
| projects | `work_projects` |
| materials | `work_materials` |
| styles | `work_styles` |
| tags | `work_tags` |

### 数据模型

- **Task**: id, title, status, project(name字符串), note, priority, due, week, created_at, updated_at
- **Project**: id, name, status, judgements[], updates[], created_at, updated_at
  - Judgement: id, content(HTML), created_at
  - Update: id, title, content(HTML), tags[], created_at
- **Material**: id, title, type, raw_content(HTML), ai_summary, tags[], project, created_at
- **StyleReference**: id, name, content, summary, file_type, created_at

> **注意**：`content`/`raw_content` 字段格式：
> - 通过 RichEditor 新创建的记录 → **HTML 字符串**
> - 历史/种子数据 → 纯文本或 Markdown（展示时接受视觉降级，不做迁移）

### 持久化关键点

- `_persist()` 使用 `JSON.parse(JSON.stringify(this.items))` 深拷贝以剥离 Pinia reactive proxy
- 每次写操作（add/update/remove）都触发 `_persist()`

## 9. 项目结构

```
src/
├── views/
│   ├── TasksView.vue       # 任务页
│   ├── ProjectsView.vue    # 专项页
│   └── AIView.vue          # AI 页
├── stores/
│   ├── tasks.js            # 任务 + 周复盘
│   ├── projects.js         # 专项（含 judgements/updates）
│   ├── materials.js        # 资料库
│   ├── styles.js           # 文风参考
│   └── tags.js             # 标签
├── ai/
│   ├── aiService.js        # 入口（context选择、消息构建、调用、fallback）
│   ├── contextBuilders.js  # 5个builder + htmlToText + resolveDateRange
│   ├── deepseekClient.js   # DeepSeek HTTP 客户端
│   └── mockGenerator.js    # Mock fallback（无 API key 时使用）
├── data/
│   ├── adapters/           # localStorage 适配器 + 切换入口
│   ├── repositories/       # 未使用，待清理
│   └── seed.js             # 首次加载种子数据
├── components/shared/
│   ├── RichEditor.vue      # Tiptap 富文本编辑器（工具栏+编辑区）
│   ├── AutoTextarea.vue    # 自动扩展高度 textarea
│   ├── MarkdownContent.vue # Markdown 渲染（用于 AI 生成结果）
│   ├── TagPicker.vue       # 标签选择器
│   └── FileUploader.vue    # 拖拽上传
├── router/                 # Vue Router 配置
├── App.vue                 # 导航 + 快速记录浮动按钮
├── main.js                 # 入口，初始化所有 store
└── style.css               # 全局样式（含 .markdown-content / .tiptap / .rich-content）
```

## 10. 已知问题与技术债

### 待验证

- DeepSeek AI 生成功能：API 已配置，**尚未完成实际调用测试**（明天继续）
- 测试方法：访问 AI 页 → 文档生成 → 生成周报，结果无"⚠️ 未配置 API Key"前缀即代表 API 调用成功

### 功能缺失

- 任务备注（task.note）仍使用 AutoTextarea，尚未迁移到 RichEditor（下一轮）
- 文件上传仅前端展示，无实际存储
- 快速记录（QuickCapture）的内容输入尚未切换为 RichEditor

### 技术债

- `src/data/repositories/` 目录下 4 个文件**已不再被使用**，待清理
- 任务通过 `project` name 字符串关联专项（非 project_id），暂不迁移
- Tiptap 引入后 JS bundle 增大至 ~574KB（188KB gzip），如需优化可做动态 import

## 11. 下一步开发计划

### 立即（明天）
- [ ] 实际测试 DeepSeek AI 生成功能，确认 API 调用链路正常
- [ ] 如有问题，排查网络/key 问题（401 = key 无效，网络错误 = 代理问题）

### 富文本迁移（下一轮）
- [ ] 任务备注（task.note）迁移到 RichEditor
- [ ] 快速记录（QuickCapture）内容输入迁移到 RichEditor

### 功能完善
- [ ] 专项颜色标记
- [ ] 时间线/资料全文搜索
- [ ] 数据统计面板

### 远期
- [ ] 云端持久化（替换 localStorage adapter，Store actions 改为 async）

## 12. 启动方式

```bash
npm install
npm run dev
```

访问 http://localhost:5173（若被占用则退而使用 5174）

## 13. AI 协作规范

**必须遵守：**
- 不要在 Vue 组件中直接使用 `localStorage`，所有读写通过 Pinia Store → Adapter
- 富文本字段（HTML）进入 AI prompt 前必须经过 `htmlToText()`（在 contextBuilders.js 中处理）
- Store 中写入 localStorage 前必须 `JSON.parse(JSON.stringify(...))` 剥离 reactive proxy
- 避免 inline mock 数据，使用 `src/data/seed.js` 管理种子数据
- RichEditor 保存时不能用 `.trim()` 验证空值，应用 `replace(/<[^>]+>/g,'').trim()` 检测

**按批次推进原则（已确立）：**
- 富文本迁移按"单点试点 → 验证 → 推广"方式，不一次性全站替换
- 当前已完成：进展时间线、当前判断、资料库内容、周回顾
- 尚未迁移：任务备注、快速记录
