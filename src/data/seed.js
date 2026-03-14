/**
 * Seed data for first-time use.
 * Only loaded when localStorage is empty.
 */

export const seedTasks = [
  { id: 1, title: '完成产品需求文档初稿', status: 'done', project: '产品重构', note: '已与团队对齐', priority: '', due: '2026-03-13', week: 11, created_at: '2026-03-10T09:00:00', updated_at: '2026-03-11T14:00:00' },
  { id: 2, title: '调研竞品数据分析方案', status: 'doing', project: '数据平台', note: '', priority: '', due: '2026-03-14', week: 11, created_at: '2026-03-10T10:00:00', updated_at: '2026-03-11T10:30:00' },
  { id: 3, title: '准备周五复盘会议材料', status: 'todo', project: '', note: '', priority: '', due: '2026-03-14', week: 11, created_at: '2026-03-09T08:00:00', updated_at: '2026-03-10T18:00:00' },
  { id: 4, title: '更新项目进度看板', status: 'todo', project: '产品重构', note: '', priority: '', due: '', week: 11, created_at: '2026-03-09T09:00:00', updated_at: '2026-03-10T09:00:00' },
  { id: 5, title: '编写接口文档', status: 'doing', project: '数据平台', note: '已完成 3/5 个接口', priority: '', due: '2026-03-15', week: 11, created_at: '2026-03-10T11:00:00', updated_at: '2026-03-11T11:20:00' },
]

export const seedProjects = [
  {
    id: 1,
    name: '产品重构',
    status: 'active',
    judgements: [
      { id: 1, content: '当前方案基本可行，但需要增加数据迁移的灰度策略。计划下周完成接口设计，并与后端对齐。', created_at: '2026-03-11T10:00:00' },
      { id: 2, content: '初步评估风险可控，技术选型已确认使用新框架。', created_at: '2026-03-08T16:00:00' },
    ],
    updates: [
      { id: 1, title: '完成技术选型评审', content: '经过三轮评审，确定使用 Vue 3 + Vite 作为新框架。主要考量：团队熟悉度、生态完善度、迁移成本。已输出选型报告并获得技术委员会批准。', tags: ['技术', '里程碑'], created_at: '2026-03-10T15:00:00' },
      { id: 2, title: '需求文档初稿完成', content: '完成了产品需求文档的初稿编写，涵盖核心功能模块的定义和交互流程。下一步需要与设计团队对齐视觉方案。', tags: ['需求', '文档'], created_at: '2026-03-08T11:00:00' },
    ],
    created_at: '2026-03-01T00:00:00',
    updated_at: '2026-03-11T14:00:00',
  },
  {
    id: 2,
    name: '数据平台',
    status: 'active',
    judgements: [
      { id: 1, content: '数据采集模块已稳定运行，下一步聚焦数据清洗和可视化。需要额外招聘一名数据工程师。', created_at: '2026-03-09T14:00:00' },
    ],
    updates: [
      { id: 1, title: '数据采集管道上线', content: '核心数据采集管道已部署到生产环境，日处理数据量达 100 万条。监控告警已配置完成。', tags: ['上线', '基础设施'], created_at: '2026-03-07T18:00:00' },
    ],
    created_at: '2026-03-01T00:00:00',
    updated_at: '2026-03-11T11:20:00',
  },
  {
    id: 3,
    name: '团队管理',
    status: 'active',
    judgements: [
      { id: 1, content: '团队士气稳定，但需要关注新人融入情况。建议下周组织一次团建。', created_at: '2026-03-09T09:00:00' },
    ],
    updates: [],
    created_at: '2026-03-01T00:00:00',
    updated_at: '2026-03-09T09:00:00',
  },
]

export const seedMaterials = [
  { id: 1, title: '竞品分析报告 - DataHub', type: '行业资料', raw_content: '', ai_summary: '分析了 DataHub 的核心功能、定价策略和用户画像...', tags: ['竞品', '数据'], project: '', created_at: '2026-03-10T00:00:00' },
  { id: 2, title: '关于数据治理的几点思考', type: '想法记录', raw_content: '', ai_summary: '数据治理的核心不是工具，而是组织流程...', tags: ['数据治理', '思考'], project: '', created_at: '2026-03-09T00:00:00' },
  { id: 3, title: '用户访谈记录 - 张经理', type: '快速记录', raw_content: '', ai_summary: '张经理提到目前最大痛点是数据更新不及时...', tags: ['用户', '访谈'], project: '', created_at: '2026-03-07T00:00:00' },
]

export const seedStyles = [
  { id: 1, name: '周报范文 - 简洁风格.docx', content: '', summary: '简洁明了，使用短句，重结论轻过程。段落简短，要点清晰。', file_type: 'docx', created_at: '2026-03-05T00:00:00' },
  { id: 2, name: '项目复盘报告模板.pdf', content: '', summary: '结构化叙述，按"背景-问题-方案-结果-反思"展开。语气客观，数据驱动。', file_type: 'pdf', created_at: '2026-03-03T00:00:00' },
]

export const seedWeekReviews = {}
