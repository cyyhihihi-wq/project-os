/**
 * System tags: fixed, global, immutable - available in all scopes
 */
export const SYSTEM_TAGS = [
  { name: '决策', type: 'system' },
  { name: '数据', type: 'system' },
  { name: '实验', type: 'system' },
  { name: '会议', type: 'system' },
  { name: '外部信息', type: 'system' },
  { name: '思路', type: 'system' },
  { name: '难点', type: 'system' },
]

export const SYSTEM_TAG_NAMES = SYSTEM_TAGS.map(t => t.name)
