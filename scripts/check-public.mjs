// Syntax check of the page's ES modules (node --check treats .js as CommonJS here, so each one is parsed as a module).
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'js')
let failed = false
for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
  try {
    new vm.SourceTextModule(fs.readFileSync(path.join(dir, name), 'utf8'), { identifier: name })
  } catch (err) {
    failed = true
    console.error(`${name}: ${err.message}`)
  }
}
process.exit(failed ? 1 : 0)
