import { SEED_ROWS } from './seed'
import { backfillRegions } from './regions'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'airport-ground-handling:entries'
// 交班封存、格子排序等配套数据，跟业务登记分桶存放。
const STORE_PREFIX = 'airport-ground-handling:'

// 业务数据结构版本：存量记录迁移按它判断，只升不降。
// v2：为全部记录补「归属区域」（缺机位归属的走回填优先级）。
const SCHEMA_VERSION = 2
const META_KEY = 'airport-ground-handling:meta'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

type StoredMeta = { schemaVersion: number }

function readMeta(): StoredMeta {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { schemaVersion: SCHEMA_VERSION }
  }
  try {
    const raw = window.localStorage.getItem(META_KEY)
    if (raw) {
      const meta = JSON.parse(raw) as Partial<StoredMeta>
      return { schemaVersion: Number(meta.schemaVersion) || 0 }
    }
  } catch {
    // 元数据损坏按未初始化处理，下面的迁移会重建。
  }
  return { schemaVersion: 0 }
}

function writeMeta(meta: StoredMeta): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(META_KEY, JSON.stringify(meta))
  }
}

// 迁移只补空值、不改已有归属；每次结构版本升级在这里续新的一段。
function migrate(
  rows: Record<string, EntryRow[]>,
  fromVersion: number,
): Record<string, EntryRow[]> {
  if (fromVersion < 2) {
    rows = backfillRegions(rows)
  }
  return rows
}

function persist(rows: Record<string, EntryRow[]>): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows))
  }
  writeMeta({ schemaVersion: SCHEMA_VERSION })
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = migrate(clone(SEED_ROWS), 0)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    persist(fallback)
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    const meta = readMeta()
    // 示例数据新增的模块也要并进老存档（...fallback 在前，老数据覆盖）。
    const merged: Record<string, EntryRow[]> = { ...fallback, ...parsed }
    if (meta.schemaVersion < SCHEMA_VERSION) {
      const migrated = migrate(merged, meta.schemaVersion)
      persist(migrated)
      return migrated
    }
    return merged
  } catch {
    persist(fallback)
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  persist(next)
}

export function resetRows(key: string): EntryRow[] {
  // 重置回示例数据时同样走一遍迁移，保证归属区域齐全。
  const rows = backfillRegions({ [key]: clone(SEED_ROWS[key] ?? []) })[key]
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

// 配套 KV：交班快照、排序偏好等用它存。调用方自己负责「读后写」的并发判定。
export function readStore<T>(key: string): T | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null
  }
  const raw = window.localStorage.getItem(`${STORE_PREFIX}${key}`)
  if (!raw) {
    return null
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function writeStore(key: string, value: unknown): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  window.localStorage.setItem(`${STORE_PREFIX}${key}`, JSON.stringify(value))
}
