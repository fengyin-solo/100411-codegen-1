<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>保障清单（交班结论）</h2>
        <p class="page-desc">与运营概览共用同一份封存结论：每次交班确认生成一个版本，已封存版本不可改写。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="reload">刷新</button>
        <button class="btn primary" type="button" :disabled="!current" @click="exportCurrent">导出当前清单</button>
      </div>
    </header>

    <div v-if="docs.length === 0" class="area-block empty-state">
      还没有封存过交班版本，请先到运营概览的「交班工作台」完成交班确认。
    </div>

    <template v-else>
      <div class="board-toolbar">
        <label>交班版本：</label>
        <select v-model="selectedId" class="btn">
          <option v-for="doc in docs" :key="doc.id" :value="doc.id">
            {{ doc.id }} · {{ doc.sealedAt }} · {{ doc.operator }}
          </option>
        </select>
        <span v-if="current" class="page-desc" style="margin:0">
          {{ current.shiftLabel }} · 规则 v{{ current.ruleVersion }} · 生成机坪待办 {{ current.todosCreated }} 条
        </span>
      </div>

      <div v-if="current" class="conclusion-banner">
        <div>{{ current.conclusion }}</div>
        <div class="meta">
          封存时间 {{ current.sealedAt }} · 交班主管 {{ current.operator }} · 版本 {{ current.id }}
          · 与运营概览展示的是同一条记录
        </div>
      </div>

      <div v-for="area in sealedAreas" :key="area.name" class="area-block">
        <div class="area-head">
          <h3>{{ area.name }}</h3>
          <div class="area-sum">
            <span>登记 <b>{{ area.created }}</b></span>
            <span>待处理 <b :class="{ 'num-pending': area.pending > 0 }">{{ area.pending }}</b></span>
            <span>异常 <b :class="{ 'num-warn': area.abnormal > 0 }">{{ area.abnormal }}</b></span>
          </div>
        </div>
        <table class="data-table">
          <thead>
            <tr><th>业务模块</th><th>登记总量</th><th>待处理</th><th>异常量</th><th>统计口径</th><th>交接说明</th></tr>
          </thead>
          <tbody>
            <tr v-for="cell in area.cells" :key="`${area.name}-${cell.moduleKey}`">
              <td>{{ cell.moduleName }}</td>
              <td>{{ cell.created }}</td>
              <td :class="{ 'num-pending': cell.pending > 0 }">{{ cell.pending }}</td>
              <td :class="{ 'num-warn': cell.abnormal > 0 }">{{ cell.abnormal }}</td>
              <td>
                <span class="cell-tag" :class="cell.locked ? 'locked-tag' : ''">
                  {{ cell.locked ? '已锁快照' : `封存统计 v${cell.ruleVersion}` }}
                </span>
              </td>
              <td>{{ cell.conclusion || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="status-legend">
        <span class="legend-item">清单版本一经封存只读，统计规则换版不会回改历史格子</span>
      </p>
    </template>

    <footer class="page-foot">
      <RouterLink class="link" to="/">返回运营概览</RouterLink>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import { exportHandover, listHandovers } from '@/api/handover'
import type { HandoverDoc, SealedCell } from '@/data/types'

const route = useRoute()
const docs = ref<HandoverDoc[]>([])
const selectedId = ref('')
const errorMessage = ref('')

const current = computed<HandoverDoc | null>(
  () => docs.value.find((doc) => doc.id === selectedId.value) ?? docs.value[0] ?? null,
)

const sealedAreas = computed(() => {
  if (!current.value) {
    return []
  }
  const groups = new Map<string, { name: string; cells: SealedCell[] }>()
  for (const cell of current.value.cells) {
    const group = groups.get(cell.area) ?? { name: cell.areaName, cells: [] }
    group.cells.push(cell)
    groups.set(cell.area, group)
  }
  return [...groups.values()].map((group) => ({
    ...group,
    created: group.cells.reduce((sum, cell) => sum + cell.created, 0),
    pending: group.cells.reduce((sum, cell) => sum + cell.pending, 0),
    abnormal: group.cells.reduce((sum, cell) => sum + cell.abnormal, 0),
  }))
})

function reload() {
  docs.value = listHandovers()
  const queryId = typeof route.query.doc === 'string' ? route.query.doc : ''
  if (queryId && docs.value.some((doc) => doc.id === queryId)) {
    selectedId.value = queryId
  } else if (!selectedId.value || !docs.value.some((doc) => doc.id === selectedId.value)) {
    selectedId.value = docs.value[0]?.id ?? ''
  }
}

function exportCurrent() {
  if (!current.value) {
    errorMessage.value = '没有可导出的交班版本'
    return
  }
  const { filename, content } = exportHandover(current.value)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

watch(() => route.query.doc, reload)

onMounted(reload)
</script>
