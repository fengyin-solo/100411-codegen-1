import { SEED_ROWS } from './seed'
import { enrichRows } from './areas'
import type { BoardState, EntryRow, HandoverDoc } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'airport-ground-handling:entries'
// 当前存储结构版本。1 = 旧版只存 Record<模块, 记录[]>；2 = 记录 + 交班台账分槽存放。
const SCHEMA_VERSION = 2

export const BOARD_KEY = 'airport-ground-handling:board'
export const HANDOVERS_KEY = 'airport-ground-handling:handovers'
const META_KEY = 'airport-ground-handling:meta'

type PersistShape = {
  schemaVersion: number
  entries: Record<string, EntryRow[]>
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function freshSeed(): Record<string, EntryRow[]> {
  // 播种时同样过一遍归属回填：没有「所属航站楼」列的模块也能被态势视图正确归集。
  const seeded = clone(SEED_ROWS)
  for (const key of Object.keys(seeded)) {
    seeded[key] = enrichRows(key, seeded[key])
  }
  return seeded
}

/**
 * 存量结构迁移：
 * - 旧版读到的是扁平的 Record<模块, 记录[]>，先整体搬进 entries 槽；
 * - 每条记录按 P1 机位直查 → P2 航班反查 → P3 区域线索 → P4 兜底 补航站楼归属；
 * - 缺机位归属的老样例数据（如所属机位写着「样例」）不会猜机位，落到低优先级回填。
 */
function migrateLegacy(raw: unknown): PersistShape {
  // 旧版扁平结构：与新种子合并（保留存量数据在前），再统一补航站楼归属。
  const entries = { ...freshSeed(), ...((raw && typeof raw === 'object'
    ? clone(raw as Record<string, EntryRow[]>)
    : {}) as Record<string, EntryRow[]>) }
  for (const key of Object.keys(entries)) {
    if (Array.isArray(entries[key])) {
      entries[key] = enrichRows(key, entries[key])
    }
  }
  return { schemaVersion: SCHEMA_VERSION, entries }
}

function readPersisted(): PersistShape {
  const fallback = (): PersistShape => ({ schemaVersion: SCHEMA_VERSION, entries: freshSeed() })
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback()
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const seeded = fallback()
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
    return seeded
  }
  try {
    const parsed = JSON.parse(raw) as PersistShape | Record<string, EntryRow[]>
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed as PersistShape).schemaVersion === SCHEMA_VERSION &&
      (parsed as PersistShape).entries
    ) {
      // 新版本里若新增了模块，播种补齐；缺归属的补算一遍。
      const shape = parsed as PersistShape
      const merged = { ...freshSeed(), ...shape.entries }
      for (const key of Object.keys(merged)) {
        merged[key] = enrichRows(key, merged[key])
      }
      return { schemaVersion: SCHEMA_VERSION, entries: merged }
    }
    // 旧版扁平结构，迁移并回写。
    const migrated = migrateLegacy(parsed)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated))
    window.localStorage.setItem(
      META_KEY,
      JSON.stringify({ schemaVersion: SCHEMA_VERSION, migratedAt: new Date().toISOString() }),
    )
    return migrated
  } catch {
    const seeded = fallback()
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
    return seeded
  }
}

let cache: PersistShape | null = null

function persisted(): PersistShape {
  if (cache === null) {
    cache = readPersisted()
  }
  return cache
}

export function allRows(): Record<string, EntryRow[]> {
  return persisted().entries
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const current = persisted()
  const next: PersistShape = {
    ...current,
    entries: { ...current.entries, [key]: enrichRows(key, rows) },
  }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = enrichRows(key, clone(SEED_ROWS[key] ?? []))
  saveRows(key, rows)
  return rows
}

// ---- 交班台账（工作台草稿 + 已封存版本） ------------------------------

export function loadBoard(): BoardState | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null
  }
  const raw = window.localStorage.getItem(BOARD_KEY)
  if (!raw) {
    return null
  }
  try {
    return JSON.parse(raw) as BoardState
  } catch {
    return null
  }
}

export function saveBoard(board: BoardState): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  window.localStorage.setItem(BOARD_KEY, JSON.stringify(board))
}

export function loadHandovers(): HandoverDoc[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  const raw = window.localStorage.getItem(HANDOVERS_KEY)
  if (!raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as HandoverDoc[]) : []
  } catch {
    return []
  }
}

/** 并发封存只保留首个版本：追加在同一写动作里完成，后到者先由服务层 CAS 挡住。 */
export function appendHandover(doc: HandoverDoc): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  const docs = loadHandovers()
  docs.unshift(doc)
  window.localStorage.setItem(HANDOVERS_KEY, JSON.stringify(docs))
}

export function storageKey(): string {
  return STORAGE_KEY
}

export function storageKeys(): { entries: string; board: string; handovers: string } {
  return { entries: STORAGE_KEY, board: BOARD_KEY, handovers: HANDOVERS_KEY }
}
