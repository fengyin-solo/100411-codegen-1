// 冒烟测试运行器：用项目自带的 esbuild 打包数据层后直接在 Node 里跑，无需浏览器。
// 用法：node scripts/run-smoke.mjs
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'

const outfile = join(tmpdir(), `ghh-smoke-${Date.now()}.mjs`)
await build({
  entryPoints: ['scripts/smoke.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  logLevel: 'warning',
  alias: { '@': join(process.cwd(), 'src') },
})
try {
  await import(pathToFileURL(outfile).href)
} finally {
  rmSync(outfile, { force: true })
}
