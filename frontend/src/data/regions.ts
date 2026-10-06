import { MODULE_BY_KEY } from './modules'
import type { AbnormalRef, EntryRow, RegionCell, RegionModuleStat } from './types'

// 统计规则版本：规则换版时 +1。已封存格子冻结在封存时的版本，重新统计只刷未锁格。
// v1：异常量只统计被标异常（abnormal=true）的记录。
// v2：abnormal=true 之外，凡是状态走到「异常/故障/滞留/中断/超时/取消/报修/停用」等异常态的记录也计入异常量。
export const RULES_VERSION = 2

export const UNKNOWN_REGION = '未归属'

// 区域的固定展示顺序；未归属永远排在最后。
export const REGION_ORDER = ['T1航站楼', 'T2航站楼', 'T3卫星厅', UNKNOWN_REGION]

// 机位编号前缀映射到航站楼，存量记录迁移时按这个表回填。
export const STAND_PREFIX_REGION: Record<string, string> = {
  T1: 'T1航站楼',
  T2: 'T2航站楼',
  T3: 'T3卫星厅',
}

// v2 新增口径：处于这些异常态的记录即使没被动作标成 abnormal，也算异常量。
const ABNORMAL_STATUS_TOKENS = [
  '异常',
  '故障',
  '滞留',
  '中断',
  '超时',
  '已取消',
  '报修',
  '停用',
  '需复查',
  '待整改',
]

// 迁移回填优先级用到的字段分组，按字段名语义归类（模块元数据只登记了中文名）。
const STAND_FIELDS = ['所属机位', '推出机位', '安装位置', '事发位置']
const REGION_FIELDS = ['所属航站楼', '巡查区域']
const FLIGHT_FIELDS = ['匹配航班', '关联航班', '涉及航班', '航班号']
const CODE_FIELDS = [
  '机位编号',
  '廊桥编号',
  '设备编号',
  '转运编号',
  '装卸编号',
  '加油编号',
  '配餐编号',
  '清洁编号',
  '排污编号',
  '除冰编号',
  '牵引编号',
  '人员编号',
  '车辆编号',
  '过站编号',
  '巡查编号',
  '应急编号',
]

export function isAbnormalRow(row: EntryRow): boolean {
  if (row.abnormal) {
    return true
  }
  const status = String(row.status ?? '')
  return ABNORMAL_STATUS_TOKENS.some((token) => status.includes(token))
}

export function regionRank(region: string): number {
  const index = REGION_ORDER.indexOf(region)
  return index < 0 ? REGION_ORDER.indexOf(UNKNOWN_REGION) : index
}

export function sortByRegionOrder(regions: string[]): string[] {
  return [...regions].sort((a, b) => regionRank(a) - regionRank(b))
}

function firstValue(row: EntryRow, fields: string[]): string {
  for (const field of fields) {
    const value = String(row[field] ?? '').trim()
    if (value) {
      return value
    }
  }
  return ''
}

// 从任意文本里认出 T1/T2/T3 或「航站楼/卫星厅」字样；示例数据那种占位文本认不出来。
export function detectRegionToken(text: string): string | null {
  if (/T3|卫星厅/.test(text)) {
    return 'T3卫星厅'
  }
  if (/T1|一号|1号|T2|二号|2号|航站楼/.test(text)) {
    if (/T2|二号|2号/.test(text)) {
      return 'T2航站楼'
    }
    if (/T1|一号|1号/.test(text)) {
      return 'T1航站楼'
    }
  }
  return null
}

// 机位编号形如 T1-101、T2-208、T3-503，取前缀查航站楼。
export function regionOfStandCode(code: string): string | null {
  const matched = code.match(/\b(T[123])\s*[-–—_]?\s*\d+/i)
  if (!matched) {
    return null
  }
  return STAND_PREFIX_REGION[matched[1].toUpperCase()] ?? null
}

type RegionIndex = {
  standToRegion: Map<string, string>
  flightToRegion: Map<string, string>
}

// 先扫机位分配模块建索引：机位编号 → 航站楼，匹配航班 → 航站楼。
// 机位分配是机位归属的权威来源，所以它先于其它模块确定。
function buildIndex(rows: Record<string, EntryRow[]>): RegionIndex {
  const standToRegion = new Map<string, string>()
  const flightToRegion = new Map<string, string>()
  for (const row of rows.stand ?? []) {
    const region = firstValue(row, REGION_FIELDS)
      ? detectRegionToken(firstValue(row, REGION_FIELDS))
      : regionOfStandCode(firstValue(row, ['机位编号']))
    if (!region) {
      continue
    }
    const standCode = firstValue(row, ['机位编号'])
    if (standCode) {
      standToRegion.set(standCode, region)
    }
    const flight = firstValue(row, ['匹配航班'])
    if (flight) {
      flightToRegion.set(flight, region)
    }
  }
  return { standToRegion, flightToRegion }
}

// 单条存量记录的回填优先级：
// 1) 记录自身的机位编号 / 所属机位等，经「机位 → 航站楼」映射直连；
// 2) 记录自带的所属航站楼 / 巡查区域等区域字段；
// 3) 关联航班反查机位分配里该航班停靠的航站楼；
// 4) 都判不出来就兜底进「未归属」，由人工在业务页补录。
export function resolveRegion(
  key: string,
  row: EntryRow,
  index: RegionIndex,
): string {
  // 机位分配自身：所属航站楼字段优先，其次机位编号前缀。
  if (key === 'stand') {
    const own = detectRegionToken(firstValue(row, REGION_FIELDS))
    if (own) {
      return own
    }
    const byCode = regionOfStandCode(firstValue(row, ['机位编号']))
    if (byCode) {
      return byCode
    }
    return UNKNOWN_REGION
  }

  const standText = firstValue(row, STAND_FIELDS)
  if (standText) {
    for (const code of standText.match(/T[123]\s*[-–—_]?\s*\d+/gi) ?? []) {
      const region = regionOfStandCode(code)
      if (region) {
        return region
      }
    }
    const direct = detectRegionToken(standText)
    if (direct) {
      return direct
    }
  }

  const regionText = firstValue(row, REGION_FIELDS)
  if (regionText) {
    const direct = detectRegionToken(regionText)
    if (direct) {
      return direct
    }
  }

  const flight = firstValue(row, FLIGHT_FIELDS)
  if (flight) {
    const viaFlight = index.flightToRegion.get(flight)
    if (viaFlight) {
      return viaFlight
    }
  }

  // 最后兜底：其余文本字段里出现明确的 T1/T2/T3/卫星厅 字样也认（如「T2航站楼乙班」班组）。
  for (const field of Object.keys(row)) {
    if (field === 'id' || field === 'status' || field === '归属区域') {
      continue
    }
    const token = detectRegionToken(String(row[field] ?? ''))
    if (token) {
      return token
    }
  }

  return UNKNOWN_REGION
}

// 迁移入口：给所有缺「归属区域」的存量记录回填，只补空值，已有归属不改写。
export function backfillRegions(
  rows: Record<string, EntryRow[]>,
): Record<string, EntryRow[]> {
  const index = buildIndex(rows)
  const next: Record<string, EntryRow[]> = {}
  for (const [key, list] of Object.entries(rows)) {
    next[key] = list.map((row) => {
      const existed = String(row['归属区域'] ?? '').trim()
      if (existed) {
        return row
      }
      return { ...row, 归属区域: resolveRegion(key, row, index) }
    })
  }
  return next
}

function rowCode(row: EntryRow): string {
  return firstValue(row, CODE_FIELDS) || String(row.id)
}

function emptyCell(region: string, locked: boolean, rulesVersion: number): RegionCell {
  return {
    region,
    rulesVersion,
    locked,
    modules: [],
    created: 0,
    pending: 0,
    abnormal: 0,
    abnormalRefs: [],
  }
}

// 汇总当前全部业务数据，按区域生成「实时」格子（未锁、规则版本为当前版本）。
export function computeRegionCells(
  rows: Record<string, EntryRow[]>,
): RegionCell[] {
  const bucket = new Map<string, RegionCell>()
  for (const meta of MODULE_BY_KEY.values()) {
    const list = rows[meta.key] ?? []
    const perRegion = new Map<
      string,
      { created: number; pending: number; abnormal: number; refs: AbnormalRef[] }
    >()
    for (const row of list) {
      const region = String(row['归属区域'] ?? UNKNOWN_REGION) || UNKNOWN_REGION
      const stat = perRegion.get(region) ?? {
        created: 0,
        pending: 0,
        abnormal: 0,
        refs: [],
      }
      stat.created += 1
      if (row.pending) {
        stat.pending += 1
      }
      const abnormal = isAbnormalRow(row)
      if (abnormal) {
        stat.abnormal += 1
        stat.refs.push({
          moduleKey: meta.key,
          moduleName: meta.name,
          id: Number(row.id),
          code: rowCode(row),
          status: String(row.status ?? ''),
        })
      }
      perRegion.set(region, stat)
    }
    for (const [region, stat] of perRegion) {
      const cell = bucket.get(region) ?? emptyCell(region, false, RULES_VERSION)
      const moduleStat: RegionModuleStat = {
        key: meta.key,
        name: meta.name,
        created: stat.created,
        pending: stat.pending,
        abnormal: stat.abnormal,
      }
      cell.modules.push(moduleStat)
      cell.created += stat.created
      cell.pending += stat.pending
      cell.abnormal += stat.abnormal
      cell.abnormalRefs.push(...stat.refs)
      bucket.set(region, cell)
    }
  }
  return sortByRegionOrder([...bucket.keys()]).map((region) => bucket.get(region)!)
}
