// Vector characters for the office and the avatars around the app: skin, hair, hair style and top color come from
// the agent's Habblaud seed (or the parts chosen in Habblaud's character editor), so each agent looks the same
// everywhere and stays the same across restarts.

import { rng, pick } from './util.js'

const SKIN = ['#f0c7a2', '#e3b48c', '#d9a27c', '#c68e65', '#a8714b', '#8d5a3b', '#6e4630']
const HAIR = ['#2a1f1a', '#1a1412', '#3b2a1f', '#6b4a2f', '#b07a45', '#8a8f99', '#c9a15e', '#4a2a1f']
const TOPS = ['#3d4a63', '#5a4a72', '#7a4a3a', '#2f5a4c', '#44505f', '#6b4a2f', '#4b5d7a', '#6a3f52', '#36574f']
const STYLES_F = ['long', 'bun', 'ponytail', 'bob', 'curly', 'long']
const STYLES_M = ['short', 'short', 'bald', 'curly', 'short', 'bun']

const HAIR_FROM_PART = {
  short: 'short', buzz: 'short', spiky: 'short', side_part: 'short', mohawk: 'short', wavy: 'short',
  curly: 'curly', afro: 'curly', bob: 'bob', long: 'long', ponytail: 'ponytail', pigtails: 'ponytail',
  bun: 'bun', bald: 'bald',
}

const cache = new Map()

/** The agent's look: { skin, hair, top, style, beard }. */
export function appearance(agent) {
  const key = `${agent.seed}|${agent.look}|${JSON.stringify(agent.parts ?? null)}`
  let ap = cache.get(key)
  if (ap) return ap
  const r = rng(agent.seed ?? 1)
  const p = agent.parts ?? {}
  const female = agent.look === 'f'
  ap = {
    skin: p.skin ?? pick(r, SKIN),
    hair: p.hair ?? pick(r, HAIR),
    top: p.top ?? pick(r, TOPS),
    style: HAIR_FROM_PART[p.hairStyle] ?? pick(r, female ? STYLES_F : STYLES_M),
    beard: p.facialHair ? p.facialHair !== 'none' : !female && r() < 0.3,
  }
  cache.set(key, ap)
  return ap
}

const TOP_HAIR = 'M8.6 13.2C8.4 8.6 11.3 6 15 6S21.6 8.6 21.4 13.2C20.3 10.6 18.2 9.6 15 9.6S9.7 10.6 8.6 13.2Z'

/** Head-and-shoulders avatar, 30×30 viewBox. */
export function bust(ap) {
  const { skin, hair, top, style, beard } = ap
  let back = ''
  let front = `<path d="${TOP_HAIR}" fill="${hair}"/>`
  if (style === 'long') back = `<path d="M8.2 14C7.8 8.4 11 5.6 15 5.6S22.2 8.4 21.8 14L22.6 23H19.4L19.8 13.6C18.6 10.8 17 10 15 10S11.4 10.8 10.2 13.6L10.6 23H7.4Z" fill="${hair}"/>`
  if (style === 'bob') back = `<path d="M8.2 14C7.8 8.4 11 5.6 15 5.6S22.2 8.4 21.8 14L22 19.5H19.6L19.8 13.6C18.6 10.8 17 10 15 10S11.4 10.8 10.2 13.6L10.4 19.5H8Z" fill="${hair}"/>`
  if (style === 'ponytail') back = `<path d="M20.5 9.5C24.5 11 25 17 23 21C22.6 17 21.6 13.6 19.6 12Z" fill="${hair}"/>`
  if (style === 'bun') {
    back = `<circle cx="15" cy="5.2" r="3.4" fill="${hair}"/>`
    front = `<path d="M8.5 13.6C8.2 8.6 11.2 5.8 15 5.8S21.8 8.6 21.5 13.6C20.4 10.6 18.2 9.4 15 9.4S9.6 10.6 8.5 13.6Z" fill="${hair}"/>`
  }
  if (style === 'curly') front = [[9.4, 11.4], [10.8, 8], [14.8, 6.4], [19, 8], [20.6, 11.4], [12.6, 6.8], [17.2, 6.8]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.7" fill="${hair}"/>`).join('')
  if (style === 'bald') front = ''
  const beardPath = beard ? `<path d="M9.6 15C10.3 19.2 12.8 20.6 15 20.6S19.7 19.2 20.4 15C19.2 17 17.2 17.6 15 17.6S10.8 17 9.6 15Z" fill="${hair}"/>` : ''
  return (
    `<svg viewBox="0 0 30 30" aria-hidden="true">${back}` +
    `<path d="M4 31C4.5 23 25.5 23 26 31Z" fill="${top}"/>` +
    `<rect x="12.5" y="17" width="5" height="5" rx="2" fill="${skin}"/>` +
    `<circle cx="15" cy="13" r="6.3" fill="${skin}"/>${front}${beardPath}</svg>`
  )
}

/**
 * Agent seated at a desk, seen from behind, in the desk's own coordinates (the desk is 76 wide, the chair sits under
 * it at y≈31–53). pose: 'type' (hands on the keyboard) or 'raise' (one hand up: needs you).
 */
export function seated(ap, pose = 'type') {
  const { skin, hair, top, style } = ap
  let behind = ''
  if (style === 'long') behind = `<path d="M38 12C26 12 25 34 28 44H48C51 34 50 12 38 12Z" fill="${hair}"/>`
  if (style === 'bob') behind = `<path d="M38 12C28 12 27 25 29 31H47C49 25 48 12 38 12Z" fill="${hair}"/>`
  const arms =
    pose === 'raise'
      ? `<path d="M26 34L29.5 16.5" stroke="${top}" stroke-width="5.5" stroke-linecap="round"/><circle cx="29.5" cy="15.6" r="2.6" fill="${skin}"/>` +
        `<path d="M50 33L57 3" stroke="${top}" stroke-width="5.5" stroke-linecap="round"/><circle cx="57.6" cy="0.5" r="3" fill="${skin}"/>`
      : `<path d="M26 34L29.5 16.5M50 34L46.5 16.5" stroke="${top}" stroke-width="5.5" stroke-linecap="round"/>` +
        `<circle cx="29.5" cy="15.6" r="2.6" fill="${skin}"/><circle cx="46.5" cy="15.6" r="2.6" fill="${skin}"/>`
  let head = `<circle cx="38" cy="21.5" r="8.5" fill="${style === 'bald' ? skin : hair}"/>`
  if (style === 'curly') head = `<circle cx="38" cy="21" r="9.2" fill="${hair}"/>` + [[31, 17.5], [45, 17.5], [34.5, 13.5], [41.5, 13.5]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.2" fill="${hair}"/>`).join('')
  if (style === 'bun') head += `<circle cx="38" cy="11.5" r="4.2" fill="${hair}"/>`
  if (style === 'ponytail') head += `<path d="M36 27Q37.5 34 36.6 38Q40.4 34 40 27Z" fill="${hair}"/>`
  if (style === 'long') head += `<path d="M30 20C30 30 33 36 38 36S46 30 46 20Z" fill="${hair}"/>`
  return (
    behind +
    `<ellipse cx="38" cy="38" rx="15.5" ry="8.5" fill="${top}"/>${arms}` +
    `<rect x="35" y="27" width="6" height="5" rx="2" fill="${skin}"/>${head}` +
    `<circle cx="29.6" cy="22.5" r="2" fill="${skin}"/><circle cx="46.4" cy="22.5" r="2" fill="${skin}"/>`
  )
}

/** Agent standing, seen from behind, feet at (0, 0). prop: 'cup' holds a coffee. */
export function standing(ap, prop = null) {
  const { skin, hair, top, style } = ap
  const leftArm = `<rect x="-13" y="-34" width="5" height="17" rx="2.5" fill="${top}"/><circle cx="-10.5" cy="-16.5" r="2.4" fill="${skin}"/>`
  const rightArm =
    prop === 'cup'
      ? `<rect x="8" y="-34" width="5" height="12" rx="2.5" fill="${top}"/><rect x="9" y="-30" width="7" height="8" rx="1.5" fill="#e6e8eb"/>` +
        `<circle cx="11" cy="-22.5" r="2.4" fill="${skin}"/>` +
        `<path d="M11 -33C9.5 -35 12.5 -36.5 11 -39M14.5 -33C13 -35 16 -36.5 14.5 -39" stroke="#c9cdd3" stroke-width="0.9" fill="none" opacity="0.5"/>`
      : `<rect x="8" y="-34" width="5" height="17" rx="2.5" fill="${top}"/><circle cx="10.5" cy="-16.5" r="2.4" fill="${skin}"/>`
  let hairBack = ''
  if (style === 'long') hairBack = `<path d="M-8.5 -46Q-9.5 -30 -7 -26H7Q9.5 -30 8.5 -46Z" fill="${hair}"/>`
  if (style === 'bob') hairBack = `<path d="M-8.5 -46Q-9 -36 -7.5 -33H7.5Q9 -36 8.5 -46Z" fill="${hair}"/>`
  let head = `<circle cx="0" cy="-45" r="8.5" fill="${style === 'bald' ? skin : hair}"/>`
  if (style === 'curly') head = `<circle cx="0" cy="-45.5" r="9.2" fill="${hair}"/>` + [[-7, -49], [7, -49], [-3.5, -53], [3.5, -53]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.2" fill="${hair}"/>`).join('')
  if (style === 'bun') head += `<circle cx="0" cy="-55" r="4.2" fill="${hair}"/>`
  if (style === 'ponytail') head += `<path d="M-2 -40Q-0.5 -32 -1.4 -28Q2.4 -32 2 -40Z" fill="${hair}"/>`
  return (
    `<ellipse cx="0" cy="0" rx="9" ry="2.6" fill="#000" opacity="0.45"/>` +
    `<rect x="-6.5" y="-14" width="5.5" height="14" rx="2.2" fill="#2a2f37"/><rect x="1" y="-14" width="5.5" height="14" rx="2.2" fill="#2a2f37"/>` +
    hairBack +
    `<rect x="-10" y="-36" width="20" height="25" rx="7" fill="${top}"/>${leftArm}${rightArm}` +
    `<rect x="-3" y="-40" width="6" height="5" rx="2" fill="${skin}"/>${head}` +
    `<circle cx="-8.3" cy="-44" r="2" fill="${skin}"/><circle cx="8.3" cy="-44" r="2" fill="${skin}"/>`
  )
}

/** Avatar markup for lists: a round bust with a status ring. */
export function avatarHTML(agent, { ring = '', size = '' } = {}) {
  return `<span class="avatar ${size} ${ring}">${bust(appearance(agent))}</span>`
}
