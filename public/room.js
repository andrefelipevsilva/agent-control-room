// Agent Control Room page: lays out the two panes, keeps them in sync with the room server's /status and
// remembers the viewer's layout. The iframes are never moved in the DOM (that would reload them): layouts
// only change classes and CSS variables.
(() => {
  'use strict'

  const STORE_KEY = 'agent-control-room:state'
  const LAYOUTS = ['side', 'stacked', 'floating']
  const POLL_MS = 3000
  const MIN_FLOAT = { w: 320, h: 220 }

  // ─── Text (English, or Portuguese when the browser is in Portuguese) ──────

  const TEXT = {
    en: {
      tagline: '// live agents',
      side: 'side by side',
      stacked: 'stacked',
      floating: 'floating',
      swap: 'swap',
      record: 'record',
      sideTitle: 'Side by side (1)',
      stackedTitle: 'One above the other, good for vertical video (2)',
      floatingTitle: 'One pane floating over the other (3)',
      swapTitle: 'Swap the two panes (T)',
      recordTitle: 'Hide the bar to record (G). To bring it back: G, Esc or hover the top edge.',
      dividerTitle: 'Drag to resize. Double-click to split in half.',
      dragToMove: '· drag to move',
      runs: 'runs',
      notAffiliated: '· independent project, not affiliated with either',
      waiting_habblaud: 'starting Habblaud...',
      waitingHint_habblaud: 'If it takes long, open Docker Desktop. The room keeps retrying.',
      waiting_agentFlow: 'starting Agent Flow...',
      waitingHint_agentFlow: 'The room keeps retrying.',
      down: 'the room server stopped',
      downHint: 'Run start.cmd (or npm start) again.',
      recordToast: 'Recording mode. G, Esc or the top edge bring the bar back.',
    },
    pt: {
      tagline: '// agentes ao vivo',
      side: 'lado a lado',
      stacked: 'empilhado',
      floating: 'flutuante',
      swap: 'trocar',
      record: 'gravar',
      sideTitle: 'Lado a lado (1)',
      stackedTitle: 'Um em cima do outro, bom para vídeo vertical (2)',
      floatingTitle: 'Um painel flutuando sobre o outro (3)',
      swapTitle: 'Troca a posição dos dois (T)',
      recordTitle: 'Esconde a barra para gravar (G). Para voltar: G, Esc ou passe o mouse no topo.',
      dividerTitle: 'Arraste para redimensionar. Clique duas vezes para dividir ao meio.',
      dragToMove: '· arraste para mover',
      runs: 'roda o',
      notAffiliated: '· projeto independente, sem vínculo com nenhum dos dois',
      waiting_habblaud: 'ligando o Habblaud...',
      waitingHint_habblaud: 'Se demorar, abra o Docker Desktop. A sala tenta de novo sozinha.',
      waiting_agentFlow: 'ligando o Agent Flow...',
      waitingHint_agentFlow: 'A sala tenta de novo sozinha.',
      down: 'o servidor da sala parou',
      downHint: 'Rode o start.cmd (ou npm start) de novo.',
      recordToast: 'Modo gravação. G, Esc ou o topo da tela trazem a barra de volta.',
    },
  }
  const lang = (navigator.language || 'en').toLowerCase().startsWith('pt') ? 'pt' : 'en'
  const t = (key) => TEXT[lang][key] ?? TEXT.en[key] ?? key

  document.documentElement.lang = lang === 'pt' ? 'pt-BR' : 'en'
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n)
  for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle)

  // ─── State (remembered per browser) ───────────────────────────────────────

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
  const ratioOr = (v, fallback) => (typeof v === 'number' && v >= 0.15 && v <= 0.85 ? v : fallback)

  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY)) || {}
    } catch {
      return {}
    }
  })()

  const state = {
    layout: LAYOUTS.includes(saved.layout) ? saved.layout : 'side',
    swapped: saved.swapped === true,
    recording: false,
    ratio: { side: ratioOr(saved.ratio?.side, 0.6), stacked: ratioOr(saved.ratio?.stacked, 0.55) },
    float: saved.float && typeof saved.float.w === 'number' ? saved.float : null,
  }

  function save() {
    try {
      const { layout, swapped, ratio, float } = state
      localStorage.setItem(STORE_KEY, JSON.stringify({ layout, swapped, ratio, float }))
    } catch {}
  }

  // ─── Elements ─────────────────────────────────────────────────────────────

  const $ = (id) => document.getElementById(id)
  const stage = $('stage')
  const divider = $('divider')
  const recordBtn = $('record')
  const toast = $('toast')
  const layoutButtons = [...document.querySelectorAll('.layouts [data-layout]')]

  const services = {}
  for (const key of ['habblaud', 'agentFlow']) {
    const pane = $(`pane-${key}`)
    services[key] = {
      key,
      pane,
      frame: $(`frame-${key}`),
      chip: $(`chip-${key}`),
      title: pane.querySelector('.notice-title'),
      hint: pane.querySelector('.notice-hint'),
      url: null,
      up: null,
    }
  }

  // ─── Layout ───────────────────────────────────────────────────────────────

  const floatingPane = () => (state.swapped ? services.habblaud.pane : services.agentFlow.pane)

  function defaultFloat(box) {
    const w = Math.round(box.width * 0.42)
    const h = Math.round(box.height * 0.55)
    return { x: box.width - w - 16, y: box.height - h - 16, w, h }
  }

  function clampFloat(f, box) {
    const w = clamp(f.w, Math.min(MIN_FLOAT.w, box.width), box.width)
    const h = clamp(f.h, Math.min(MIN_FLOAT.h, box.height), box.height)
    return { w, h, x: clamp(f.x, 0, box.width - w), y: clamp(f.y, 0, box.height - h) }
  }

  function placeFloat() {
    const floating = state.layout === 'floating' ? floatingPane() : null
    for (const { pane } of Object.values(services)) {
      pane.classList.toggle('is-floating', pane === floating)
      pane.classList.toggle('is-base', !!floating && pane !== floating)
      if (pane !== floating) pane.removeAttribute('style')
    }
    if (!floating) return
    const box = stage.getBoundingClientRect()
    state.float = clampFloat(state.float ?? defaultFloat(box), box)
    const { x, y, w, h } = state.float
    Object.assign(floating.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` })
  }

  function apply() {
    document.body.dataset.layout = state.layout
    document.body.classList.toggle('swapped', state.swapped)
    document.body.classList.toggle('recording', state.recording)
    if (state.layout !== 'floating') stage.style.setProperty('--r', String(state.ratio[state.layout]))
    for (const b of layoutButtons) b.setAttribute('aria-pressed', String(b.dataset.layout === state.layout))
    recordBtn.setAttribute('aria-pressed', String(state.recording))
    divider.setAttribute('aria-orientation', state.layout === 'stacked' ? 'horizontal' : 'vertical')
    divider.setAttribute('aria-valuenow', String(Math.round((state.ratio[state.layout] ?? 0.5) * 100)))
    placeFloat()
  }

  function setLayout(layout) {
    state.layout = layout
    apply()
    save()
  }

  function swap() {
    state.swapped = !state.swapped
    apply()
    save()
  }

  let toastTimer = 0
  function showToast(text) {
    toast.textContent = text
    toast.classList.add('show')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2600)
  }

  function setRecording(on = !state.recording) {
    state.recording = on
    apply()
    if (on) showToast(t('recordToast'))
  }

  function setRatio(v) {
    state.ratio[state.layout] = clamp(v, 0.15, 0.85)
    apply()
  }

  for (const b of layoutButtons) b.addEventListener('click', () => setLayout(b.dataset.layout))
  $('swap').addEventListener('click', swap)
  recordBtn.addEventListener('click', () => setRecording())

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const k = e.key.toLowerCase()
    if (k === '1' || k === '2' || k === '3') setLayout(LAYOUTS[Number(k) - 1])
    else if (k === 't') swap()
    else if (k === 'g') setRecording()
    else if (k === 'escape' && state.recording) setRecording(false)
    else return
    e.preventDefault()
  })

  window.addEventListener('resize', placeFloat)

  // ─── Dragging (divider, floating pane, its corner) ────────────────────────

  /** Pointer drag with capture; the iframes stop taking the pointer while it lasts. */
  function draggable(el, { start, move, end }) {
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || start(e) === false) return
      e.preventDefault()
      el.setPointerCapture(e.pointerId)
      document.body.classList.add('dragging')
      const onMove = (ev) => move(ev)
      const onUp = () => {
        el.removeEventListener('pointermove', onMove)
        el.removeEventListener('pointerup', onUp)
        el.removeEventListener('pointercancel', onUp)
        document.body.classList.remove('dragging')
        end?.()
        save()
      }
      el.addEventListener('pointermove', onMove)
      el.addEventListener('pointerup', onUp)
      el.addEventListener('pointercancel', onUp)
    })
  }

  draggable(divider, {
    start: () => state.layout !== 'floating',
    move: (e) => {
      const box = stage.getBoundingClientRect()
      setRatio(state.layout === 'side' ? (e.clientX - box.left) / box.width : (e.clientY - box.top) / box.height)
    },
  })
  divider.addEventListener('dblclick', () => {
    setRatio(0.5)
    save()
  })
  divider.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: -0.02, ArrowUp: -0.02, ArrowRight: 0.02, ArrowDown: 0.02 }[e.key]
    if (!step || state.layout === 'floating') return
    e.preventDefault()
    e.stopPropagation()
    setRatio(state.ratio[state.layout] + step)
    save()
  })

  for (const { pane } of Object.values(services)) {
    let from = null
    draggable(pane.querySelector('.handle'), {
      start: (e) => {
        if (!pane.classList.contains('is-floating')) return false
        from = { px: e.clientX, py: e.clientY, ...state.float }
      },
      move: (e) => {
        state.float = { ...state.float, x: from.x + e.clientX - from.px, y: from.y + e.clientY - from.py }
        placeFloat()
      },
    })
    draggable(pane.querySelector('.corner'), {
      start: (e) => {
        if (!pane.classList.contains('is-floating')) return false
        from = { px: e.clientX, py: e.clientY, ...state.float }
      },
      move: (e) => {
        state.float = { ...state.float, w: from.w + e.clientX - from.px, h: from.h + e.clientY - from.py }
        placeFloat()
      },
    })
  }

  // ─── Services: show a notice until each one answers, (re)load it when it does ──

  function render(svc, uiState) {
    svc.pane.dataset.state = uiState
    svc.chip.dataset.state = uiState
    if (uiState === 'waiting') {
      svc.title.textContent = t(`waiting_${svc.key}`)
      svc.hint.textContent = t(`waitingHint_${svc.key}`)
    } else if (uiState === 'down') {
      svc.title.textContent = t('down')
      svc.hint.textContent = t('downHint')
    }
  }

  async function poll() {
    let status = null
    try {
      const res = await fetch('status', { cache: 'no-store' })
      if (res.ok) status = await res.json()
    } catch {}

    for (const svc of Object.values(services)) {
      const info = status?.[svc.key]
      const up = !!info?.up
      if (info?.url) svc.url = info.url
      // First time up, or back after being down: load it again (the frame may hold an error page).
      if (up && svc.up !== true && svc.url) svc.frame.src = svc.url
      if (status) svc.up = up
      render(svc, !status ? 'down' : up ? 'up' : 'waiting')
    }
    setTimeout(poll, POLL_MS)
  }

  apply()
  poll()
})()
