/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

// 一个业务模块在某个区域（航站楼）格子里的汇总数。
export type RegionModuleStat = {
  key: string
  name: string
  created: number
  pending: number
  abnormal: number
}

// 异常明细：格子结论与保障清单共用，指向具体业务记录。
export type AbnormalRef = {
  moduleKey: string
  moduleName: string
  id: number
  code: string
  status: string
}

// 航站楼态势「交接格」：未封存时按当前统计规则实时计算；封存后整格冻结为快照。
export type RegionCell = {
  region: string
  rulesVersion: number
  locked: boolean
  modules: RegionModuleStat[]
  created: number
  pending: number
  abnormal: number
  abnormalRefs: AbnormalRef[]
}

// 一次交班封存下来的整盘结论。
export type HandoverSnapshot = {
  shiftKey: string
  shiftLabel: string
  sealedAt: string
  sealedBy: string
  rulesVersion: number
  order: string[]
  cells: RegionCell[]
}

export type HandoverHistoryItem = {
  shiftKey: string
  shiftLabel: string
  sealedAt: string
  sealedBy: string
}

export type SessionContext = {
  operator: string
  shiftLabel: string
}

export type TerminalSituation = {
  shiftKey: string
  shiftLabel: string
  sealed: boolean
  viewingHistory: boolean
  sealedAt: string | null
  sealedBy: string | null
  rulesVersion: number
  order: string[]
  cells: RegionCell[]
  history: HandoverHistoryItem[]
}
