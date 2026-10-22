// Pixel-art capybaras for the office and the avatars around the app, each in its own outfit. Fur shade, outfit, colors
// and what it wears on its head come from the agent's Habblaud seed (the outfit color from the parts chosen in
// Habblaud's character editor, when there are any), so each agent looks the same everywhere and stays the same across
// restarts. A sprite is a base drawing plus layers (outfit, hat, arms) of one-letter colors, drawn as crisp rects.

import { rng, pick } from './util.js'

const FUR = ['#b5835a', '#a87650', '#c08f63', '#9d6b46', '#b98a5e', '#c99a6b']
const TOPS = ['#4a6fa5', '#7b5ea7', '#3f8f7a', '#a5484f', '#4f7f4a', '#a8577f', '#5c6b7a', '#2f4a7c', '#b0893a']
const ACCENTS = ['#f3efe4', '#e26d6d', '#6fa8e8', '#e7c45a', '#d48fd8', '#7fd1b9', '#f29fb8']
const OUTFITS = ['hoodie', 'tee', 'suit', 'overalls', 'stripes', 'scarf', 'labcoat', 'jacket']
const HATS = ['none', 'beanie', 'cap', 'bow', 'orange', 'headphones', 'duck', 'flower']
const HEX = /^#[0-9a-f]{6}$/i

/** Mixes a #rrggbb color toward black (amount < 0) or white (amount > 0). */
function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16)
  const to = amount < 0 ? 0 : 255
  const k = Math.abs(amount)
  const ch = (v) => Math.round(v + (to - v) * k).toString(16).padStart(2, '0')
  return `#${ch(n >> 16)}${ch((n >> 8) & 255)}${ch(n & 255)}`
}

const looks = new Map()

/** The agent's look: fur, outfit and its colors, and what it wears on its head. */
export function appearance(agent) {
  const key = `${agent.seed}|${agent.look}|${JSON.stringify(agent.parts ?? null)}`
  let ap = looks.get(key)
  if (ap) return ap
  const r = rng(agent.seed ?? 1)
  const fur = pick(r, FUR)
  const top = HEX.test(agent.parts?.top ?? '') ? agent.parts.top : pick(r, TOPS)
  ap = { key, fur, top, accent: pick(r, ACCENTS), outfit: pick(r, OUTFITS), hat: pick(r, HATS) }
  looks.set(key, ap)
  return ap
}

/** One-letter colors used by the sprites. */
function palette(ap) {
  const body = ap.outfit === 'overalls' ? ap.accent : ap.outfit === 'labcoat' ? '#e9ecef' : ap.top
  return {
    o: '#2e1d12', // outline
    f: ap.fur,
    h: shade(ap.fur, 0.12),
    d: shade(ap.fur, -0.32),
    s: shade(ap.fur, -0.14), // snout
    n: '#1e130c', // eyes, nostrils
    p: '#e58c80', // blush
    B: body,
    D: shade(body, -0.3),
    t: ap.top,
    L: shade(ap.top, 0.4),
    a: ap.accent,
    A: shade(ap.accent, -0.28),
    k: '#eef0f2',
    C: '#c3c8ce',
    y: '#f7a531',
    Y: '#ffd58a',
    g: '#5fae4a',
    m: '#e6e8eb',
    u: '#f5d84a', // duck
    q: '#f08a2b', // its beak
    G: ap.outfit === 'overalls' ? ap.top : ap.outfit === 'suit' ? shade(ap.top, -0.3) : shade(ap.fur, -0.1), // legs
  }
}

// ─── Drawings ───────────────────────────────────────────────────────────────
// '.' leaves what is under it, any other letter paints a pixel (see palette()).

/**
 * The head from the front, 10×12, long like a capybara's. The hats below start one row above the head and are drawn
 * as if the head sat at (3, 1) of a 16×16 grid.
 */
const HEAD = [
  '.oo....oo.',
  'oddooooddo',
  'offhhhhffo',
  'offffffffo',
  'ofnffffnfo',
  'ofnffffnfo',
  'offffffffo',
  'opsssssspo',
  'ossnssnsso',
  'osssssssso',
  'osssddssso',
  '.oooooooo.',
]

const FRONT_HAT = {
  beanie: ['.......AA.......', '....oooooooo....', '...oaaaaaaaao...', '...oaaaaaaaao...', '...oAAAAAAAAo...'],
  cap: ['.....oooooo.....', '....oaaaaaao....', '...oaaaaaaaao...', '...oaaaaaaaao...', '..oAAAAAAAAAAo..'],
  bow: ['................', '.........aa.aa..', '.........aaAaa..', '.........aa.aa..'],
  orange: ['.......og.......', '......oyyo......', '.....oyYyyo.....', '.....oyyyyo.....', '......oooo......'],
  headphones: ['................', '..oooooooooooo..', '.oaaaaaaaaaaaao.', '.oa..........ao.', '.oa..........ao.', 'oAAo........oAAo', 'oAAo........oAAo', 'oAAo........oAAo', '.oo..........oo.'],
  duck: ['.......ooo......', '......ouunq.....', '.....ouuuuo.....', '.....ouuuuo.....', '......oooo......'],
  flower: ['................', '....a...........', '...aYa..........', '....a...........'],
}

const BUST = [
  '................',
  ...HEAD.map((r) => `...${r}...`),
  '...oBBBBBBBBo...',
  '..oBBBBBBBBBBo..',
  '.oBBBBBBBBBBBBo.',
]
// Rows 13–15 of the bust.
const BUST_OUTFIT = {
  hoodie: ['...oDDDDDDDDo...', '..oBBBkBBkBBBo..', '.oBBBBkBBkBBBBo.'],
  tee: ['...oBBffffBBo...'],
  suit: ['...oDkkaakkDo...', '..oBBDkaakDBBo..', '.oBBBBDaaDBBBBo.'],
  overalls: ['...oBtBBBBtBo...', '..oBBttttttBBo..', '.oBBBtLttLtBBBo.'],
  stripes: ['...oaaaaaaaao...', '................', '.oaaaaaaaaaaaao.'],
  scarf: ['...oaaaaaaaao...', '..oBBBBBBaABBo..', '.oBBBBBBBaABBBo.'],
  labcoat: ['...oCttttttCo...', '..oBBCttttCBBo..', '.oBBBBCttCBBaBo.'],
  jacket: ['...oDDDDDDDDo...', '..oaBBBLLBBBao..', '.oaBBBBLLBBBBao.'],
}

/** Standing, from the front, 14 wide: the head sits at (2, 3). */
const STAND = [
  '..............',
  '..............',
  '..............',
  ...HEAD.map((r) => `..${r}..`),
  '..oBBBBBBBBo..',
  '.oBBBBBBBBBBo.',
  'oBoBBBBBBBBoBo',
  'oBoBBBBBBBBoBo',
  'oBoBBBBBBBBoBo',
  'odoBBBBBBBBodo',
  '.ooBBBBBBBBoo.',
  '..oBBBBBBBBo..',
  '..oooooooooo..',
  '...oGGooGGo...',
  '..odddoodddo..',
  '..oooooooooo..',
]
// Rows 15–22 of the standing body.
const STAND_OUTFIT = {
  hoodie: ['..oDDDDDDDDo..', '.oBBBkBBkBBBo.', 'oBoBBkBBkBBoBo', '..............', '..............', 'odoBDDDDDDBodo', '.ooBDDDDDDBoo.'],
  tee: ['..oBBffffBBo..'],
  suit: ['..oDkkaakkDo..', '.oBBDkaakDBBo.', 'oBoBBDaaDBBoBo', 'oBoBBBDDBBBoBo'],
  overalls: ['..oBtBBBBtBo..', '.oBBtBBBBtBBo.', 'oBoBttttttBoBo', 'oBoBtLttLtBoBo', 'oBoBttttttBoBo', 'odottttttttodo', '.oottttttttoo.', '..otttttttto..'],
  stripes: ['..............', '.oaaaaaaaaaao.', '..............', 'oBoaaaaaaaaoBo', '..............', 'odoaaaaaaaaodo', '..............', '..oaaaaaaaao..'],
  scarf: ['..oaaaaaaaao..', '.oBBBBBaABBBo.', 'oBoBBBBaABBoBo'],
  labcoat: ['..oCttttttCo..', '.oBBCttttCBBo.', 'oBoBBCttCBBoBo', 'oBoBBBCCBaBoBo', 'oBoBBBCCBBBoBo', 'odoBBBCCBBBodo', '.ooBBBCCBBBoo.', '..oBBBCCBBBo..'],
  jacket: ['..oDDDDDDDDo..', '.oBBBBLLBBBBo.', 'oBoBBBLLBBBoBo', 'oaoBBBLLBBBoao', 'oaoBBBLLBBBoao', 'odoBBBLLBBBodo', '.ooBBBLLBBBoo.', '..oBBBLLBBBo..'],
}
const CUP = ['.C.C', 'C.C.', 'oooo', 'ommo', 'ommo', 'oooo']

/** Seated at a desk, from behind, 18 wide: rows 0–3 hold a raised paw, the head starts at row 4. */
const SEAT = [
  '..................',
  '..................',
  '..................',
  '..................',
  '....oo......oo....',
  '...oddooooooddo...',
  '...offhhhhhhffo...',
  '...offffffffffo...',
  '...offffffffffo...',
  '...offffffffffo...',
  '...offffffffffo...',
  '...offffffffffo...',
  '...oddffffffddo...',
  '....oddddddddo....',
  '..oBBBBBBBBBBBBo..',
  '.oBBBBBBBBBBBBBBo.',
  'oBBBBBBBBBBBBBBBBo',
  'oBBBBBBBBBBBBBBBBo',
]
// From row 13 of the seated grid (the chair's back hides the body below row 16).
const SEAT_OUTFIT = {
  hoodie: ['..................', '..oBDDDDDDDDDDBo..', '.oBBBDDDDDDDDBBBo.', 'oBBBBBDDDDDDBBBBBo'],
  overalls: ['..................', '..oBBtBBBBBBtBBo..', '.oBBBBtBBBBtBBBBo.', 'oBBBBBBtBBtBBBBBBo', 'oBBBBBBBttBBBBBBBo'],
  stripes: ['..................', '..................', '.oaaaaaaaaaaaaaao.', '..................', 'oaaaaaaaaaaaaaaaao'],
  scarf: ['....oaaaaaaaao....', '..oBBBBBBBaABBBo..', '.oBBBBBBBBaABBBBo.'],
  suit: ['..................', '..oBBDDDDDDDDBBo..', '.oBBBBBBDDBBBBBBo.', 'oBBBBBBBDDBBBBBBBo'],
  jacket: ['..................', '..oBBDDDDDDDDBBo..'],
  labcoat: ['..................', '..................', '.oBBBBBBCCBBBBBBo.', 'oBBBBBBBCCBBBBBBBo'],
}
// From row 1 of the seated grid.
const BACK_HAT = {
  beanie: ['..................', '..................', '........AA........', '....oooooooooo....', '...oaaaaaaaaaao...', '...oaaaaaaaaaao...', '...oaaaaaaaaaao...', '...oAAAAAAAAAAo...'],
  cap: ['..................', '..................', '......AAAAAA......', '.....oaaaaaao.....', '....oaaaaaaaao....', '...oaaaaffaaaao...', '...oAAAAffAAAAo...'],
  bow: ['..................', '..................', '...........aa.aa..', '...........aaAaa..', '...........aa.aa..'],
  orange: ['........og........', '.......oyyo.......', '......oyYyyo......', '......oyyyyo......', '.......oooo.......'],
  headphones: ['..................', '..................', '..................', '...oooooooooooo...', '..oaaaaaaaaaaaao..', '..oa..........ao..', '..oa..........ao..', '...AA........AA...', '...AA........AA...'],
  flower: ['..................', '..................', '....a.............', '...aYa............', '....a.............'],
  duck: ['..................', '........ooo.......', '.......ouuuo......', '......ouuuuuo.....', '......ouuuuuo.....', '.......ooooo......'],
}
// Paws on the desk's edge from row 8, sleeves in shadow; the raised right paw reaches row 0.
const ARM_LEFT = ['.oo.', 'offo', 'oDDo', 'oDDo', 'oDDo', 'oDDo', 'oDDB', 'oDDB']
const ARM_RIGHT = ['.oo.', 'offo', 'oDDo', 'oDDo', 'oDDo', 'oDDo', 'BDDo', 'BDDo']
const ARM_RAISED = ['.oo.', 'offo', ...Array(12).fill('oDDo'), 'BDDo', 'BDDo']

// ─── Drawing ────────────────────────────────────────────────────────────────

/** Paints layers ({ x, y, rows }) onto one pixel map, later layers on top. */
function compose(layers) {
  const px = new Map()
  for (const { x = 0, y = 0, rows } of layers) {
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) if (row[i] !== '.') px.set(`${x + i},${y + j}`, row[i])
    })
  }
  return px
}

/**
 * Pixel map → one path per color (runs of a row merged), each pixel `size` wide, the grid's (0, 0) at (ox, oy).
 * A single path per color keeps zoomed sprites free of hairline seams between rows.
 */
function toPaths(px, pal, ox, oy, size) {
  const byColor = new Map()
  for (const [k, c] of px) {
    const [x, y] = k.split(',').map(Number)
    if (!byColor.has(c)) byColor.set(c, new Map())
    const rows = byColor.get(c)
    if (!rows.has(y)) rows.set(y, [])
    rows.get(y).push(x)
  }
  let s = ''
  for (const [c, rows] of byColor) {
    let d = ''
    for (const [y, xs] of rows) {
      xs.sort((p, q) => p - q)
      for (let i = 0; i < xs.length; ) {
        let j = i
        while (j + 1 < xs.length && xs[j + 1] === xs[j] + 1) j++
        d += `M${ox + xs[i] * size} ${oy + y * size}h${(j - i + 1) * size}v${size}h${-(j - i + 1) * size}z`
        i = j + 1
      }
    }
    s += `<path d="${d}" fill="${pal[c]}"/>`
  }
  return s
}

const drawn = new Map()
function memo(key, make) {
  let s = drawn.get(key)
  if (s == null) {
    s = make()
    drawn.set(key, s)
  }
  return s
}

const hatLayer = (hat, x, y) => (FRONT_HAT[hat] ? [{ x, y, rows: FRONT_HAT[hat] }] : [])

/** Head-and-shoulders avatar, 16×16 pixels. */
export function bust(ap) {
  const body = memo(`bust|${ap.key}`, () => {
    const layers = [{ rows: BUST }]
    if (BUST_OUTFIT[ap.outfit]) layers.push({ y: 13, rows: BUST_OUTFIT[ap.outfit] })
    layers.push(...hatLayer(ap.hat, 0, 0))
    return toPaths(compose(layers), palette(ap), 0, 0, 1)
  })
  return `<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">${body}</svg>`
}

/**
 * Agent seated at a desk, seen from behind, in the desk's own coordinates (the desk is 76 wide, the chair sits under
 * it at y≈31–53). pose: 'type' (paws on the keyboard) or 'raise' (one paw up: needs you).
 */
export function seated(ap, pose = 'type') {
  return memo(`seat|${pose}|${ap.key}`, () => {
    const layers = [{ rows: SEAT }]
    if (SEAT_OUTFIT[ap.outfit]) layers.push({ y: 13, rows: SEAT_OUTFIT[ap.outfit] })
    if (BACK_HAT[ap.hat]) layers.push({ y: 1, rows: BACK_HAT[ap.hat] })
    layers.push({ x: 0, y: 8, rows: ARM_LEFT })
    layers.push(pose === 'raise' ? { x: 14, y: 0, rows: ARM_RAISED } : { x: 14, y: 8, rows: ARM_RIGHT })
    return `<g shape-rendering="crispEdges">${toPaths(compose(layers), palette(ap), 20, 1, 2)}</g>`
  })
}

/** Agent standing, facing us, feet at (0, 0). prop: 'cup' holds a coffee. */
export function standing(ap, prop = null) {
  return memo(`stand|${prop}|${ap.key}`, () => {
    const layers = [{ rows: STAND }]
    if (STAND_OUTFIT[ap.outfit]) layers.push({ y: 15, rows: STAND_OUTFIT[ap.outfit] })
    layers.push(...hatLayer(ap.hat, -1, 2))
    if (prop === 'cup') layers.push({ x: 13, y: 16, rows: CUP })
    return (
      `<ellipse cx="0" cy="0" rx="12" ry="3" fill="#000" opacity="0.4"/>` +
      `<g shape-rendering="crispEdges">${toPaths(compose(layers), palette(ap), -14, -54, 2)}</g>`
    )
  })
}

/** Avatar markup for lists: a round bust with a status ring. */
export function avatarHTML(agent, { ring = '', size = '' } = {}) {
  return `<span class="avatar ${size} ${ring}">${bust(appearance(agent))}</span>`
}
