# WorkOS 项目设计文档

> 供 AI 协作者快速理解项目结构、数据设计和当前进展。
> 最后更新：2026-03-15

---

## 一、项目定位

**WorkOS** 是一个个人单用户工作管理系统，支持多设备访问（云端同步）。

- 前端部署目标：Vercel（静态站点）
- 数据存储：Supabase（PostgreSQL + Auth）
- AI 能力：DeepSeek API
- 使用者：仅创建者本人（单用户）

---

## 二、技术栈

| 层级 | 技术 |
|---|---|
| 前端框架 | Vue 3 (Composition API + Options API 混用) |
| 构建工具 | Vite |
| 状态管理 | Pinia |
| 路由 | Vue Router 4，**Hash 模式**（`createWebHashHistory`） |
| 后端即服务 | Supabase（Auth + PostgreSQL） |
| AI | DeepSeek API（`VITE_DEEPSEEK_API_KEY`） |
| 本地持久化 | localStorage（双写备份） |

---

## 三、功能模块概览

| 路由 | 视图文件 | 功能 |
|---|---|---|
| `/#/tasks` | `TasksView.vue` | 任务管理（按周视图）+ 周回顾 |
| `/#/projects` | `ProjectsView.vue` | 专项管理（判断历史 + 进展时间线 + 关联任务） |
| `/#/ai` | `AIView.vue` | AI 文档生成 + 资料库 + 文风参考 + 历史文档 |
| `/#/auth` | `AuthView.vue` | 邮箱密码登录 / 注册 |

导航守卫：未登录强制跳 `/auth`；已登录访问 `/auth` 跳 `/tasks`。

---

## 四、数据库 Schema（v2-final 冻结方案）

> ⚠️ 以下为唯一权威 schema 基准。禁止从 src/ 代码推断表结构。

### 完整表清单（8张）

```
projects
project_updates
project_judgements
tasks
week_reviews
materials
ai_documents
style_references
```

---

### 4.1 `projects`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 主键，`crypto.randomUUID()` 生成 |
| user_id | UUID | 关联 auth.users |
| name | text | 专项名称 |
| status | text | `active` / `done` / `paused` |
| created_at | timestamptz | |
| updated_at | timestamptz | 应用层显式写入，不用触发器 |

约束：`UNIQUE(user_id, name)`

子表数据（嵌套在 localStorage，独立存 Supabase）：
- `judgements[]`：当前判断历史（存 `project_judgements` 表）
- `updates[]`：进展时间线（存 `project_updates` 表）

---

### 4.2 `project_judgements`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | |
| user_id | UUID | |
| project_id | UUID | 关联 projects.id |
| content | text | 富文本 HTML |
| created_at | timestamptz | |

---

### 4.3 `project_updates`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | |
| user_id | UUID | |
| project_id | UUID | 关联 projects.id |
| title | text | 可空，不自动生成 |
| content | text | 富文本 HTML |
| created_at | timestamptz | |

注：`tags` 字段仅存 localStorage，暂不同步 Supabase（v2-final 未明确 tags 列）。

---

### 4.4 `tasks`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | |
| user_id | UUID | |
| title | text | |
| status | text | `todo` / `doing` / `done` |
| project | text | 专项名称（显示缓存，旧数据兼容） |
| project_id | UUID | 专项 UUID（Step 6 起为主关联键，nullable） |
| note | text | 执行备注，富文本 |
| priority | text | `high` / `medium` / `low` / 空 |
| due | date string | 截止日期 |
| week | int | 所属周次 |
| completed_at | timestamptz | v2-final 冻结字段，完成时设置 |
| created_at | timestamptz | |
| updated_at | timestamptz | |

**project_id 关联策略（Step 6）：**
- 新记录：同时写 `project_id`（UUID）和 `project`（name，显示缓存）
- 旧记录：`project_id` 为 null，fallback 用 `project` name 匹配
- 筛选逻辑：`project_id` 优先，无则 fallback `project` name

---

### 4.5 `week_reviews`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | |
| user_id | UUID | |
| week_label | text | 周期标识，如 `2024-W03` |
| content | text | 富文本 HTML |
| created_at | timestamptz | |
| updated_at | timestamptz | |

写入策略：应用层 check-then-write（先 SELECT 查有无，再决定 INSERT 或 UPDATE），不依赖 DB UNIQUE 约束。
建议在 Supabase 执行：
```sql
ALTER TABLE week_reviews
  ADD CONSTRAINT week_reviews_user_week_unique UNIQUE (user_id, week_label);
```

---

### 4.6 `materials`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | |
| user_id | UUID | |
| title | text | |
| type | text | `快速记录` / `上传文件` / `想法记录` / `行业资料` |
| raw_content | text | 原始内容，富文本 HTML 或纯文本 |
| ai_summary | text | AI 整理后的摘要 |
| tags | text[] | 标签数组 |
| project | text | 专项名（显示缓存） |
| project_id | UUID | 专项 UUID（Step 6 起，nullable） |
| file_name | text | 导入文件名 |
| file_type | text | 文件类型 |
| created_at | timestamptz | |

---

### 4.7 `ai_documents`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | |
| user_id | UUID | |
| title | text | 从 Markdown 首行 `#` 提取 |
| content_md | text | Markdown 原文 |
| content_html | text | `marked.parse(content_md)` 转换结果 |
| created_at | timestamptz | |
| updated_at | timestamptz | |

纯云端数据，不使用 localStorage。历史文档按 `created_at` 倒序加载。

---

### 4.8 `style_references`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | |
| user_id | UUID | |
| name | text | 文风参考名称 |
| content | text | 原文内容 |
| summary | text | AI 分析的文风摘要 |
| file_type | text | |
| created_at | timestamptz | |

---

## 五、localStorage 键名清单

| Key | 对应模块 | 说明 |
|---|---|---|
| `work_projects` | projects store | 含嵌套 judgements[] 和 updates[] |
| `work_tasks` | tasks store | |
| `work_week_reviews` | tasks store | `{ [week_label]: content }` 对象 |
| `work_materials` | materials store | |
| `work_styles` | styles store | |
| `work_tags` | tags store | 自定义标签，仅本地，未云端同步 |

---

## 六、数据流架构

### 启动流程（main.js）

```
createApp
  → auth.initialize()          // await：等 Supabase session 恢复
  → watch(user → logout)       // 登出时跳 /auth（唯一导航权威）
  → local init()  ×5           // 从 localStorage 加载（同步，立即）
  → await initFromCloud() ×5   // 从 Supabase 覆盖（异步，失败静默降级）
  → app.mount()                // mount 前云端数据已就绪，无闪烁
```

### 写入流程（双写）

```
用户操作
  → 写 localStorage（同步，即时）
  → syncCreate/syncUpdate/syncDelete（fire-and-forget，不阻塞 UI）
      → 失败时：syncStatus.error = 提示文字
                App.vue 显示橙色 banner
```

### 云端写入辅助函数（src/lib/cloudSync.js）

| 函数 | 用途 |
|---|---|
| `syncCreate(table, data)` | INSERT，自动注入 user_id |
| `syncUpdate(table, id, changes)` | UPDATE，用 id+user_id 定位 |
| `syncDelete(table, id)` | DELETE，用 id+user_id 定位 |
| `syncWeekReview(weekLabel, content)` | week_reviews 专用 check-then-write |

---

## 七、Store 层设计

| Store 文件 | 模式 | 主要职责 |
|---|---|---|
| `auth.js` | Composition API | user、appReady、initialize/signIn/signUp/signOut |
| `projects.js` | Options API | 专项 CRUD + judgements + updates，双写 |
| `tasks.js` | Options API | 任务 CRUD + weekReviews，双写 |
| `materials.js` | Options API | 资料 CRUD，双写 |
| `styles.js` | Options API | 文风参考 CRUD，双写（表名 `style_references`） |
| `aiDocuments.js` | Composition API | 纯云端，无 localStorage |
| `tags.js` | Options API | 自定义标签，**仅 localStorage，未云端同步** |
| `migration.js` | Composition API | 遗留文件，当前不再使用（Step 7 收口后移除了调用） |

---

## 八、认证设计

- 方式：Supabase Auth，邮箱 + 密码
- **建议关闭 email confirmation**（个人系统，无需验证）
- 登出导航：`main.js` 的 `watch(user → router.push('/auth'))` 是唯一权威入口
- Router guard：`beforeEach` 仅做状态检查，不做导航跳转主逻辑

Supabase Dashboard 配置要求：
- Site URL：`http://localhost:5173`（开发）/ 部署后改为 Vercel URL
- Redirect URLs：同上

---

## 九、AI 功能设计

### AI 服务文件（src/ai/）

| 文件 | 职责 |
|---|---|
| `deepseekClient.js` | DeepSeek API 请求封装 |
| `aiService.js` | 文档生成主逻辑（周报/月报/专项报告/复盘/自由） |
| `organizeService.js` | 内容整理（资料整理 / 进展整理 / 快速捕捉） |
| `contextBuilders.js` | 将 store 数据组装为 AI prompt 上下文 |
| `tagService.js` | AI 自动打标签 |
| `recognitionService.js` | 文件内容识别 |
| `mockGenerator.js` | 无 API Key 时的本地模拟输出 |

### 文档生成类型

`weekly`（周报）/ `monthly`（月报）/ `project`（专项报告）/ `review`（复盘）/ `free`（自由生成）

生成的文档可保存到 `ai_documents` 表，在 AIView 历史列表中展示。

---

## 十、共享组件（src/components/shared/）

| 组件 | 用途 |
|---|---|
| `RichEditor.vue` | Tiptap 富文本编辑器（不支持表格） |
| `MarkdownContent.vue` | Markdown 渲染展示 |
| `AutoTextarea.vue` | 自动调高的 textarea |
| `FileUploader.vue` | 文件拖拽上传（.txt/.md/.docx/.pdf） |
| `TagPicker.vue` | 标签选择器，支持自定义标签（scope: library/project） |

---

## 十一、全局 Banner 系统（App.vue）

| Banner | 触发条件 | 颜色 |
|---|---|---|
| 云端同步失败 | `syncStatus.error` 非空 | 橙色 |
| localStorage 写入失败 | `storageStatus.error` 非空 | 红色 |

---

## 十二、环境变量（.env.local）

```
VITE_SUPABASE_URL=https://你的项目ID.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...
VITE_DEEPSEEK_API_KEY=sk-...
```

⚠️ `VITE_` 前缀使变量打包进浏览器 JS（对外可见）。
- `SUPABASE_ANON_KEY` 设计上可公开（安全靠 RLS）
- `DEEPSEEK_API_KEY` 暴露意味着密钥可被他人使用，后续可考虑后端中转

---

## 十三、当前完成进度（Step 1–7）

| Step | 内容 | 状态 |
|---|---|---|
| Step 1 | Supabase 项目初始化，client 接入，testConnection | ✅ 完成 |
| Step 2 | Supabase Auth，邮箱密码登录，session 生命周期，router guard | ✅ 完成 |
| Step 3 | 云端只读加载（initFromCloud × 5），mount 前 await 防闪烁 | ✅ 完成 |
| Step 4 | 双写架构（所有写操作同步 Supabase），syncStatus 失败 banner，UUID ID | ✅ 完成 |
| Step 5 | AI 文档持久化（ai_documents 表），历史列表，加载失败局部提示 | ✅ 完成 |
| Step 6 | 专项关联升级为 project_id UUID（Tasks + Materials），ID 优先 fallback 名称 | ✅ 完成 |
| Step 7 | 移除迁移 banner，清空本地测试数据入口，切入正式云端使用期 | ✅ 完成 |

---

## 十四、待处理 / 已知事项

| 事项 | 说明 |
|---|---|
| 前端部署 | 方案确定为 Vercel，待执行（推 GitHub → 配置 env → 绑域名） |
| 临时 console.log | `src/lib/supabase.js` 第 4 行有调试 log，部署前需删除 |
| DeepSeek API Key 暴露 | 当前直接打包进前端，个人使用短期可接受，后续可加后端中转 |
| tags 未云端同步 | `work_tags` 仅 localStorage，多设备自定义标签不同步 |
| week_reviews UNIQUE 约束 | 建议在 Supabase SQL Editor 手动添加（见第四节 4.5） |
| 专项改名后 project 字段不联动 | 预期行为，project_id 关联不丢，显示缓存保留旧名 |
| 专项删除后 project_id 置 null | 已实现（ProjectsView.deleteProject），但不做级联处理 |

---

## 十五、关键设计决策记录

1. **Hash 路由**：使用 `createWebHashHistory`，Vercel 静态部署无需 rewrites 配置
2. **mount 前 await**：云端数据在 mount 前加载完毕，首屏无本地数据闪烁
3. **双写 fire-and-forget**：本地写入不被云端阻塞，失败通过 banner 告知
4. **单一导航权威**：只有 `main.js` 的 watch 负责登出跳转，App.vue 和 router guard 不做导航决策
5. **project_id 双字段并存**：`project`（name）作显示缓存，`project_id`（UUID）作关联主键，旧数据通过 name fallback 兼容
6. **updated_at 应用层写入**：不使用 Supabase 数据库触发器，所有时间戳由应用显式赋值
7. **week_reviews check-then-write**：不依赖未确认的 DB UNIQUE 约束，应用层先查后写
