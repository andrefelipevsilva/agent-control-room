#!/usr/bin/env node
// Rebuilds vendor/ from the official Habblaud and Agent Flow repositories, at the versions pinned below.
//
//   node scripts/vendor.mjs
//
// Needs git, npm and network. Each project is cloned into a temporary folder, built with its own build script and
// copied UNMODIFIED into vendor/<name>/, with its license and the licenses of the packages bundled into the build.
// Anyone can run this to check that vendor/ is exactly what upstream builds.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const VENDOR = path.join(ROOT, 'vendor')
const IS_WIN = process.platform === 'win32'

const PROJECTS = [
  {
    name: 'habblaud',
    title: 'Habblaud',
    repo: 'https://github.com/marmottajr/habblaud.git',
    ref: 'v1.0.3',
    license: 'MIT',
    author: 'Márcio Junior',
    install: [['npm', ['ci', '--no-audit', '--no-fund']]],
    build: [['npm', ['run', 'build']]],
    // Habblaud finds its root by walking up to package.json and serves dist/client from there.
    copy: ['package.json', 'LICENSE', 'dist'],
    // Only the browser bundle carries third-party code: the server is built with `packages: 'external'`, and its
    // optional packages (node-pty, xterm headless) are not shipped here.
    sources: ['client/src', 'shared'],
    nodeModules: ['node_modules'],
  },
  {
    name: 'agent-flow',
    title: 'Agent Flow',
    repo: 'https://github.com/patoles/agent-flow.git',
    ref: 'v0.9.2',
    license: 'Apache-2.0',
    author: 'Simon Patole',
    // Recent pnpm only runs the install scripts it was told to; esbuild needs its own to fetch its binary.
    prepare: (dir) => fs.appendFileSync(path.join(dir, 'pnpm-workspace.yaml'), '\nallowBuilds:\n  esbuild: true\n  sharp: false\n'),
    install: [['npx', ['-y', 'pnpm@12.14.0', 'install', '--frozen-lockfile']]],
    build: [['npx', ['-y', 'pnpm@12.14.0', 'run', 'build:app']]],
    // app.js serves the UI from the webview/ folder next to it.
    copy: [['app/dist/app.js', 'app.js'], ['app/dist/webview', 'webview'], 'LICENSE', 'TRADEMARK.md'],
    // app.js is CommonJS; without this, the room's own "type": "module" would make Node load it as ESM.
    extraFiles: { 'package.json': '{\n  "type": "commonjs"\n}\n' },
    // What app/build.js bundles: the app server (with the relay from scripts/ and extension/src) and the UI from
    // web/app-entry.tsx (plus its stylesheet). The rest of web/app is the Next.js dev site, not part of this build.
    sources: ['app/src', 'scripts', 'extension/src', 'web/components', 'web/hooks', 'web/lib', 'web/app-entry.tsx', 'web/app/globals.css'],
    nodeModules: ['node_modules', 'web/node_modules', 'extension/node_modules'],
  },
]

// ─── Helpers ────────────────────────────────────────────────────────────────

function sh(cmd, args, cwd) {
  console.log(`  $ ${cmd} ${args.join(' ')}`)
  // npm/npx are .cmd files on Windows and need a shell; the arguments here are fixed words only.
  const res = IS_WIN ? spawnSync(`${cmd} ${args.join(' ')}`, { cwd, stdio: 'inherit', shell: true }) : spawnSync(cmd, args, { cwd, stdio: 'inherit' })
  if (res.status !== 0) throw new Error(`failed: ${cmd} ${args.join(' ')}`)
}

const git = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8' }).stdout.trim()

/** Package names imported by the source files (bare imports and CSS @import), minus Node built-ins. */
function importedPackages(dir, sources) {
  const found = new Set()
  const visit = (p) => {
    if (!fs.existsSync(p)) return
    const st = fs.statSync(p)
    if (st.isDirectory()) return fs.readdirSync(p).forEach((f) => f !== 'node_modules' && visit(path.join(p, f)))
    if (!/\.(m?[jt]sx?|css)$/.test(p) || /\.test\.|\.d\.ts$/.test(p)) return
    const text = fs.readFileSync(p, 'utf8')
    for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+|@import\s+)['"]([^'".][^'"]*)['"]/g)) {
      const spec = m[1]
      if (spec.startsWith('node:') || spec.startsWith('/')) continue
      found.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0])
    }
  }
  sources.forEach((s) => visit(path.join(dir, s)))
  return [...found].sort()
}

/** Folder of `name` as Node would resolve it from `fromDir` (walking up through node_modules), or null. */
function resolvePackage(fromDir, name) {
  for (let d = fromDir; ; d = path.dirname(d)) {
    const p = path.join(d, 'node_modules', name)
    if (fs.existsSync(path.join(p, 'package.json'))) return fs.realpathSync(p)
    if (path.dirname(d) === d) return null
  }
}

/**
 * License text of each package that ends up in the build: the ones the sources import, plus their runtime
 * dependencies, which the bundler pulls in too. Built-ins and aliases are skipped because they are not installed.
 */
function thirdPartyNotices(dir, project) {
  const queue = importedPackages(dir, project.sources).flatMap((pkg) => {
    const hit = project.nodeModules.map((nm) => path.join(dir, nm, pkg)).find((p) => fs.existsSync(path.join(p, 'package.json')))
    return hit ? [fs.realpathSync(hit)] : []
  })
  const seen = new Set()
  const sections = []
  while (queue.length) {
    const real = queue.shift()
    if (seen.has(real)) continue
    seen.add(real)
    const meta = JSON.parse(fs.readFileSync(path.join(real, 'package.json'), 'utf8'))
    for (const dep of Object.keys(meta.dependencies ?? {})) {
      const found = resolvePackage(real, dep)
      if (found) queue.push(found)
    }
    const licenseFile = fs.readdirSync(real).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f))
    const text = licenseFile ? fs.readFileSync(path.join(real, licenseFile), 'utf8').trim() : '(no license file in the package)'
    const license = typeof meta.license === 'string' ? meta.license : meta.license?.type ?? 'see text'
    sections.push(`## ${meta.name}@${meta.version} (${license})\n\n\`\`\`\n${text}\n\`\`\``)
  }
  return `# Third-party notices: ${project.title}\n\nPackages bundled into the ${project.title} build in this folder.\n\n${sections.sort().join('\n\n')}\n`
}

function copyInto(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.cpSync(src, dest, { recursive: true })
}

// ─── Main ───────────────────────────────────────────────────────────────────

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-control-room-vendor-'))
const built = []

for (const project of PROJECTS) {
  console.log(`\n[${project.name}] ${project.repo} @ ${project.ref}`)
  const dir = path.join(work, project.name)
  sh('git', ['clone', '--quiet', '--depth', '1', '--branch', project.ref, project.repo, dir], work)
  const commit = git(['rev-parse', 'HEAD'], dir)
  project.prepare?.(dir)
  for (const [cmd, args] of [...project.install, ...project.build]) sh(cmd, args, dir)

  const out = path.join(VENDOR, project.name)
  fs.rmSync(out, { recursive: true, force: true })
  for (const entry of project.copy) {
    const [from, to] = Array.isArray(entry) ? entry : [entry, entry]
    copyInto(path.join(dir, from), path.join(out, to))
  }
  for (const [file, text] of Object.entries(project.extraFiles ?? {})) fs.writeFileSync(path.join(out, file), text)
  fs.writeFileSync(path.join(out, 'THIRD_PARTY_NOTICES.md'), thirdPartyNotices(dir, project))
  built.push({ ...project, commit })
}

const rows = built
  .map((p) => `| ${p.title} | [${p.ref}](${p.repo.replace(/\.git$/, '')}/tree/${p.commit}) | \`${p.commit.slice(0, 12)}\` | ${p.author} | ${p.license} |`)
  .join('\n')

fs.writeFileSync(
  path.join(VENDOR, 'README.md'),
  `# vendor/

Ready-to-run builds of the two projects Agent Control Room runs, so the room works right after cloning, with only
Node.js installed. Both are **unmodified**: built from the official repositories, at the versions below, with their
own build scripts.

| Project | Version | Commit | Author | License |
|---|---|---|---|---|
${rows}

Each folder keeps the project's \`LICENSE\` and a \`THIRD_PARTY_NOTICES.md\` with the licenses of the packages bundled
into its build. "Agent Flow" is a trademark of Simon Patole (see \`agent-flow/TRADEMARK.md\`); it is used here only to
name the software as distributed by its author.

To rebuild this folder from upstream (needs git, npm and network):

\`\`\`bash
node scripts/vendor.mjs
\`\`\`

To move to a newer version, change \`ref\` in \`scripts/vendor.mjs\`, run it, test, and commit the result.
`,
)

// Windows can hold a file in node_modules for a moment; a leftover temp folder is harmless.
try {
  fs.rmSync(work, { recursive: true, force: true })
} catch {
  console.log(`(could not remove the temporary folder ${work})`)
}
console.log(`\nDone: ${built.map((p) => `${p.name} ${p.ref}`).join(', ')} in vendor/`)
