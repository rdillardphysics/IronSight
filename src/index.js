import { invoke } from '@tauri-apps/api/core'
// Import README as raw text via Vite's `?raw` so dev server doesn't return index.html
import readmeText from '../README.md?raw'

// Import themed SVG icons so Vite will resolve and emit the correct
// hashed/embedded asset URLs at build time.
import moonDark from './assets/icons/moon-dark.svg'
import moonLight from './assets/icons/moon-light.svg'
import pathDark from './assets/icons/path-dark.svg'
import pathLight from './assets/icons/path-light.svg'
import folderDark from './assets/icons/folder-dark.svg'
import folderLight from './assets/icons/folder-light.svg'
import cleanDark from './assets/icons/clean-dark.svg'
import cleanLight from './assets/icons/clean-light.svg'
import iconDark from './assets/icons/icon-dark.svg'
import iconLight from './assets/icons/icon-light.svg'
import filterEditDark from './assets/icons/filter-edit-dark.svg'
import filterEditLight from './assets/icons/filter-edit-light.svg'
import filterRemoveDark from './assets/icons/filter-remove-dark.svg'
import filterRemoveLight from './assets/icons/filter-remove-light.svg'
import closeDark from './assets/icons/close-dark.svg'
import closeLight from './assets/icons/close-light.svg'
import undoDark from './assets/icons/undo-dark.svg'
import undoLight from './assets/icons/undo-light.svg'
import acceptDark from './assets/icons/accept-dark.svg'
import acceptLight from './assets/icons/accept-light.svg'
import jfrogIconDark from './assets/icons/jfrog-icon-dark.svg'
import jfrogIconLight from './assets/icons/jfrog-icon-light.svg'
import wrenchDark from './assets/icons/wrench-dark.svg'
import wrenchLight from './assets/icons/wrench-light.svg'
import sshDark from './assets/icons/ssh-dark.svg'
import sshLight from './assets/icons/ssh-light.svg'
import readmeDark from './assets/icons/readme-dark.svg'
import readmeLight from './assets/icons/readme-light.svg'
import saveDark from './assets/icons/save-dark.svg'
import saveLight from './assets/icons/save-light.svg'

const ICON_MAP = {
  moon: { dark: moonDark, light: moonLight },
  path: { dark: pathDark, light: pathLight },
  folder: { dark: folderDark, light: folderLight },
  clean: { dark: cleanDark, light: cleanLight },
  save: { dark: saveDark, light: saveLight },
  icon: { dark: iconDark, light: iconLight },
  'filter-remove': { dark: filterRemoveDark, light: filterRemoveLight },
  'filter-edit': { dark: filterEditDark, light: filterEditLight },
  undo: { dark: undoDark, light: undoLight },
  close: { dark: closeDark, light: closeLight }
  , accept: { dark: acceptDark, light: acceptLight }
  , "jfrog-icon": { dark: jfrogIconDark, light: jfrogIconLight }
  , settings: { dark: wrenchDark, light: wrenchLight }
  , ssh: { dark: sshDark, light: sshLight }
  , readme: { dark: readmeDark, light: readmeLight }
}

// Open external links reliably from the webview.
// Prefer invoking the native `open_url` command (if available), fall back to
// `window.open` so links still work in the browser for debugging.
async function openExternal(url) {
  try {
    // Try Tauri invoke first (works in native builds)
    if (typeof invoke === 'function') {
      try {
        await invoke('open_url', { url })
        return
      } catch (e) {
        // fall through to window.open
        console.debug('invoke open_url failed, falling back to window.open', e)
      }
    }
  } catch (e) {
    // ignore
  }

  try {
    // Best-effort synchronous open to avoid popup blockers in some contexts
    window.open(url, '_blank', 'noopener')
  } catch (e) {
    console.warn('failed to open url', url, e)
  }
}

let currentFindings = []
let lastLoadedData = null
let sortState = { key: null, dir: 1 } // dir: 1 asc, -1 desc
// filterState.severities: map of severity -> boolean indicating whether it's included
// filterState.showAll: true => bypass severity filtering (Show All ON)
// filterState.severities: map of severity -> boolean indicating whether it's included
// filterState.showAll: true => bypass severity filtering (Show All ON)
// filterState.severities: map of severity -> boolean indicating whether it's included
// NOTE: severity checkboxes default to unchecked (bad UX to pre-select); they are only used when showAll === false
let filterState = { showAll: true, severities: { critical: false, high: false, medium: false, low: false, info: false, unknown: false }, fixOnly: false, q: '', searchMode: 'literal' }

// Virtualization state kept across renderFindings() calls so we can
// preserve scroll position and avoid leaking event listeners.
let virtualState = { wrap: null, rowHeight: null, scrollHandler: null, resizeHandler: null }

// Debounced renderer: avoids frequent re-renders when filters/toggles
// change rapidly. `delayMs` is small to keep UI responsive.
let _renderTimeout = null
const _renderDelayMs = 120
function scheduleRender(payload) {
  if (_renderTimeout) clearTimeout(_renderTimeout)
  _renderTimeout = setTimeout(() => {
    _renderTimeout = null
    try { renderFindings(payload) } catch (e) { console.debug('scheduled render failed', e) }
  }, _renderDelayMs)
}

function compareByKey(a, b, key) {
  const sevOrder = { critical: 5, high: 4, medium: 3, low: 2, info: 1, unknown: 0 }

  if (key === 'severity') {
    const av = (a.severity || '').toLowerCase()
    const bv = (b.severity || '').toLowerCase()
    return (sevOrder[av] || 0) - (sevOrder[bv] || 0)
  }

  if (key === 'package') {
    const av = (a.package?.name || a.component || '').toLowerCase()
    const bv = (b.package?.name || b.component || '').toLowerCase()
    return av.localeCompare(bv)
  }

  if (key === 'cves') {
    const ac = (a.cves || []).length
    const bc = (b.cves || []).length
    return ac - bc
  }

  const ak = a[key]
  const bk = b[key]
  const as = ak == null ? '' : String(ak)
  const bs = bk == null ? '' : String(bk)
  const an = Number(as)
  const bn = Number(bs)
  if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn
  return as.localeCompare(bs)
}

function sortFindings(data) {
  if (!sortState.key) return data
  const key = sortState.key
  return data.slice().sort((a, b) => sortState.dir * compareByKey(a, b, key))
}

function fuzzySubsequenceMatch(needle, hay) {
  if (!needle || !hay) return false
  let i = 0
  let j = 0
  while (i < needle.length && j < hay.length) {
    if (needle[i] === hay[j]) i++
    j++
  }
  return i === needle.length
}

// Escape regex metacharacters so user tokens can be treated as literals
function escapeForRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Modal focus-trap helpers: cycle focus inside a modal while it's open
function attachModalFocusTrap(modal) {
  if (!modal) return
  if (modal._focusTrapAttached) return
  const handler = (e) => {
    if (e.key !== 'Tab') return
    const focusable = modal.querySelectorAll('a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])')
    const focusables = Array.from(focusable).filter(el => el.offsetParent !== null)
    if (!focusables.length) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault()
        last.focus()
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }
  modal._focusTrapHandler = handler
  document.addEventListener('keydown', handler)
  modal._focusTrapAttached = true
}

function detachModalFocusTrap(modal) {
  if (!modal || !modal._focusTrapAttached) return
  try { document.removeEventListener('keydown', modal._focusTrapHandler) } catch (e) { }
  modal._focusTrapHandler = null
  modal._focusTrapAttached = false
}

// Make the rest of the document inert while `modal` is open to improve
// screen-reader behaviour. Uses native `inert` when available, otherwise
// falls back to setting `aria-hidden` on siblings and disabling focusable
// descendants. Stores previous state on `modal._inertBackup` so it can be
// restored on close.
function makeBackgroundInert(modal) {
  if (!modal || !document || !document.body) return
  try {
    // Prevent double-requesting from the same modal
    if (modal._requestedInert) return
    modal._requestedInert = true
    window._inertCount = (window._inertCount || 0) + 1

    // Only apply DOM-wide inerting when transitioning 0 -> 1
    if (window._inertCount !== 1) return

    const children = Array.from(document.body.children || [])
    const globalBackup = []
    children.forEach((el) => {
      if (!el || el === modal || el.contains(modal)) return
      const backup = { el, hadInert: !!el.inert, ariaHidden: el.getAttribute && el.getAttribute('aria-hidden'), focusables: [] }
      try {
        if ('inert' in HTMLElement.prototype) el.inert = true
        else el.setAttribute && el.setAttribute('aria-hidden', 'true')
      } catch (e) {
        try { el.setAttribute && el.setAttribute('aria-hidden', 'true') } catch (ee) { }
      }
      try {
        const focusableSel = 'a[href], area[href], input, select, textarea, button, iframe, [tabindex]'
        const items = Array.from(el.querySelectorAll(focusableSel))
        items.forEach((n) => {
          const old = n.getAttribute && n.getAttribute('tabindex')
          backup.focusables.push({ node: n, tabindex: old })
          try { n.setAttribute && n.setAttribute('tabindex', '-1') } catch (e) { }
        })
      } catch (e) { }
      globalBackup.push(backup)
    })
    window._inertGlobalBackup = globalBackup
  } catch (e) {
    console.debug('makeBackgroundInert failed', e)
  }
}

function restoreBackgroundInert(modal) {
  if (!modal) return
  try {
    // Only act if this modal previously requested inert
    if (!modal._requestedInert) return
    modal._requestedInert = false
    window._inertCount = Math.max(0, (window._inertCount || 0) - 1)

    // Only restore when count drops to zero
    if ((window._inertCount || 0) !== 0) return

    const globalBackup = window._inertGlobalBackup || []
    globalBackup.forEach((b) => {
      const el = b.el
      try {
        if ('inert' in HTMLElement.prototype) el.inert = !!b.hadInert
        else {
          if (b.ariaHidden == null) el.removeAttribute && el.removeAttribute('aria-hidden')
          else el.setAttribute && el.setAttribute('aria-hidden', b.ariaHidden)
        }
      } catch (e) {
        try {
          if (b.ariaHidden == null) el.removeAttribute && el.removeAttribute('aria-hidden')
          else el.setAttribute && el.setAttribute('aria-hidden', b.ariaHidden)
        } catch (ee) { }
      }
      try {
        (b.focusables || []).forEach((it) => {
          if (!it || !it.node) return
          if (it.tabindex == null) it.node.removeAttribute && it.node.removeAttribute('tabindex')
          else it.node.setAttribute && it.node.setAttribute('tabindex', it.tabindex)
        })
      } catch (e) { }
    })
    window._inertGlobalBackup = null
  } catch (e) {
    console.debug('restoreBackgroundInert failed', e)
  }
}

// Modal stack helpers: push/pop modals and close only the top modal on Escape
function pushModal(modal, onClose) {
  try {
    window._modalStack = window._modalStack || []
    if (!window._modalStack.find(m => m.modal === modal)) window._modalStack.push({ modal, onClose })
    // assign z-index values so the most-recently opened modal appears on top
    try {
      const base = 1000
      window._modalStack.forEach((entry, idx) => {
        try {
          if (entry && entry.modal && entry.modal.style) entry.modal.style.zIndex = String(base + idx * 10)
        } catch (e) { /* ignore per-entry failures */ }
      })
    } catch (e) { /* ignore */ }
  } catch (e) { /* ignore */ }
}

function popModal(modal) {
  try {
    window._modalStack = window._modalStack || []
    const i = window._modalStack.findIndex(m => m.modal === modal)
    if (i !== -1) window._modalStack.splice(i, 1)
    // recompute z-index values after removal so stacking order remains consistent
    try {
      const base = 1000
      window._modalStack.forEach((entry, idx) => {
        try {
          if (entry && entry.modal && entry.modal.style) entry.modal.style.zIndex = String(base + idx * 10)
        } catch (e) { /* ignore per-entry failures */ }
      })
    } catch (e) { /* ignore */ }
  } catch (e) { /* ignore */ }
}

function closeTopModal() {
  try {
    window._modalStack = window._modalStack || []
    if (!window._modalStack.length) return
    const entry = window._modalStack[window._modalStack.length - 1]
    if (!entry) return
    const { modal, onClose } = entry
    // If an onClose function was provided, call it (it should hide + detach). Otherwise, hide and detach.
    try {
      if (typeof onClose === 'function') onClose()
      else {
        if (modal && modal.classList) modal.classList.add('hidden')
        try { detachModalAccessibility(modal) } catch (e) { /* ignore */ }
      }
    } catch (e) {
      // ensure modal is removed from stack even if onClose throws
      try { popModal(modal) } catch (ee) { }
    }
  } catch (e) { console.debug('closeTopModal failed', e) }
}

function closeAllModals() {
  try {
    window._modalStack = window._modalStack || []
    const arr = window._modalStack.slice()
    arr.forEach(entry => {
      try {
        const { modal, onClose } = entry
        if (typeof onClose === 'function') onClose()
        else {
          if (modal && modal.classList) modal.classList.add('hidden')
          try { detachModalAccessibility(modal) } catch (e) { }
        }
      } catch (e) { /* ignore per-modal errors */ }
    })
    window._modalStack = []
  } catch (e) { console.debug('closeAllModals failed', e) }
}

// Consolidated helper: attach both focus-trap and Escape-to-close for modals.
// `onClose` should be a function that hides the modal (e.g., hideFiltersModal).
function attachModalAccessibility(modal, onClose) {
  if (!modal) return
  // remember the element that had focus before opening the modal so we
  // can restore it when the modal closes. Only store if it's outside
  // the modal itself.
  try {
    const ae = document.activeElement
    if (ae && modal && !modal.contains(ae)) modal._previousActiveElement = ae
    else modal._previousActiveElement = null
  } catch (e) { modal._previousActiveElement = null }

  attachModalFocusTrap(modal)
  // make background inert so screen readers and focus are constrained
  try { makeBackgroundInert(modal) } catch (e) { /* ignore */ }
  // remember onClose and push onto stack so Escape closes top modal only
  try { modal._onClose = (typeof onClose === 'function') ? onClose : null } catch (e) { modal._onClose = null }
  try { pushModal(modal, modal._onClose) } catch (e) { /* ignore */ }
  if (!modal._escHandler) {
    modal._escHandler = (ev) => { if (ev.key === 'Escape') closeTopModal() }
    document.addEventListener('keydown', modal._escHandler)
  }
}

function detachModalAccessibility(modal) {
  if (!modal) return
  try { detachModalFocusTrap(modal) } catch (e) { }
  try { restoreBackgroundInert(modal) } catch (e) { /* ignore */ }
  try {
    if (modal._escHandler) { document.removeEventListener('keydown', modal._escHandler); modal._escHandler = null }
  } catch (e) { /* ignore */ }

  // Attempt to restore focus to the element that was focused before the
  // modal opened. If that element is no longer available, focus a sensible
  // fallback control in the app (settings/open/load) or the document body.
  try {
    const prev = modal._previousActiveElement
    if (prev && typeof prev.focus === 'function' && document.contains(prev)) {
      prev.focus()
    } else {
      const fallback = document.querySelector('#settingsBtn, #openBtn, #loadBtn, .btn')
      if (fallback && typeof fallback.focus === 'function') fallback.focus()
      else if (document.body && typeof document.body.focus === 'function') document.body.focus()
    }
  } catch (e) { /* ignore focus restore failures */ }
  modal._previousActiveElement = null
  try { popModal(modal) } catch (e) { /* ignore */ }
}

// Match a compiled rule object against a finding. Returns true if the
// finding matches the rule.
function matchRuleAgainstFinding(rule, f) {
  if (!rule || rule.type === 'invalid') return false
  const pkgName = f.package?.name ? String(f.package.name).toLowerCase() : ''
  const compName = f.component ? String(f.component).toLowerCase() : ''
  const cvesText = (f.cves && f.cves.length) ? String((f.cves || []).join(' ')).toLowerCase() : ''
  const pathText = f.path ? String(f.path).toLowerCase() : ''
  const descText = f.description ? String(f.description).toLowerCase() : ''
  let hayCombined = pkgName
  if (compName) hayCombined += (hayCombined ? ' ' : '') + compName
  if (cvesText) hayCombined += (hayCombined ? ' ' : '') + cvesText
  if (pathText) hayCombined += (hayCombined ? ' ' : '') + pathText
  if (descText) hayCombined += (hayCombined ? ' ' : '') + descText

  const matchVal = (v) => {
    if (!v && v !== '') return false
    const target = hayCombined
    return String(target).toLowerCase().includes(String(v).toLowerCase())
  }

  try {
    if (rule.type === 'regex') {
      return !!rule.re.test(hayCombined)
    }
    if (rule.type === 'literal') {
      return matchVal(rule.val)
    }
    if (rule.type === 'field_literal') {
      const fld = rule.field
      const val = String(rule.val || '').toLowerCase()
      if (fld === 'package') return (pkgName && pkgName.includes(val)) || (compName && compName.includes(val))
      if (fld === 'cve' || fld === 'cves') return cvesText && cvesText.includes(val)
      if (fld === 'path') return pathText && pathText.includes(val)
      if (fld === 'severity') return (String(f.severity || '').toLowerCase() === val) || (String(f.severity || '').toLowerCase().includes(val))
      return hayCombined && hayCombined.includes(val)
    }
    if (rule.type === 'field_regex') {
      const fld = rule.field
      if (fld === 'package') return !!(rule.re.test(pkgName) || rule.re.test(compName))
      if (fld === 'cve' || fld === 'cves') return !!rule.re.test(cvesText)
      if (fld === 'path') return !!rule.re.test(pathText)
      if (fld === 'severity') return !!rule.re.test(String(f.severity || ''))
      return !!rule.re.test(hayCombined)
    }
  } catch (e) {
    return false
  }
  return false
}

function filterFindings(data) {
  return (data || []).filter(f => {
    // severity filtering: if Show All is enabled, skip severity filtering
    if (!filterState.showAll) {
      const sev = (f.severity || '').toLowerCase()
      if (sev) {
        if (!filterState.severities || !filterState.severities[sev]) return false
      } else {
        // findings without a severity are excluded when any severity filter is active
        if (filterState.severities && Object.values(filterState.severities).some(Boolean)) return false
      }
    }
    if (filterState.fixOnly && !f.fix_available) return false

    // Apply whitelist/ignore rules (whitelist first, then ignore)
    try {
      const rules = filterState._rules || { whitelist: [], ignore: [] }
      if (rules.whitelist && rules.whitelist.length > 0) {
        let matched = false
        for (const r of rules.whitelist) {
          if (!r || r.type === 'invalid') continue
          if (matchRuleAgainstFinding(r, f)) { matched = true; break }
        }
        if (!matched) return false
      }
      if (rules.ignore && rules.ignore.length > 0) {
        for (const r of rules.ignore) {
          if (!r || r.type === 'invalid') continue
          if (matchRuleAgainstFinding(r, f)) return false
        }
      }
    } catch (e) {
      // rule matching errors should not break filtering — fall back to continuing
      console.debug('rule matching failed', e)
    }

    const qRaw = (filterState.q || '').trim()
    if (!qRaw) return true

    const isRegex = (filterState.searchMode === 'regex')
    const isFuzzy = (filterState.searchMode === 'fuzzy')

    // Build lowercase field strings once (avoid per-field allocations)
    const pkgName = f.package?.name ? String(f.package.name).toLowerCase() : ''
    const compName = f.component ? String(f.component).toLowerCase() : ''
    const cvesText = (f.cves && f.cves.length) ? String((f.cves || []).join(' ')).toLowerCase() : ''
    const pathText = f.path ? String(f.path).toLowerCase() : ''
    const descText = f.description ? String(f.description).toLowerCase() : ''
    // combined haystack for single-RegExp path or as a fallback
    let hayCombined = pkgName
    if (compName) hayCombined += (hayCombined ? ' ' : '') + compName
    if (cvesText) hayCombined += (hayCombined ? ' ' : '') + cvesText
    if (pathText) hayCombined += (hayCombined ? ' ' : '') + pathText
    if (descText) hayCombined += (hayCombined ? ' ' : '') + descText

    // Prefer previously-built token objects (from apply time) to avoid splitting
    // and mapping tokens on every call. Build lightweight tokenObjs only when
    // compiled token objects are not available.
    const tokenObjsLocal = (filterState._tokenObjs && Array.isArray(filterState._tokenObjs))
      ? filterState._tokenObjs
      : (qRaw.split(/\s+/).filter(Boolean).map(tok => (tok.includes(':') ? ({ raw: tok, field: tok.split(':')[0].toLowerCase(), value: tok.split(':').slice(1).join(':') }) : ({ raw: tok, field: null, value: tok }))))

    // Helper to test a single term against a target string. When regex-mode
    // uses precompiled array, `compiledForIndex` will be provided and used.
    const matchesTerm = (term, target, compiledForIndex) => {
      if (!term) return false
      const t = (target || '').toLowerCase()
      if (isRegex) {
        if (filterState._compiledRegex && filterState._compiledRegex.type === 'array') {
          try { return !!(compiledForIndex && compiledForIndex.re.test(t)) } catch (e) { return false }
        }
        try {
          const pattern = (filterState.searchMode === 'literal') ? escapeForRegex(term) : term
          return new RegExp(pattern, 'i').test(t)
        } catch (e) { return false }
      }
      if (isFuzzy) return fuzzySubsequenceMatch(term.toLowerCase(), t)
      return t.includes(term.toLowerCase())
    }

    for (let idx = 0; idx < tokenObjsLocal.length; idx++) {
      const tokObj = tokenObjsLocal[idx]
      const tok = tokObj.raw
      if (tok.includes(':')) {
        const field = tokObj.field
        const val = tokObj.value
        if (!val) return false
        const compiledArr = (filterState._compiledRegex && filterState._compiledRegex.type === 'array') ? filterState._compiledRegex.arr : null
        const compiledForIndex = compiledArr ? compiledArr[idx] : null
        if (field === 'package') {
          const target = (pkgName || compName)
          if (!matchesTerm(val, target, compiledForIndex)) return false
        } else if (field === 'cve' || field === 'cves') {
          const target = cvesText
          if (!matchesTerm(val, target, compiledForIndex)) return false
        } else if (field === 'severity') {
          const target = (f.severity || '')
          if (!matchesTerm(val, target, compiledForIndex)) return false
        } else if (field === 'path') {
          const target = pathText
          if (!matchesTerm(val, target, compiledForIndex)) return false
        } else {
          // unknown field: match across combined searchable text
          if (!matchesTerm(val, hayCombined, compiledForIndex)) return false
        }
      } else {
        // general token: prefer using a single combined compiled RegExp
        // (when available) to test the entire searchable text; otherwise
        // test against each known field without allocating arrays.
        const term = tokObj.value
        if (isRegex && filterState._compiledRegex && filterState._compiledRegex.type === 'single') {
          if (!filterState._compiledRegex.re.test(hayCombined)) return false
          continue
        }

        const compiledArr = (filterState._compiledRegex && filterState._compiledRegex.type === 'array') ? filterState._compiledRegex.arr : null
        const compiledForIndex = compiledArr ? compiledArr[idx] : null

        let matched = false
        if (isRegex) {
          try { matched = !!(compiledForIndex && (compiledForIndex.re.test(pkgName) || compiledForIndex.re.test(compName) || compiledForIndex.re.test(cvesText) || compiledForIndex.re.test(pathText) || compiledForIndex.re.test(descText))) } catch (e) { matched = false }
        } else if (isFuzzy) {
          const needle = term.toLowerCase()
          matched = fuzzySubsequenceMatch(needle, pkgName) || fuzzySubsequenceMatch(needle, compName) || fuzzySubsequenceMatch(needle, cvesText) || fuzzySubsequenceMatch(needle, pathText) || fuzzySubsequenceMatch(needle, descText)
        } else {
          const t = term.toLowerCase()
          matched = (pkgName && pkgName.includes(t)) || (compName && compName.includes(t)) || (cvesText && cvesText.includes(t)) || (pathText && pathText.includes(t)) || (descText && descText.includes(t))
        }
        if (!matched) return false
      }
    }

    return true
  })
}

// escape text for HTML insertion
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Simple toast notification helper (lower-right)
function showToast(msg, type = 'info', duration = 3000) {
  try {
    let container = document.querySelector('.toast-container')
    if (!container) {
      container = document.createElement('div')
      container.className = 'toast-container'
      container.setAttribute('aria-live', 'polite')
      document.body.appendChild(container)
    }
    const t = document.createElement('div')
    t.className = 'toast' + (type === 'error' ? ' error' : '')
    t.textContent = String(msg)
    container.appendChild(t)
    // allow CSS transitions
    requestAnimationFrame(() => t.classList.add('show'))
    const timeout = setTimeout(() => {
      t.classList.remove('show')
      t.addEventListener('transitionend', () => t.remove(), { once: true })
      clearTimeout(timeout)
    }, duration)
  } catch (e) {
    // fallback: log
    console.warn('toast failed', e, msg)
  }
}

// Load the top-level README.md (if present) and render it into the output area
async function loadReadmeIntoOutput() {
  const out = document.getElementById('output')
  const filtersEl = document.getElementById('filters')
  try {
    // prefer the bundled README text (works in dev + prod), fallback to a short message
    const text = (typeof readmeText !== 'undefined' && readmeText) ? readmeText : 'Welcome to IronSight. Place a vulnerabilities JSON file that follows the expected schema and click Open or Load.'
    out.classList.remove('hidden')
    // If filters have been moved into the output panel previously, move them
    // back to their original place (before `.output-section`) so they are not
    // destroyed when we replace `out.innerHTML` below. If `filtersEl` isn't
    // present or already outside, this is a no-op.
    try {
      if (filtersEl && out.contains(filtersEl)) {
        const outputSection = document.querySelector('.output-section')
        if (outputSection && outputSection.parentNode) {
          outputSection.parentNode.insertBefore(filtersEl, outputSection)
        } else {
          // fallback: append to main
          const main = document.querySelector('main')
          if (main) main.appendChild(filtersEl)
        }
        filtersEl.classList.add('hidden')
      } else if (filtersEl) {
        filtersEl.classList.add('hidden')
      }
    } catch (e) {
      console.debug('move filters back failed', e)
      if (filtersEl) filtersEl.classList.add('hidden')
    }
    // render markdown to HTML for a nicer readme display
    out.innerHTML = `<div class="readme">${mdToHtml(text)}</div>`
    // After rendering, intercept internal anchor clicks so we scroll inside
    // the `.readme` container (anchors reference IDs inside the markup).
    try {
      const readmeEl = out.querySelector('.readme')
      if (readmeEl) {
        readmeEl.addEventListener('click', (ev) => {
          const a = ev.target && (ev.target.closest ? ev.target.closest('a') : (ev.target.tagName === 'A' ? ev.target : null))
          if (!a) return
          const href = a.getAttribute('href')
          if (!href) return
          if (href.startsWith('#')) {
            ev.preventDefault()
            const id = href.replace(/^#/, '')
            const target = readmeEl.querySelector('#' + CSS.escape(id))
            if (target) {
              target.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }
          }
        })
      }
    } catch (e) {
      console.debug('readme anchor handler not attached', e)
    }
  } catch (err) {
    out.classList.remove('hidden')
    if (filtersEl) filtersEl.classList.add('hidden')
    out.innerHTML = `<div class="readme">${escapeHtml(String(err))}</div>`
  }
}

// Minimal Markdown -> HTML renderer for README.md
function mdToHtml(md) {
  if (!md) return ''
  // Protect code blocks so we don't HTML-escape quotes inside them.
  // 1) Extract fenced code blocks and replace with placeholders
  const codeBlocks = []
  const placeholderPrefix = '__CODEBLOCK_'
  // capture optional language after the opening backticks (e.g. ```json) and
  // store both language and code so we can add a language class when restoring.
  let tmp = String(md).replace(/```(?:\s*([a-zA-Z0-9_-]+))?\n([\s\S]*?)```/g, (m, lang, code) => {
    const id = placeholderPrefix + codeBlocks.length + '__'
    codeBlocks.push({ lang: lang ? String(lang).toLowerCase() : null, code })
    return id
  })

  // 2) Escape the remaining markdown (so headings/lists/links are safe)
  let s = escapeHtml(tmp)

  // 3) Restore code blocks as <pre><code> but only escape <,> and & so quotes remain visible
  codeBlocks.forEach((blk, i) => {
    const code = blk && blk.code != null ? String(blk.code) : ''
    const lang = blk && blk.lang ? String(blk.lang).toLowerCase() : null
    const safe = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const id = placeholderPrefix + i + '__'
    const cls = lang === 'json' ? ' class="lang-json"' : ''
    s = s.replace(new RegExp(id.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g'), `<pre><code${cls}>${safe}</code></pre>`)
  })

  // 4) Horizontal rules: convert lines with only `---` into <hr/>
  s = s.replace(/(^|\n)---\s*(?=\n|$)/g, '$1<hr/>\n')

  // helper: create an id/slug from heading text
  const slugify = (t) => {
    // unescape common HTML entities first so slugs are readable/stable
    const decoded = String(t).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    return decoded.toLowerCase()
      .trim()
      .replace(/\s+/g, '-')           // spaces -> hyphens
      .replace(/[^a-z0-9\-]/g, '')    // remove non-alphanum/hyphen
      .replace(/-+/g, '-')            // collapse multiple hyphens
      .replace(/^-|-$/g, '')          // trim leading/trailing hyphens
  }

  // (code blocks already restored from placeholders)

  // headings: include id attributes so anchor links work inside the readme
  // support h1..h6 so deeper subsections (e.g. #### Search Box) receive ids
  s = s.replace(/^###### (.*)$/gm, (m, h) => {
    const id = slugify(h)
    return `<h6 id="${id}">${h}</h6>`
  })
  s = s.replace(/^##### (.*)$/gm, (m, h) => {
    const id = slugify(h)
    return `<h5 id="${id}">${h}</h5>`
  })
  s = s.replace(/^#### (.*)$/gm, (m, h) => {
    const id = slugify(h)
    return `<h4 id="${id}">${h}</h4>`
  })
  s = s.replace(/^### (.*)$/gm, (m, h) => {
    const id = slugify(h)
    return `<h3 id="${id}">${h}</h3>`
  })
  s = s.replace(/^## (.*)$/gm, (m, h) => {
    const id = slugify(h)
    return `<h2 id="${id}">${h}</h2>`
  })
  s = s.replace(/^# (.*)$/gm, (m, h) => {
    const id = slugify(h)
    return `<h1 id="${id}">${h}</h1>`
  })

  // bold/italic
  s = s.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/\*(.*?)\*/g, '<em>$1</em>')

  // inline code
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>')

  // links [text](url) — render internal hash links without target so we can
  // intercept them and scroll the readme container; external links open
  // in the system browser.
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, text, url) => {
    if (String(url).startsWith('#')) {
      return `<a href="${url}">${text}</a>`
    }
    return `<a href="${url}" target="_blank" rel="noopener">${text}</a>`
  })

  // unordered lists (support nested lists via indentation)
  // Parse contiguous groups of lines that start with `- ` or `* ` and convert
  // them into nested <ul>/<li> structures based on leading space indentation.
  s = s.replace(/(^|\n)((?:[ \t]*[-\*] .+(?:\n|$))+)/g, (m, g1, block) => {
    const lines = block.split(/\n/).filter(l => l.trim().length > 0)
    let out = ''
    const stack = [] // indentation stack (numbers)

    lines.forEach((line) => {
      const parts = line.match(/^([ \t]*)([-\*]) (.*)$/)
      if (!parts) return
      // normalize tabs to 4 spaces for counting
      const indent = parts[1].replace(/\t/g, '    ').length
      const text = parts[3]

      if (stack.length === 0) {
        // open first list
        out += '<ul>'
        stack.push(indent)
        out += '<li>' + text
        return
      }

      const top = stack[stack.length - 1]
      if (indent > top) {
        // deeper level -> open new nested ul
        out += '<ul><li>' + text
        stack.push(indent)
        return
      }

      if (indent === top) {
        // same level -> close previous li, start new
        out += '</li><li>' + text
        return
      }

      // indent < top: close levels until we reach the correct depth
      while (stack.length && indent < stack[stack.length - 1]) {
        out += '</li></ul>'
        stack.pop()
      }
      // now either same level or new level
      if (stack.length && indent === stack[stack.length - 1]) {
        out += '</li><li>' + text
      } else {
        // treat as new nested list if indent differs
        out += '<ul><li>' + text
        stack.push(indent)
      }
    })

    // close any remaining open lists
    while (stack.length) {
      out += '</li></ul>'
      stack.pop()
    }

    return g1 + out
  })

  // paragraphs: group non-block lines into <p>
  const blocks = s.split(/\n{2,}/).map(b => b.trim()).filter(Boolean)
  return blocks.map(b => {
    if (/^<(h[1-6]|pre|ul|ol|blockquote)/.test(b)) return b
    return '<p>' + b.replace(/\n/g, '<br/>') + '</p>'
  }).join('\n')
}

function renderFindings(data) {
  currentFindings = data.findings || []
  const out = document.getElementById('output')
  const filtersEl = document.getElementById('filters')
  out.innerHTML = ''

  // Only treat this as a "loaded" dataset when there's at least one finding present.
  if (data && Array.isArray(data.findings) && data.findings.length > 0) {
    lastLoadedData = { image: data.image || null, scan_date: data.scan_date || null, total_vulnerabilities: (data && data.total_vulnerabilities) ? data.total_vulnerabilities : null }
  }

  const filtered = filterFindings(currentFindings)
  // reset navigation index whenever we re-render the findings list
  try { if (virtualState) virtualState.navIndex = null } catch (e) { }

  // If we have never loaded any findings (no lastLoadedData), keep the output hidden
  // If we have never loaded any findings (no lastLoadedData), show the README help instead
  if (!lastLoadedData && (!currentFindings || currentFindings.length === 0)) {
    loadReadmeIntoOutput()
    return
  }

  // reveal output; we'll move the `#filters` element into the output panel
  // so it appears directly under the meta info.
  out.classList.remove('hidden')

  // render meta using the last loaded image info if available
  const meta = document.createElement('div')
  meta.className = 'meta'
  let imageDisplay = 'n/a'
  const imageSrc = (data && data.image && data.image.name) ? data.image : (lastLoadedData ? lastLoadedData.image : null)
  if (imageSrc && imageSrc.name) {
    imageDisplay = imageSrc.name
    if (imageSrc.version) imageDisplay = `${imageDisplay}:${imageSrc.version}`
  }
  // Use the provided total_vulnerabilities counts directly (no counting fallback)
  const totals = (data && data.total_vulnerabilities) ? data.total_vulnerabilities : {}
  const criticalCount = Number(totals.critical || 0)
  const highCount = Number(totals.high || 0)
  const mediumCount = Number(totals.medium || 0)
  const lowCount = Number(totals.low || 0)
  const infoCount = Number(totals.info || 0)
  const unknownCount = Number(totals.unknown || 0)

  meta.innerHTML = `<strong>Image:</strong> ${imageDisplay} — <strong>Vulnerabilities:</strong> <strong>Critical:</strong> ${criticalCount} <strong>High:</strong> ${highCount} <strong>Medium:</strong> ${mediumCount} <strong>Low:</strong> ${lowCount} <strong>Info:</strong> ${infoCount} <strong>Unknown:</strong> ${unknownCount}`
  out.appendChild(meta)

  // Move the filters element into the output panel so it displays directly
  // beneath the meta information. This physically moves the node in the DOM
  // (preserving IDs and event handlers wired by `setupFilters`). If the
  // filters element isn't present, this is a no-op.
  try {
    if (filtersEl) {
      filtersEl.classList.remove('hidden')
      // place filters inside the meta container so it sits inline with the
      // image/vulnerability summary and can be right-aligned by CSS
      meta.appendChild(filtersEl)
    }
  } catch (e) {
    console.debug('failed to move filters into output', e)
  }

  if (!filtered || filtered.length === 0) {
    const msg = document.createElement('div')
    msg.className = 'loading'
    msg.textContent = 'No vulnerabilities to display. Load an Xray vulnerabilities JSON file (use Open or Load).'
    out.appendChild(msg)
    return
  }

  // We'll render the header table fixed and the body table inside the
  // scrollable `.findings-container` to avoid `position:sticky` issues in some
  // webviews (Tauri on some platforms). Use a shared `colgroup` to align columns.
  const colgroupHtml = `
    <colgroup>
      <col style="width:12%" />
      <col style="width:16%" />
      <col style="width:10%" />
      <col style="width:24%" />
      <col style="width:20%" />
      <col style="width:18%" />
    </colgroup>`

  const headerTable = document.createElement('table')
  headerTable.className = 'findings-head'
  headerTable.innerHTML = colgroupHtml + `
    <thead>
      <tr>
        <th data-sort="severity" data-title="Severity">Severity</th>
        <th data-sort="cves" data-title="CVEs">CVEs</th>
        <th data-title="Score">Score</th>
        <th data-sort="package" data-title="Package">Package</th>
        <th data-title="Version">Version</th>
        <th data-title="Fix">Fix</th>
      </tr>
    </thead>`

  // Virtualized list: render only visible rows into an overlay table while
  // keeping a tall spacer to provide correct scroll height. We'll auto-
  // detect row height from a sample row and preserve the visible item
  // index/position across re-renders.
  const rowHeightFallback = 44 // pixels per row when auto-detection fails
  const overscan = 6 // number of rows to render above/below viewport

  const rows = sortFindings(filtered)

  // capture previous visible first index if we rendered earlier
  let prevFirstIndex = 0
  if (virtualState && virtualState.wrap && virtualState.rowHeight) {
    try {
      const prevScroll = virtualState.wrap.scrollTop || 0
      prevFirstIndex = Math.max(0, Math.floor(prevScroll / virtualState.rowHeight))
    } catch (e) { prevFirstIndex = 0 }
    // remove previous handlers to avoid duplicates
    try { virtualState.wrap.removeEventListener('scroll', virtualState.scrollHandler) } catch (e) { }
    try { if (virtualState.resizeHandler) window.removeEventListener('resize', virtualState.resizeHandler) } catch (e) { }
  }

  // Auto-detect row height by rendering a single sample row off-screen.
  let rowHeight = rowHeightFallback
  try {
    if (rows && rows.length > 0) {
      const sample = rows[Math.min(prevFirstIndex, rows.length - 1)]
      const tmpTable = document.createElement('table')
      tmpTable.style.position = 'absolute'
      tmpTable.style.visibility = 'hidden'
      tmpTable.style.left = '-9999px'
      tmpTable.innerHTML = colgroupHtml + `<tbody><tr>
        <td class="severity">${sample.severity || ''}</td>
        <td>${(sample.cves || []).join(', ')}</td>
        <td>${sample.cvss_score ?? ''}</td>
        <td>${sample.package?.name || sample.component || ''}</td>
        <td>${sample.package?.version || ''}</td>
        <td>${sample.fix_available ? (sample.fixed_version || 'available') : 'none'}</td>
      </tr></tbody>`
      document.body.appendChild(tmpTable)
      const tr = tmpTable.querySelector('tr')
      if (tr) {
        const h = tr.getBoundingClientRect().height
        if (h && Number.isFinite(h)) rowHeight = Math.max(16, Math.round(h))
      }
      tmpTable.remove()
    }
  } catch (e) {
    console.debug('rowHeight detection failed, using fallback', e)
    rowHeight = rowHeightFallback
  }

  // outer container holds the header (fixed) and a relative-positioned
  // scrollable area for the virtual list.
  const findingsWrap = document.createElement('div')
  findingsWrap.className = 'findings-container'
  findingsWrap.style.position = 'relative'
  findingsWrap.style.overflow = 'auto'
  // store detected rowHeight for future renders
  findingsWrap.dataset.rowHeight = String(rowHeight)

  // spacer provides the full scrollable height
  const spacer = document.createElement('div')
  spacer.style.height = Math.max(0, rows.length * rowHeight) + 'px'

  // overlay table will be absolutely positioned inside the scroll area and
  // translated vertically to the start index*rowHeight
  const overlay = document.createElement('div')
  overlay.style.position = 'absolute'
  overlay.style.top = '0'
  overlay.style.left = '0'
  overlay.style.right = '0'
  overlay.style.pointerEvents = 'none' // allow scroll events to pass through

  const overlayTable = document.createElement('table')
  overlayTable.className = 'findings'
  overlayTable.style.pointerEvents = 'auto' // rows should be interactive
  overlayTable.innerHTML = colgroupHtml
  const overlayTbody = document.createElement('tbody')
  overlayTable.appendChild(overlayTbody)
  overlay.appendChild(overlayTable)

  // append header and virtual list container
  out.appendChild(headerTable)
  findingsWrap.appendChild(spacer)
  findingsWrap.appendChild(overlay)
  out.appendChild(findingsWrap)

  // render function for visible window
  function renderWindow() {
    const height = findingsWrap.clientHeight || 300
    const scrollTop = findingsWrap.scrollTop || 0
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
    const visibleCount = Math.ceil(height / rowHeight) + overscan * 2
    const end = Math.min(rows.length, start + visibleCount)

    // clear and populate overlay tbody
    overlayTbody.innerHTML = ''
    for (let i = start; i < end; i++) {
      const f = rows[i]
      const tr = document.createElement('tr')
      // expose the global index for keyboard navigation and accessibility
      tr.dataset.index = String(i)
      const sev = (f.severity || '').toLowerCase()
      tr.innerHTML = `
        <td class="severity ${sev}">${f.severity || ''}</td>
        <td>${(f.cves || []).join(', ')}</td>
        <td>${f.cvss_score ?? ''}</td>
        <td>${f.package?.name || f.component || ''}</td>
        <td>${f.package?.version || ''}</td>
        <td>${f.fix_available ? (f.fixed_version || 'available') : 'none'}</td>
      `
      tr.classList.add('clickable-row')
      tr.setAttribute('role', 'button')
      tr.tabIndex = 0
      tr.setAttribute('aria-selected', 'false')
      tr.setAttribute('aria-label', `${f.severity || ''} ${f.package?.name || f.component || ''}`)
      // wire events on the rendered row
      tr.addEventListener('click', () => showFindingDetail(f))
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showFindingDetail(f) }
      })
      tr.addEventListener('focus', () => tr.setAttribute('aria-selected', 'true'))
      tr.addEventListener('blur', () => tr.setAttribute('aria-selected', 'false'))
      overlayTbody.appendChild(tr)
    }

    // position overlayTable to match the start index
    overlay.style.transform = `translateY(${start * rowHeight}px)`
  }

  // attach scroll and resize handlers (avoid duplicates)
  let renderRaf = null
  const onScroll = () => {
    if (renderRaf) cancelAnimationFrame(renderRaf)
    renderRaf = requestAnimationFrame(() => { renderWindow(); renderRaf = null })
  }
  findingsWrap.addEventListener('scroll', onScroll)
  window.addEventListener('resize', onScroll)

  // restore previous scroll position (by index) if available
  try {
    if (typeof prevFirstIndex === 'number' && prevFirstIndex > 0) {
      const maxTop = Math.max(0, rows.length * rowHeight - (findingsWrap.clientHeight || 300))
      findingsWrap.scrollTop = Math.min(maxTop, prevFirstIndex * rowHeight)
    }
  } catch (e) { /* ignore */ }

  // store handlers and wrap in virtualState for next render
  virtualState.wrap = findingsWrap
  virtualState.rowHeight = rowHeight
  virtualState.scrollHandler = onScroll
  virtualState.resizeHandler = onScroll

  // initial render
  renderWindow()

  // Debug: log computed heights to help diagnose scrolling/layout issues
  try {
    const os = document.querySelector('.output-section')
    const op = document.querySelector('.output-panel')
    const fc = document.querySelector('.findings-container')
    console.debug('layout-sizes', {
      outputSection: os ? Math.round(os.getBoundingClientRect().height) : null,
      outputPanel: op ? Math.round(op.getBoundingClientRect().height) : null,
      findingsContainer: fc ? Math.round(fc.getBoundingClientRect().height) : null
    })
  } catch (e) {
    // ignore
  }

  // attach header click handlers for sorting and show indicators
  Array.from(headerTable.querySelectorAll('th[data-sort]')).forEach(th => {
    th.style.cursor = 'pointer'
    // store base title
    const base = th.dataset.title || th.textContent
    th.dataset.title = base
    const key = th.getAttribute('data-sort')
    const arrow = sortState.key === key ? (sortState.dir === 1 ? ' ▲' : ' ▼') : ''
    th.innerHTML = base + arrow
    th.onclick = () => {
      if (sortState.key === key) sortState.dir = -sortState.dir
      else { sortState.key = key; sortState.dir = 1 }
      scheduleRender({ image: data.image, scan_date: data.scan_date, findings: currentFindings })
    }
  })
}

// Client-side transformer for `vulnerabilities` -> normalized `{ findings }` shape.
function transformVulnerabilitiesClient(parsed) {
  if (!parsed) return parsed
  if (parsed.findings) return parsed
  if (!parsed.vulnerabilities || !Array.isArray(parsed.vulnerabilities)) return parsed
  let detectedImageName = null
  let detectedImageVersion = null

  // Prefer explicit image_details if provided by the JSON (repository + tag)
  if (parsed.image_details && parsed.image_details.repository) {
    const repo = String(parsed.image_details.repository || '')
    detectedImageName = repo.includes('/') ? repo.split('/').pop() : repo
    detectedImageVersion = parsed.image_details.tag || null
  }

  const findings = parsed.vulnerabilities.map((entry, i) => {
    const id = entry.issueId || `vuln-${i}`
    const severity = entry.severity || ''
    const packageName = entry.impactedPackageName || ''
    const packageVersion = entry.impactedPackageVersion || ''
    const component = (entry.components && entry.components[0] && entry.components[0].name) || ''
    const cves = (entry.cves || []).map(c => c.id).filter(Boolean)
    const cvss_score = entry.cves && entry.cves[0] && entry.cves[0].cvssV3 ? Number(entry.cves[0].cvssV3) : undefined
    let fix_available = false
    let fixed_version = null
    if (entry.fixedVersions) {
      if (Array.isArray(entry.fixedVersions) && entry.fixedVersions.length > 0) {
        fix_available = true
        fixed_version = entry.fixedVersions[0]
      } else if (typeof entry.fixedVersions === 'string' && entry.fixedVersions.trim()) {
        fix_available = true
        fixed_version = entry.fixedVersions
      }
    }
    const description = entry.summary || ''
    const references = entry.references || []
    const path = (entry.impactPaths && Array.isArray(entry.impactPaths) && entry.impactPaths[0] && Array.isArray(entry.impactPaths[0])
      && entry.impactPaths[0].length > 0 && entry.impactPaths[0][entry.impactPaths[0].length - 1].location && entry.impactPaths[0][entry.impactPaths[0].length - 1].location.file)
      ? entry.impactPaths[0][entry.impactPaths[0].length - 1].location.file
      : ''

    const metadata = {
      impactedPackageType: entry.impactedPackageType || null,
      jfrog: entry.jfrogResearcInformation || null,
      impact_paths: entry.impactPaths || null
    }

    return {
      id,
      severity,
      package: { name: packageName, version: packageVersion },
      component,
      cves,
      cvss_score,
      fix_available,
      fixed_version,
      description,
      references,
      path,
      metadata
    }
  })

  // If image_details wasn't present, try to detect image info from impactPaths
  if (!detectedImageName) {
    for (const entry of (parsed.vulnerabilities || [])) {
      if (entry.impactPaths && Array.isArray(entry.impactPaths)) {
        let found = false
        for (const seq of entry.impactPaths) {
          if (!Array.isArray(seq)) continue
          for (const el of seq) {
            if (el && el.name && typeof el.name === 'string') {
              const parts = el.name.split('/')
              detectedImageName = parts.length ? parts[parts.length - 1] : el.name
              if (el.version) detectedImageVersion = el.version
              found = true
              break
            }
          }
          if (found) break
        }
        if (found) break
      }
    }
  }

  const image = detectedImageName ? { name: detectedImageName, version: detectedImageVersion || null } : null

  return { image, scan_date: null, findings }
}

// wire up filter controls
function setupFilters() {
  const openBtn = document.getElementById('openFilters')
  const clear = document.getElementById('clearFilters')
  const modal = document.getElementById('filtersModal')
  const modalSeverityChecks = modal ? Array.from(modal.querySelectorAll('.modalSeverityChk')) : []
  const modalShowAll = document.getElementById('modalShowAll')
  const modalFix = document.getElementById('modalFixOnly')
  const modalQ = document.getElementById('modalQ')
  const modalApply = document.getElementById('modalApply')
  const modalReset = document.getElementById('modalReset')
  const modalResetShowAll = document.getElementById('modalResetShowAll')
  const modalResetFix = document.getElementById('modalResetFix')
  const modalResetQ = document.getElementById('modalResetQ')
  const modalSearchMode = document.getElementById('modalSearchMode')
  const modalSearchHint = document.getElementById('searchModeHint')

  function updateSearchModeHint(mode) {
    try {
      const m = mode || (modalSearchMode && modalSearchMode.value) || 'literal'
      if (!modalSearchHint) return
      if (m === 'fuzzy') {
        modalSearchHint.innerHTML = `Fuzzy mode performs subsequence matching (matches letters in order, e.g. <code>opns</code> → <code>openssl</code>) and is useful for quick, tolerant lookups.`
      } else if (m === 'regex') {
        modalSearchHint.innerHTML = `Regex mode treats each token as a regular expression (case-insensitive). Use with care — invalid expressions will be rejected when you apply.`
      } else {
        modalSearchHint.innerHTML = `Literal mode treats tokens as plain text and matches substrings exactly; enable fuzzy or regex for alternative behaviours.`
      }
    } catch (e) { /* ignore */ }
  }
  const modalWhitelist = document.getElementById('modalWhitelist')
  const modalBlacklist = document.getElementById('modalBlacklist')
  // preset UI elements
  const presetNameInput = document.getElementById('presetName')
  const savePresetBtn = document.getElementById('savePresetBtn')
  const presetsList = document.getElementById('presetsList')
  const loadPresetBtn = document.getElementById('loadPresetBtn')
  const deletePresetBtn = document.getElementById('deletePresetBtn')

  function showFiltersModal() {
    if (!modal) return
    // populate fields from current filterState
    if (modalShowAll) modalShowAll.checked = !!filterState.showAll
    if (modalSeverityChecks && modalSeverityChecks.length) {
      modalSeverityChecks.forEach(chk => {
        const v = String(chk.value || '').toLowerCase()
        chk.checked = !!(filterState.severities && filterState.severities[v])
        // disable checkboxes when Show All is ON
        chk.disabled = !!(modalShowAll && modalShowAll.checked)
      })
    }
    if (modalFix) modalFix.checked = !!filterState.fixOnly
    if (modalQ) modalQ.value = filterState.q || ''
    if (modalSearchMode) {
      modalSearchMode.value = filterState.searchMode || 'literal'
      updateSearchModeHint(modalSearchMode.value)
    }
    // populate whitelist/ignore from persisted storage (or leave modal values as-is)
    try {
      const raw = localStorage.getItem('filter_rules')
      if (raw) {
        const parsed = JSON.parse(raw)
        if (modalWhitelist) modalWhitelist.value = (parsed.whitelist || []).join('\n')
        if (modalBlacklist) modalBlacklist.value = (parsed.ignore || []).join('\n')
      }
    } catch (e) { /* ignore */ }
    // populate presets list
    try { populatePresetsList() } catch (e) { console.debug('populatePresetsList failed', e) }
    modal.classList.remove('hidden')
    modal.setAttribute('aria-hidden', 'false')
    const first = modal.querySelector('#modalShowAll') || modal.querySelector('.modalSeverityChk') || modal.querySelector('input')
    if (first) first.focus()
    // attach focus-trap + Escape-to-close for accessibility
    try { attachModalAccessibility(modal, hideFiltersModal) } catch (e) { /* ignore */ }
  }

  function hideFiltersModal() {
    if (!modal) return
    modal.classList.add('hidden')
    modal.setAttribute('aria-hidden', 'true')
    try { detachModalAccessibility(modal) } catch (e) { /* ignore */ }
  }

  function applyFiltersFromModal() {
    // read Show All state
    if (modalShowAll) {
      filterState.showAll = !!modalShowAll.checked
    }

    // if Show All is ON, do not use the checkbox values — leave severities as-is
    if (!filterState.showAll) {
      // read selected severities into the filterState.severities map
      if (modalSeverityChecks && modalSeverityChecks.length) {
        const map = { critical: false, high: false, medium: false, low: false, info: false, unknown: false }
        modalSeverityChecks.forEach(chk => { map[String(chk.value).toLowerCase()] = !!chk.checked })
        // if none selected, require user to choose or re-enable Show All
        const any = Object.values(map).some(Boolean)
        if (!any) {
          showToast('No severity selected — select at least one severity or turn "Show All" back on.', 'error', 5000)
          return
        }
        filterState.severities = map
      }
    }
    if (modalFix) filterState.fixOnly = !!modalFix.checked
    if (modalQ) filterState.q = modalQ.value || ''
    if (modalSearchMode) filterState.searchMode = modalSearchMode.value || 'literal'

    // Precompile regex tokens for performance when Regex mode is enabled.
    // Build token objects first and then either compile a single combined
    // RegExp (when no fielded tokens are present) using lookaheads to
    // require all tokens, or compile a per-token RegExp array when fielded
    // tokens exist.
    filterState._compiledRegex = null
    filterState._tokenObjs = null
    if ((filterState.searchMode === 'regex') && filterState.q) {
      const rawTokens = String(filterState.q).split(/\s+/).filter(Boolean)
      const tokenObjs = rawTokens.map(tok => {
        if (tok.includes(':')) {
          const parts = tok.split(':')
          const field = (parts.shift() || '').toLowerCase()
          const value = parts.join(':')
          return { raw: tok, field, value }
        }
        return { raw: tok, field: null, value: tok }
      })
      try {
        const hasFielded = tokenObjs.some(t => !!t.field)
        if (!hasFielded) {
          // Combine tokens into a single RegExp that asserts all tokens exist
          // somewhere in the target string (AND semantics) using lookaheads.
          const lookaheads = tokenObjs.map(t => `(?=.*(?:${(filterState.searchMode === 'literal') ? escapeForRegex(t.value) : t.value}))`).join('')
          filterState._compiledRegex = { type: 'single', re: new RegExp(lookaheads, 'i') }
        } else {
          // Compile each token value individually and keep field info
          const arr = tokenObjs.map(t => ({ field: t.field, re: new RegExp((filterState.searchMode === 'literal') ? escapeForRegex(t.value) : t.value, 'i') }))
          filterState._compiledRegex = { type: 'array', arr }
        }
        filterState._tokenObjs = tokenObjs
      } catch (e) {
        filterState._compiledRegex = null
        filterState._tokenObjs = null
        showToast('Invalid regex: ' + (e.message || e), 'error', 4500)
        return
      }
    }
    if (!currentFindings || currentFindings.length === 0) {
      loadReadmeIntoOutput()
      hideFiltersModal()
      return
    }
    // Read whitelist / ignore rules from modal, compile into rule objects and persist
    try {
      const wlText = modalWhitelist ? (modalWhitelist.value || '') : ''
      const igText = modalBlacklist ? (modalBlacklist.value || '') : ''
      const whitelist = wlText.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
      const ignore = igText.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
      // compile into lightweight rule objects and attach to filterState
      const compileRuleLine = (line) => {
        if (!line) return { type: 'invalid', raw: line }
        // explicit regex syntax: /.../
        if (line.startsWith('/') && line.endsWith('/') && line.length > 1) {
          try { return { type: 'regex', raw: line, re: new RegExp(line.slice(1, -1), 'i') } } catch (e) { return { type: 'invalid', raw: line } }
        }
        const m = line.match(/^([a-zA-Z0-9_\-]+):(.*)$/)
        if (m) {
          const field = m[1].toLowerCase()
          const val = m[2]
          if (filterState.searchMode === 'regex') {
            try { return { type: 'field_regex', raw: line, field, re: new RegExp(val, 'i') } } catch (e) { return { type: 'invalid', raw: line } }
          }
          return { type: 'field_literal', raw: line, field, val }
        }
        if (filterState.searchMode === 'regex') {
          try { return { type: 'regex', raw: line, re: new RegExp(line, 'i') } } catch (e) { return { type: 'invalid', raw: line } }
        }
        return { type: 'literal', raw: line, val: line }
      }
      filterState._rules = { whitelist: whitelist.map(compileRuleLine), ignore: ignore.map(compileRuleLine) }
      try { localStorage.setItem('filter_rules', JSON.stringify({ whitelist, ignore })) } catch (e) { /* ignore */ }
    } catch (e) { console.debug('compile rules failed', e) }
    scheduleRender({ image: lastLoadedData?.image || null, scan_date: lastLoadedData?.scan_date || null, total_vulnerabilities: lastLoadedData?.total_vulnerabilities || null, findings: currentFindings })
    hideFiltersModal()
  }

  function resetModal() {
    // reset Show All to default (ON) and severities to all checked
    if (modalShowAll) modalShowAll.checked = true
    if (modalSeverityChecks && modalSeverityChecks.length) {
      modalSeverityChecks.forEach(chk => { chk.checked = false; chk.disabled = true })
    }
    if (modalFix) modalFix.checked = false
    if (modalQ) modalQ.value = ''
    if (modalSearchMode) modalSearchMode.value = 'literal'
    // clear whitelist / ignore textareas
    if (modalWhitelist) modalWhitelist.value = ''
    if (modalBlacklist) modalBlacklist.value = ''
    // clear any previously compiled regex tokens (they only live on Apply)
    filterState._compiledRegex = null
    filterState._tokenObjs = null
    // clear compiled/persisted rules
    try { filterState._rules = { whitelist: [], ignore: [] }; localStorage.removeItem('filter_rules') } catch (e) { /* ignore */ }
  }

  // Preset persistence helper: store presets under localStorage key 'filter_presets'
  function _readPresets() {
    try {
      const raw = localStorage.getItem('filter_presets')
      if (!raw) return {}
      return JSON.parse(raw) || {}
    } catch (e) { console.debug('readPresets error', e); return {} }
  }
  function _writePresets(obj) {
    try { localStorage.setItem('filter_presets', JSON.stringify(obj)) } catch (e) { console.debug('writePresets error', e) }
  }

  function savePreset(name) {
    if (!name) { showToast('Preset name required', 'error'); return }
    const presets = _readPresets()
    // clone current modal values into a preset snapshot
    const preset = {
      showAll: !!(modalShowAll && modalShowAll.checked),
      severities: {},
      fixOnly: !!(modalFix && modalFix.checked),
      q: modalQ ? modalQ.value || '' : '',
      searchMode: (modalSearchMode && modalSearchMode.value) ? modalSearchMode.value : 'literal'
    }
    if (modalSeverityChecks && modalSeverityChecks.length) modalSeverityChecks.forEach(chk => { preset.severities[String(chk.value).toLowerCase()] = !!chk.checked })
    presets[name] = preset
    _writePresets(presets)
    populatePresetsList()
    showToast('Preset saved', 'info', 2000)
  }

  function deletePreset(name) {
    if (!name) return
    const presets = _readPresets()
    if (!presets[name]) { showToast('Preset not found', 'error'); return }
    delete presets[name]
    _writePresets(presets)
    populatePresetsList()
    showToast('Preset deleted', 'info', 2000)
  }

  function populatePresetsList() {
    if (!presetsList) return
    const presets = _readPresets()
    // clear
    presetsList.innerHTML = ''
    const names = Object.keys(presets).sort()
    const empty = document.createElement('option')
    empty.value = ''
    empty.textContent = names.length ? 'Select a preset…' : 'No saved presets'
    presetsList.appendChild(empty)
    names.forEach(n => {
      const o = document.createElement('option')
      o.value = n
      o.textContent = n
      presetsList.appendChild(o)
    })
  }

  function loadPreset(name) {
    if (!name) { showToast('Select a preset to load', 'error'); return }
    const presets = _readPresets()
    const p = presets[name]
    if (!p) { showToast('Preset not found', 'error'); return }
    // apply into modal controls (but don't apply to global filterState until user clicks Apply)
    if (modalShowAll) modalShowAll.checked = !!p.showAll
    if (modalSeverityChecks && modalSeverityChecks.length) {
      modalSeverityChecks.forEach(chk => { const v = String(chk.value).toLowerCase(); chk.checked = !!(p.severities && p.severities[v]); chk.disabled = !!(modalShowAll && modalShowAll.checked) })
    }
    if (modalFix) modalFix.checked = !!p.fixOnly
    if (modalQ) modalQ.value = p.q || ''
    if (modalSearchMode) { modalSearchMode.value = p.searchMode || 'literal'; updateSearchModeHint(modalSearchMode.value) }
    if (presetNameInput) presetNameInput.value = name
    showToast('Preset loaded into modal (click Apply to activate)', 'info', 2500)
  }

  // wire preset buttons
  if (savePresetBtn) savePresetBtn.addEventListener('click', () => savePreset((presetNameInput && presetNameInput.value) || ''))
  if (loadPresetBtn) loadPresetBtn.addEventListener('click', () => { if (presetsList) loadPreset(presetsList.value) })
  if (deletePresetBtn) deletePresetBtn.addEventListener('click', () => {
    if (presetsList && presetsList.value) {
      if (confirm && confirm(`Delete preset "${presetsList.value}"?`)) deletePreset(presetsList.value)
    }
  })
  if (presetsList) presetsList.addEventListener('change', () => { /* auto-select doesn't auto-load; user clicks Load */ })

  // per-control reset handlers
  if (modalResetShowAll) {
    modalResetShowAll.addEventListener('click', () => {
      if (modalShowAll) modalShowAll.checked = true
      if (modalSeverityChecks && modalSeverityChecks.length) modalSeverityChecks.forEach(chk => { chk.checked = false; chk.disabled = true })
    })
  }
  if (modalResetFix) {
    modalResetFix.addEventListener('click', () => {
      if (modalFix) modalFix.checked = false
    })
  }
  if (modalResetQ) {
    modalResetQ.addEventListener('click', () => {
      if (modalQ) { modalQ.value = ''; modalQ.focus() }
    })
  }

  // modalSearchMode is a select; wire change handler to update hint live.
  if (modalSearchMode) {
    modalSearchMode.addEventListener('change', (e) => { updateSearchModeHint(e.target.value) })
  }

  if (openBtn) openBtn.addEventListener('click', showFiltersModal)
  if (modalApply) modalApply.addEventListener('click', applyFiltersFromModal)
  if (modalReset) modalReset.addEventListener('click', resetModal)
  if (modal) {
    const closeBtn = modal.querySelector('[data-close]')
    if (closeBtn) closeBtn.addEventListener('click', hideFiltersModal)
    const overlay = modal.querySelector('[data-overlay]')
    if (overlay) overlay.addEventListener('click', hideFiltersModal)
  }

  if (modalQ) modalQ.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyFiltersFromModal() })

  // When Show All toggle changes, enable/disable the severity checkboxes
  if (modalShowAll) {
    modalShowAll.addEventListener('change', (e) => {
      const on = !!e.target.checked
      if (modalSeverityChecks && modalSeverityChecks.length) modalSeverityChecks.forEach(c => c.disabled = on)
    })
  }

  if (clear) clear.addEventListener('click', () => {
    filterState.severities = { critical: false, high: false, medium: false, low: false, info: false, unknown: false }
    filterState.fixOnly = false
    filterState.showAll = true
    filterState.q = ''
    filterState.searchMode = 'literal'
    filterState._compiledRegex = null
    // clear whitelist/ignore rules and persisted copy
    try {
      filterState._rules = { whitelist: [], ignore: [] }
      localStorage.removeItem('filter_rules')
    } catch (e) { /* ignore */ }
    // clear modal textareas if present
    try { if (modalWhitelist) modalWhitelist.value = ''; if (modalBlacklist) modalBlacklist.value = '' } catch (e) { /* ignore */ }
    if (!currentFindings || currentFindings.length === 0) {
      loadReadmeIntoOutput()
      return
    }
    scheduleRender({ image: lastLoadedData?.image || null, scan_date: lastLoadedData?.scan_date || null, total_vulnerabilities: lastLoadedData?.total_vulnerabilities || null, findings: currentFindings })
  })

  // Initialize persisted rules (compile into simple rule objects) so stored
  // whitelist/ignore take effect immediately without opening the modal.
  try {
    const raw = localStorage.getItem('filter_rules')
    if (raw) {
      const parsed = JSON.parse(raw)
      const whitelist = (parsed.whitelist || [])
      const ignore = (parsed.ignore || [])
      const compileSimple = (line) => {
        if (!line) return { type: 'invalid', raw: line }
        if (line.startsWith('/') && line.endsWith('/') && line.length > 1) {
          try { return { type: 'regex', raw: line, re: new RegExp(line.slice(1, -1), 'i') } } catch (e) { return { type: 'invalid', raw: line } }
        }
        const m = line.match(/^([a-zA-Z0-9_\-]+):(.*)$/)
        if (m) return { type: 'field_literal', raw: line, field: m[1].toLowerCase(), val: m[2] }
        return { type: 'literal', raw: line, val: line }
      }
      filterState._rules = { whitelist: whitelist.map(compileSimple), ignore: ignore.map(compileSimple) }
    }
  } catch (e) { /* ignore */ }
}

// TODO: Detail view for selected finding
// - allow clicking a row to open a modal/panel showing full finding details
// - include description, references, CVSS vector, component path, and metadata
// This is tracked as a follow-up task.

// Detail modal implementation
function ensureDetailModal() {
  if (document.getElementById('detailModal')) return
  const modal = document.createElement('div')
  modal.id = 'detailModal'
  modal.className = 'detail-modal hidden'
  modal.innerHTML = `
    <div class="overlay" data-overlay></div>
    <div class="detail-panel" role="dialog" aria-modal="true" aria-labelledby="detailTitle">
      <header>
        <h2 id="detailTitle">Finding</h2>
        <div>
          <button class="detail-close" data-close aria-label="Close details">
            <img data-themed="true" data-icon="close" src="assets/icons/close-dark.svg" alt="Close" />
          </button>
        </div>
      </header>
      <div class="detail-body" data-body></div>
    </div>`
  document.body.appendChild(modal)

  // Ensure any themed icons inside the newly-created modal use the
  // build-resolved asset URLs (ICON_MAP) so they load correctly in the
  // packaged app.
  try {
    const theme = getSavedTheme()
    Array.from(modal.querySelectorAll('img[data-themed="true"]')).forEach(img => {
      const name = img.dataset.icon
      if (!name) return
      const mapped = ICON_MAP[name] && ICON_MAP[name][theme]
      if (mapped) img.src = mapped
    })
  } catch (e) {
    // ignore if ICON_MAP or getSavedTheme aren't available for any reason
  }

  // events
  modal.querySelector('[data-overlay]').addEventListener('click', hideFindingDetail)
  modal.querySelector('[data-close]').addEventListener('click', hideFindingDetail)
  // close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) hideFindingDetail()
  })
}

function renderFindingDetailHtml(f) {
  const lines = []
  lines.push(`<div class="section meta-row"><strong>Severity:</strong> ${f.severity || ''} — <strong>Score:</strong> ${f.cvss_score ?? ''}</div>`)
  lines.push(`<div class="section meta-row"><strong>Package:</strong> ${escapeHtml(f.package?.name || f.component || '')} ${f.package?.version ? ' — ' + escapeHtml(f.package.version) : ''}</div>`)
  if (f.path) lines.push(`<div class="section meta-row"><strong>Path:</strong> ${escapeHtml(f.path)}</div>`)
  if (Array.isArray(f.cves) && f.cves.length) lines.push(`<div class="section meta-row"><strong>CVEs:</strong> ${escapeHtml(f.cves.join(', '))}</div>`)
  if (f.description) lines.push(`<div class="section"><strong>Description:</strong><div>${mdToHtml(escapeHtml(f.description))}</div></div>`)
  if (Array.isArray(f.references) && f.references.length) {
    const refs = f.references.map(r => {
      const href = typeof r === 'string' ? r : (r.url || '')
      const label = typeof r === 'string' ? r : (r.name || r.url || '')
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener" class="ref">${escapeHtml(label)}</a>`
    }).join(' ')
    lines.push(`<div class="section refs"><strong>References:</strong><div>${refs}</div></div>`)
  }
  // fallback to showing metadata JSON
  if (f.metadata) lines.push(`<div class="section"><strong>Metadata:</strong><pre style="white-space:pre-wrap; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, monospace">${escapeHtml(JSON.stringify(f.metadata, null, 2))}</pre></div>`)
  return lines.join('\n')
}

function showFindingDetail(f) {
  ensureDetailModal()
  const modal = document.getElementById('detailModal')
  const body = modal.querySelector('[data-body]')
  body.innerHTML = renderFindingDetailHtml(f)
  modal.classList.remove('hidden')
  // set focus to close button for accessibility
  const close = modal.querySelector('[data-close]')
  if (close) close.focus()

  // attach focus-trap + Escape-to-close for accessibility
  try { attachModalAccessibility(modal, hideFindingDetail) } catch (e) { /* ignore */ }

  // Wire up reference links in the modal to open via native handler when possible.
  try {
    Array.from(body.querySelectorAll('a.ref')).forEach(a => {
      a.addEventListener('click', (ev) => {
        ev.preventDefault()
        const href = a.getAttribute('href')
        if (href) openExternal(href)
      })
    })
  } catch (e) {
    // ignore if DOM APIs not available
  }
}

function hideFindingDetail() {
  const modal = document.getElementById('detailModal')
  if (!modal) return
  modal.classList.add('hidden')
  try { detachModalAccessibility(modal) } catch (e) { /* ignore */ }
}

window.addEventListener('DOMContentLoaded', () => {
  setupFilters()
})

// Accessibility: keyboard shortcuts and row navigation
function setupAccessibility() {
  // Idempotent: if we've already attached the handler, do nothing.
  if (window._a11yHandler) return
  // chord state: press 'c' then another key within timeout to trigger chord actions
  let _chordActive = false
  let _chordTimer = null
  const _chordTimeoutMs = 700

  const handler = (e) => {
    // Respect shortcuts toggle: default to enabled when key absent
    try {
      const s = localStorage.getItem('shortcuts_enabled')
      if (s === 'false') return
    } catch (ee) { }
    // ignore if user is typing in an input/textarea/select
    const ae = document.activeElement
    const tag = ae && ae.tagName ? ae.tagName.toLowerCase() : ''
    const isEditing = tag === 'input' || tag === 'textarea' || tag === 'select'

    // If we're in chord-mode, handle the second keypress
    if (_chordActive) {
      const second = e.key
      _chordActive = false
      if (_chordTimer) { clearTimeout(_chordTimer); _chordTimer = null }
      if (!isEditing) {
        // 'c' + 'a' => close all modals
        if (second === 'a') {
          e.preventDefault()
          try { closeAllModals() } catch (err) { console.debug('closeAllModals failed', err) }
          return
        }
        // 'c' + 'f' => reset filters
        else if (second === 'f') {
          e.preventDefault()
          const clearFilters = document.getElementById('clearFilters')
          if (clearFilters) clearFilters.click()
          return
        }
        // 'c' + 'v' => unload findings json
        else if (second === 'v') {
          e.preventDefault()
          const clearLoaded = document.getElementById('clearLoaded')
          if (clearLoaded) clearLoaded.click()
          return
        }
      }
      // if not matched, consume the keypress to avoid accidental actions
      return
    }

    // Arrow navigation for rows
    if (!isEditing && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      const dir = e.key === 'ArrowDown' ? 1 : -1
      try {
        // compute current filtered & sorted rows
        const filtered = filterFindings(currentFindings || [])
        const rows = sortFindings(filtered || [])
        if (!rows || rows.length === 0) return

        const wrap = virtualState && virtualState.wrap
        const rowHeight = virtualState && virtualState.rowHeight

        // initialize nav index to top on first navigation
        if (typeof virtualState.navIndex !== 'number' || virtualState.navIndex === null) {
          virtualState.navIndex = 0
        }

        // move index
        let ni = virtualState.navIndex + dir
        if (ni < 0) ni = 0
        if (ni >= rows.length) ni = rows.length - 1
        virtualState.navIndex = ni

        // remove previous marker
        try { const prev = document.querySelector('.findings tbody tr.focused-row'); if (prev) { prev.classList.remove('focused-row'); prev.removeAttribute('aria-selected') } } catch (e) { }

        // scroll to make index visible (virtualized list)
        if (wrap && rowHeight) {
          const maxTop = Math.max(0, rows.length * rowHeight - (wrap.clientHeight || 300))
          wrap.scrollTop = Math.min(maxTop, Math.max(0, ni * rowHeight))
        }

        // after a short delay (allow virtualized render to complete), mark and focus the row
        setTimeout(() => {
          try {
            const w = virtualState && virtualState.wrap
            const tr = (w && w.querySelector) ? w.querySelector(`.findings tbody tr[data-index='${ni}']`) : document.querySelector(`.findings tbody tr[data-index='${ni}']`)
            if (tr) {
              // ensure the row has a keyboard-focusable tabindex
              try { tr.tabIndex = 0 } catch (e) { }
              tr.classList.add('focused-row')
              tr.setAttribute('aria-selected', 'true')
              try { tr.focus() } catch (e) { }
            }
          } catch (e) { console.debug('navigation focus failed', e) }
        }, 50)
      } catch (e) { console.debug('row navigation failed', e) }
      return
    }

    // Open detail for focused row when Enter/Space pressed
    if (!isEditing && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      try {
        // prefer element marked by our focused-row class
        let tr = document.querySelector('.findings tbody tr.focused-row')
        if (!tr) {
          // fallback: walk up from activeElement
          let a = document.activeElement
          while (a && a !== document.body) {
            if (a.dataset && typeof a.dataset.index !== 'undefined' && a.dataset.index !== '') { tr = a; break }
            a = a.parentElement
          }
        }
        if (tr && tr.dataset && typeof tr.dataset.index !== 'undefined' && tr.dataset.index !== '') {
          const idx = Number(tr.dataset.index)
          if (!Number.isNaN(idx)) {
            try {
              const filtered = filterFindings(currentFindings || [])
              const rows = sortFindings(filtered || [])
              if (rows && rows[idx]) {
                showFindingDetail(rows[idx])
              } else if (typeof currentFindings !== 'undefined' && Array.isArray(currentFindings) && currentFindings[idx]) {
                // fallback: older behavior
                showFindingDetail(currentFindings[idx])
              }
            } catch (err) { console.debug('showFindingDetail failed', err) }
          }
        }
      } catch (err) { console.debug('enter key handler failed', err) }
      return
    }

    if (isEditing) return

    // simple single-key shortcuts
    // start chord prefix 'c' (wait for next key)
    if (e.key === 'c') {
      e.preventDefault()
      _chordActive = true
      if (_chordTimer) clearTimeout(_chordTimer)
      _chordTimer = setTimeout(() => { _chordActive = false; _chordTimer = null }, _chordTimeoutMs)
      return
    }
    if (e.key === '/') {
      // open filters and focus search box
      e.preventDefault()
      const open = document.getElementById('openFilters')
      if (open) open.click()
      setTimeout(() => {
        const q = document.getElementById('modalQ')
        if (q) q.focus()
      }, 120)
      return
    }
    if (e.key === 'f') {
      e.preventDefault()
      const open = document.getElementById('openFilters')
      if (open) open.click()
      return
    }
    if (e.key === 'w') {
      e.preventDefault()
      const open = document.getElementById('openFilters')
      if (open) open.click()
      setTimeout(() => {
        const mw = document.getElementById('modalWhitelist')
        if (mw) mw.focus()
      }, 120)
      return
    }
    if (e.key === 'b') {
      e.preventDefault()
      const open = document.getElementById('openFilters')
      if (open) open.click()
      setTimeout(() => {
        const mb = document.getElementById('modalBlacklist')
        if (mb) mb.focus()
      }, 120)
      return
    }
    if (e.key === 'r') {
      e.preventDefault()
      const open = document.getElementById('readmeBtn')
      if (open) open.click()
      return
    }
    if (e.key === 'o') {
      e.preventDefault()
      const open = document.getElementById('openBtn')
      if (open) open.click()
      return
    }
    if (e.key === 'p') {
      e.preventDefault()
      const fp = document.getElementById('filePath')
      if (fp) fp.focus()
      return
    }
    if (e.key === 's') {
      e.preventDefault()
      const settings = document.getElementById('settingsBtn')
      if (settings) settings.click()
      return
    }
    if (e.key === 't') {
      e.preventDefault()
      const ssh = document.getElementById('startSshTunnelBtn')
      if (ssh) ssh.click()
      return
    }
    if (e.key === 'm') {
      e.preventDefault()
      const theme = document.getElementById('themeSwitch')
      if (theme && !theme.disabled) theme.click()
      return
    }
  }
  window._a11yHandler = handler
  document.addEventListener('keydown', window._a11yHandler)

  // Keyboard row navigation handler removed — will implement a new navigation system.
}

function teardownAccessibility() {
  try {
    if (window._a11yHandler) {
      document.removeEventListener('keydown', window._a11yHandler)
      window._a11yHandler = null
    }
  } catch (e) { console.debug('teardownAccessibility failed', e) }
}

window.addEventListener('DOMContentLoaded', () => {
  const enabled = localStorage.getItem('accessibility_enabled')
  if (enabled !== 'false') setupAccessibility()
})

// Theme handling: toggle and persistence
function getSavedTheme() {
  return localStorage.getItem('theme') || 'dark'
}
function applyTheme(theme) {
  if (theme === 'light') document.body.classList.add('light')
  else document.body.classList.remove('light')
  const icon = document.getElementById('themeIcon')
  const checkbox = document.getElementById('themeSwitch')
  // Checkbox checked state: checked => dark, unchecked => light
  if (checkbox) checkbox.checked = theme === 'dark'
  // Update themed icons across the UI (images with `data-themed="true"`)
  Array.from(document.querySelectorAll('img[data-themed="true"]')).forEach(img => {
    const name = img.dataset.icon
    if (!name) return
    // Prefer build-resolved mapping (imported above). Fall back to relative
    // path if the mapping is missing (covers any unexpected icons).
    const mapped = ICON_MAP[name] && ICON_MAP[name][theme]
    img.src = mapped || `assets/icons/${name}-${theme}.svg`
  })

  localStorage.setItem('theme', theme)
}

function setupTheme() {
  const initial = getSavedTheme()
  applyTheme(initial)
  const checkbox = document.getElementById('themeSwitch')
  if (checkbox) checkbox.addEventListener('change', () => {
    // When checked, we are in dark mode; unchecked -> light mode
    applyTheme(checkbox.checked ? 'dark' : 'light')
  })
}

// initialize theme when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  setupTheme()
})

// Settings modal wiring: settings button opens modal; toggle persists accessibility setting
function setupSettings() {
  const btn = document.getElementById('settingsBtn')
  const modal = document.getElementById('settingsModal')
  const closeBtn = modal ? modal.querySelector('[data-close]') : null
  const overlay = modal ? modal.querySelector('[data-overlay]') : null
  const accessToggle = document.getElementById('accessibilityToggle')

  function setShortcutFooterVisible(visible) {
    const footer = document.querySelector('.shortcut-footer')
    if (!footer) return
    if (visible) footer.classList.remove('hidden')
    else footer.classList.add('hidden')
  }

  function syncShortcutFooterFromStorage() {
    // Default to enabled when key absent
    let enabled = true
    try {
      const s = localStorage.getItem('shortcuts_enabled')
      enabled = (s === null ? true : (s !== 'false'))
    } catch (e) { }
    setShortcutFooterVisible(enabled)
  }

  // SSH settings elements
  const sshIpInput = document.getElementById('sshIp')
  const sshUserInput = document.getElementById('sshUser')
  const sshPasswordInput = document.getElementById('sshPassword')
  const saveSshBtn = document.getElementById('saveSshBtn')
  const clearSshBtn = document.getElementById('clearSshBtn')
  const sshStoredStatus = document.getElementById('sshStoredStatus')

  function showSettingsModal() {
    if (!modal) return
    // initialize toggle from storage
    try {
      const enabled = localStorage.getItem('accessibility_enabled')
      if (accessToggle) accessToggle.checked = (enabled !== 'false')
    } catch (e) { }
    syncShortcutFooterFromStorage()
    // populate SSH fields from localStorage
    try {
      const ip = localStorage.getItem('ssh_ip') || ''
      const user = localStorage.getItem('ssh_user') || ''
      if (sshIpInput) sshIpInput.value = ip
      if (sshUserInput) sshUserInput.value = user
      if (sshPasswordInput) sshPasswordInput.value = ''
      if (sshStoredStatus) sshStoredStatus.textContent = 'unknown'
      // Do not query the OS keyring when opening settings to avoid prompting the user.
      if (sshStoredStatus) sshStoredStatus.textContent = 'unknown'
    } catch (e) { }
    modal.classList.remove('hidden')
    modal.setAttribute('aria-hidden', 'false')
    // focus first control
    if (accessToggle) accessToggle.focus()
    try { attachModalAccessibility(modal, hideSettingsModal) } catch (e) { }
  }

  function hideSettingsModal() {
    if (!modal) return
    modal.classList.add('hidden')
    modal.setAttribute('aria-hidden', 'true')
    try { detachModalAccessibility(modal) } catch (e) { }
  }

  if (btn) btn.addEventListener('click', showSettingsModal)
  if (closeBtn) closeBtn.addEventListener('click', hideSettingsModal)
  if (overlay) overlay.addEventListener('click', hideSettingsModal)

  if (accessToggle) {
    accessToggle.addEventListener('change', (e) => {
      const on = !!e.target.checked
      try { localStorage.setItem('accessibility_enabled', on ? 'true' : 'false') } catch (err) { }
      if (on) {
        setupAccessibility()
        showToast('Accessibility enabled', 'info')
      } else {
        teardownAccessibility()
        showToast('Accessibility disabled', 'info')
      }
    })
  }

  // SSH handlers
  if (saveSshBtn) {
    saveSshBtn.addEventListener('click', async () => {
      const ip = sshIpInput ? (sshIpInput.value || '').trim() : ''
      const user = sshUserInput ? (sshUserInput.value || '').trim() : ''
      const pwd = sshPasswordInput ? (sshPasswordInput.value || '') : ''
      if (!ip || !user) { showToast('Provide SSH IP and username', 'error'); return }
      try { localStorage.setItem('ssh_ip', ip); localStorage.setItem('ssh_user', user) } catch (e) { }
      if (!pwd) {
        showToast('Saved SSH host and username (no password provided)', 'info')
        if (sshStoredStatus) sshStoredStatus.textContent = 'none'
        return
      }
      try {
        await invoke('store_ssh_credential', { ip, username: user, password: pwd })
        // clear password input after storing
        if (sshPasswordInput) sshPasswordInput.value = ''
        if (sshStoredStatus) sshStoredStatus.textContent = 'stored'
        showToast('SSH credential stored securely', 'info')
      } catch (err) {
        console.debug('store_ssh_credential failed', err)
        showToast('Failed to store SSH credential', 'error')
      }
    })
  }

  if (clearSshBtn) {
    clearSshBtn.addEventListener('click', async () => {
      const ip = sshIpInput ? (sshIpInput.value || '').trim() : ''
      const user = sshUserInput ? (sshUserInput.value || '').trim() : ''
      if (!ip || !user) { showToast('Provide SSH IP and username to clear password', 'error'); return }
      try {
        await invoke('delete_ssh_credential', { ip, username: user })
        if (sshStoredStatus) sshStoredStatus.textContent = 'none'
        showToast('Stored SSH password cleared', 'info')
      } catch (err) {
        console.debug('delete_ssh_credential failed', err)
        showToast('Failed to clear SSH credential (it may not exist)', 'error')
      }
    })
  }
}

window.addEventListener('DOMContentLoaded', () => {
  setupSettings()
})

window.addEventListener('DOMContentLoaded', () => {
  // Ensure footer reflects current shortcuts setting on initial load
  try {
    const footer = document.querySelector('.shortcut-footer')
    if (!footer) return
    const s = localStorage.getItem('shortcuts_enabled')
    const on = (s === null ? true : (s !== 'false'))
    if (on) footer.classList.remove('hidden')
    else footer.classList.add('hidden')
  } catch (e) { }
})

document.addEventListener('DOMContentLoaded', () => {
  const loadBtn = document.getElementById('loadBtn')
  const openBtn = document.getElementById('openBtn')
  const filePathInput = document.getElementById('filePath')

  // ensure the output-section is sized to allow internal scrolling
  function recalcOutputHeight() {
    const outputSection = document.querySelector('.output-section')
    const header = document.querySelector('header')
    const controls = document.querySelector('.controls')
    if (!outputSection) return
    // Prefer CSS flex layout to size the output section. Clear any explicit height
    // previously set so the flex rules can manage available space and allow
    // the inner `.findings-container` to scroll naturally.
    outputSection.style.removeProperty('height')
  }
  // recalc on load and resize
  window.addEventListener('resize', recalcOutputHeight)
  setTimeout(recalcOutputHeight, 0)

  const filePicker = document.getElementById('filePicker')
  const isWindows = (() => {
    try {
      const ua = String(navigator.userAgent || '').toLowerCase()
      const platform = String(navigator.platform || '').toLowerCase()
      return ua.includes('windows') || platform.includes('win')
    } catch (e) {
      return false
    }
  })()

  openBtn.addEventListener('click', async () => {
    // Try to use Tauri's native file dialog when available (bundled app).
    // Fall back to the browser file input for dev/browser mode.
    // Prefer asking the native backend to show a file dialog so we get the
    // full filesystem path. If the `open_native_dialog` command isn't
    // available (browser/dev), fall back to the hidden file input.
    try {
      if (typeof invoke === 'function') {
        try {
          const chosen = await invoke('open_native_dialog')
          // If a path was returned, populate and auto-load
          if (chosen && typeof chosen === 'string' && chosen.trim().length > 0) {
            if (filePathInput) filePathInput.value = String(chosen)
            try { updateLoadButtonState() } catch (e) { /* ignore */ }
            try { if (loadBtn && !loadBtn.disabled) loadBtn.click() } catch (e) { /* ignore */ }
            return
          }
          // If the native dialog returned null/undefined, the user cancelled.
          // In that case do nothing (no toast, no fallback).
          if (chosen === null || typeof chosen === 'undefined') {
            // On macOS, treat null as user-cancel and do nothing. On Windows,
            // `open_native_dialog` is a no-op, so fall back to the file input.
            if (!isWindows) return
          }
        } catch (e) {
          // invoke failed; surface error and fall back to file input
          console.warn('invoke open_native_dialog failed', e)
          // Try to extract a helpful message from the error returned by invoke
          let errMsg = ''
          try {
            if (e && typeof e === 'object') errMsg = e.message || JSON.stringify(e)
            else errMsg = String(e)
          } catch (ee) {
            errMsg = String(e)
          }
          showToast('Native open failed: ' + errMsg + '. Falling back to file picker.', 'error', 5000)
        }
      }
    } catch (e) {
      console.warn('open_native_dialog check failed', e)
    }

    // Browser/dev fallback: use the hidden file input. Show a small toast so
    // users know something happened if the native dialog didn't appear.
    try {
      if (filePicker) {
        filePicker.value = null
        filePicker.click()
      } else {
        showToast('File picker is not available in this build', 'error', 4000)
      }
    } catch (e) {
      console.warn('fallback filePicker click failed', e)
      showToast('Failed to open file picker', 'error', 4000)
    }
  })

  filePicker.addEventListener('change', async (ev) => {
    const f = ev.target.files && ev.target.files[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const text = e.target.result
        let parsed = JSON.parse(text)
        // if the file uses the `vulnerabilities` schema, transform client-side
        if (!parsed.findings && parsed.vulnerabilities) parsed = transformVulnerabilitiesClient(parsed)
        // auto-sort by severity (critical -> low) on load
        sortState.key = 'severity'
        sortState.dir = -1
        scheduleRender(parsed)
      } catch (err) {
        const out = document.getElementById('output')
        out.classList.remove('hidden')
        out.innerHTML = `<div class="error">Invalid JSON: ${String(err)}</div>`
      }
    }
    reader.readAsText(f)
  })

  // Ensure interactive elements have useful native tooltips (title attribute)
  function ensureTooltips() {
    try {
      const els = Array.from(document.querySelectorAll('button, [role="button"]'))
      els.forEach(el => {
        // Only set if not already present
        if (el.hasAttribute('title')) return
        const aria = el.getAttribute('aria-label')
        if (aria) { el.setAttribute('title', aria); return }
        const txt = (el.innerText || '').trim()
        if (txt) { el.setAttribute('title', txt); return }
        // try to use contained image alt or dataset icon name as a last resort
        const img = el.querySelector && el.querySelector('img[alt]')
        if (img && img.alt) { el.setAttribute('title', img.alt); return }
        const dataIcon = el.querySelector && el.querySelector('img[data-icon]')
        if (dataIcon && dataIcon.dataset && dataIcon.dataset.icon) { el.setAttribute('title', dataIcon.dataset.icon); return }
      })
    } catch (e) {
      console.debug('ensureTooltips failed', e)
    }
  }

  // Run now to ensure initial UI elements have tooltips
  ensureTooltips()

  // Disable the Load button until the filePath input has text
  function updateLoadButtonState() {
    try {
      if (!loadBtn) return
      const hasText = filePathInput && filePathInput.value && filePathInput.value.trim().length > 0
      loadBtn.disabled = !hasText
    } catch (e) {
      // ignore
    }
  }
  // initialize and wire up
  updateLoadButtonState()
  if (filePathInput) filePathInput.addEventListener('input', updateLoadButtonState)
  if (filePathInput) {
    filePathInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        if (loadBtn && !loadBtn.disabled) loadBtn.click()
      }
    })
  }

  // Hide filters on startup if no findings have been loaded yet
  const filtersElInit = document.getElementById('filters')
  if (filtersElInit && !lastLoadedData) filtersElInit.classList.add('hidden')

  // show README content in the output area when nothing is loaded yet
  if (!lastLoadedData) {
    loadReadmeIntoOutput().catch(() => { })
  }

  loadBtn.addEventListener('click', async () => {
    const path = filePathInput.value.trim()
    const out = document.getElementById('output')
    const filtersEl = document.getElementById('filters')
    if (!path) {
      // show a non-blocking toast instead of replacing the output view
      showToast('Please provide a path or use Open.', 'error', 3500)
      // keep filters visible so users can still filter/search before loading a file
      return
    }
    out.classList.remove('hidden')
    out.innerHTML = '<div class="loading">Loading...</div>'
    try {
      const contents = await invoke('read_findings', { path })
      let parsed = JSON.parse(contents)
      // sometimes the backend may return the original content; accept vulnerabilities schema too
      if (!parsed.findings && parsed.vulnerabilities) parsed = transformVulnerabilitiesClient(parsed)
      // auto-sort by severity (critical -> low) on load
      sortState.key = 'severity'
      sortState.dir = -1
      scheduleRender(parsed)
    } catch (err) {
      out.classList.remove('hidden')
      out.innerHTML = `<div class="error">Error: ${String(err)}</div>`
      // keep filters visible on error
    }
  })

  // Clear loaded file and return to opening/readme screen
  const clearLoadedBtn = document.getElementById('clearLoaded')
  if (clearLoadedBtn) clearLoadedBtn.addEventListener('click', async () => {
    lastLoadedData = null
    currentFindings = []
    const filtersEl = document.getElementById('filters')
    if (filtersEl) filtersEl.classList.add('hidden')
    await loadReadmeIntoOutput()
  })
})

// -- Scan UI wiring and native-detection banner -------------------------------------------------
import { listen } from '@tauri-apps/api/event'

function setupScanModeUi() {
  // Simplified scan UI: show a modal to ask for image name before starting.
  const startBtn = document.getElementById('startScanBtn')
  const scanModal = document.getElementById('scanModal')
  const scanImage = document.getElementById('scanImage')
  const scanStart = document.getElementById('scanStartBtn')
  const output = document.getElementById('output')
  let scanInProgress = false
  let scanLogEl = null

  function resetScanLog(message) {
    if (!output) return
    output.classList.remove('hidden')
    output.innerHTML = ''
    const meta = document.createElement('div')
    meta.className = 'meta'
    meta.textContent = message || 'JFrog scan in progress...'
    output.appendChild(meta)
    const log = document.createElement('pre')
    log.className = 'scan-log'
    log.textContent = ''
    output.appendChild(log)
    scanLogEl = log
  }

  function appendScanLine(line, stream) {
    if (!line) return
    if (!scanLogEl) resetScanLog('JFrog scan output')
    const prefix = stream ? `[${stream}] ` : ''
    scanLogEl.textContent += prefix + line + '\n'
    scanLogEl.scrollTop = scanLogEl.scrollHeight
  }

  function showScanModal() {
    if (!scanModal) return
    scanModal.classList.remove('hidden')
    scanModal.setAttribute('aria-hidden', 'false')
    if (scanImage) scanImage.focus()
    try { attachModalAccessibility(scanModal, hideScanModal) } catch (e) { /* ignore */ }
  }

  function hideScanModal() {
    if (!scanModal) return
    scanModal.classList.add('hidden')
    scanModal.setAttribute('aria-hidden', 'true')
    try { detachModalAccessibility(scanModal) } catch (e) { /* ignore */ }
  }

  if (startBtn) startBtn.addEventListener('click', showScanModal)

  // SSH tunnel button: grouped with scan UI. Start/stop the tunnel via backend commands.
  const sshBtn = document.getElementById('startSshTunnelBtn')
  let sshRunning = false

  async function updateSshStateDisplay(state) {
    sshRunning = (state === 'running' || state === 'already_running')
    // Update the SSH button UI: toggle a status class so CSS can render
    // a small green/red indicator on the icon, and update the tooltip to
    // include the tunnel status. Do not replace the button contents (icon).
    if (sshBtn) {
      sshBtn.classList.remove('ssh-running', 'ssh-stopped')
      sshBtn.classList.add(sshRunning ? 'ssh-running' : 'ssh-stopped')
      // Tooltip shows status for clarity
      sshBtn.setAttribute('title', `SSH Tunnel status: ${sshRunning ? 'running' : 'stopped'}`)
      // Keep a separate aria-label for the action while exposing status via title
      sshBtn.setAttribute('aria-label', sshRunning ? 'Stop SSH Tunnel' : 'Start SSH Tunnel')
    }
  }

  if (sshBtn) {
    sshBtn.addEventListener('click', async () => {
      // gather stored SSH host/username
      const ip = (document.getElementById('sshIp') && document.getElementById('sshIp').value) || localStorage.getItem('ssh_ip') || ''
      const user = (document.getElementById('sshUser') && document.getElementById('sshUser').value) || localStorage.getItem('ssh_user') || ''
      if (!ip || !user) {
        showToast('Provide SSH IP and username in Settings first', 'error')
        return
      }

      if (!sshRunning) {
        // ask for port mapping (simple prompts; can be improved with UI)
        let localPort = parseInt(window.prompt('Local port to bind (default 8080):', '8080')) || 8080
        let remoteHostPort = window.prompt('Remote host:port (default 127.0.0.1:8080):', '127.0.0.1:8080') || '127.0.0.1:8080'
        const [remoteHost, remotePortS] = (remoteHostPort || '127.0.0.1:8080').split(':')
        const remotePort = parseInt(remotePortS) || 8080
        try {
          // Tauri command keys are camelCase in the JS binding (e.g. localPort)
          const res = await invoke('start_ssh_tunnel', { ip, username: user, localPort: Number(localPort), remoteHost: remoteHost, remotePort: Number(remotePort) })
          if (res === 'running' || res === 'already_running') {
            showToast('SSH tunnel started', 'info')
            updateSshStateDisplay(res)
          } else {
            showToast('SSH tunnel result: ' + String(res), 'info')
            updateSshStateDisplay(res)
          }
        } catch (e) {
          console.debug('start_ssh_tunnel failed', e)
          // Surface backend error details when available to aid debugging
          let msg = 'Failed to start SSH tunnel'
          try { msg += ': ' + (e && e.message ? e.message : String(e)) } catch (ee) { msg += '' }
          showToast(msg, 'error')
        }
      } else {
        try {
          const res = await invoke('stop_ssh_tunnel', { ip, username: user })
          if (res === 'stopped' || res === 'not_found') {
            showToast('SSH tunnel stopped', 'info')
            updateSshStateDisplay('stopped')
          } else {
            showToast('Stop tunnel: ' + String(res), 'info')
            updateSshStateDisplay('stopped')
          }
        } catch (e) {
          console.debug('stop_ssh_tunnel failed', e)
          let msg = 'Failed to stop SSH tunnel'
          try { msg += ': ' + (e && e.message ? e.message : String(e)) } catch (ee) { msg += '' }
          showToast(msg, 'error')
        }
      }
    })
  }

  if (scanStart) {
    // initialize disabled state based on existing input value
    scanStart.disabled = !(scanImage && scanImage.value && scanImage.value.trim())
    scanStart.addEventListener('click', async () => {
      const image = scanImage ? scanImage.value.trim() : ''
      // If no image provided, warn and keep the modal open.
      if (!image) {
        showToast('No image provided — scan not started', 'error')
        if (scanImage) scanImage.focus()
        return
      }
      if (scanInProgress) {
        showToast('Scan already running', 'info')
        return
      }
      scanInProgress = true
      if (startBtn) startBtn.disabled = true
      scanStart.disabled = true
      resetScanLog(`JFrog scan in progress for ${image}`)
      showToast('Starting scan for ' + image, 'info')
      hideScanModal()
      try {
        await invoke('start_scan', { target: image })
      } catch (e) {
        scanInProgress = false
        if (startBtn) startBtn.disabled = false
        if (scanStart) scanStart.disabled = !(scanImage && scanImage.value && scanImage.value.trim())
        let msg = 'Failed to start scan'
        try { msg += ': ' + (e && e.message ? e.message : String(e)) } catch (ee) { }
        showToast(msg, 'error')
      }
    })
  }

  // enable/disable Start button as the user types
  if (scanImage) {
    scanImage.addEventListener('input', () => {
      if (scanStart) scanStart.disabled = !(scanImage.value && scanImage.value.trim())
    })
    // allow Enter to submit the image name only when Start is enabled
    scanImage.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        if (scanStart && !scanStart.disabled) scanStart.click()
      }
    })
  }

  if (scanModal) {
    const closeBtn = scanModal.querySelector('[data-close]')
    if (closeBtn) closeBtn.addEventListener('click', hideScanModal)
    const overlay = scanModal.querySelector('[data-overlay]')
    if (overlay) overlay.addEventListener('click', hideScanModal)
  }

  // listen for remote-file-content and load it into the viewer
  try {
    listen('remote-file-content', event => {
      try {
        const payload = event.payload
        if (payload && payload.content) {
          const parsed = JSON.parse(payload.content)
          const normalized = (!parsed.findings && parsed.vulnerabilities) ? transformVulnerabilitiesClient(parsed) : parsed
          sortState.key = 'severity'; sortState.dir = -1
          scheduleRender(normalized)
          showToast('Remote file loaded', 'info')
        }
      } catch (e) {
        showToast('Error parsing remote file: ' + String(e), 'error')
      }
    })
  } catch (e) {
    // event API not available — ignore silently
  }

  // Listen for scan progress/completion events
  try {
    let scanOutput = ''
    listen('scan-progress', event => {
      const payload = event.payload || {}
      const line = payload.line || ''
      scanOutput += (line ? line + '\n' : '')
      const out = document.getElementById('output')
      if (out) {
        out.classList.remove('hidden')
        out.innerHTML = `<pre class="scan-log">${escapeHtml(scanOutput)}</pre>`
      }
    })

    listen('scan-complete', event => {
      const payload = event.payload || {}
      scanInProgress = false
      if (startBtn) startBtn.disabled = false
      if (scanStart) scanStart.disabled = !(scanImage && scanImage.value && scanImage.value.trim())
      if (payload && payload.content) {
        try {
          let parsed = JSON.parse(payload.content)
          if (!parsed.findings && parsed.vulnerabilities) parsed = transformVulnerabilitiesClient(parsed)
          sortState.key = 'severity'
          sortState.dir = -1
          scheduleRender(parsed)
          showToast('Scan complete', 'info')
          return
        } catch (e) {
          showToast('Scan completed but failed to parse report', 'error')
        }
      }

      const out = document.getElementById('output')
      if (out) {
        const status = payload.status ? String(payload.status) : 'done'
        const code = payload.code != null ? ` (code ${payload.code})` : ''
        out.classList.remove('hidden')
        out.innerHTML = `<div class="loading">Scan finished: ${escapeHtml(status + code)}</div>` +
          (scanOutput ? `<pre class="scan-log">${escapeHtml(scanOutput)}</pre>` : '')
      }
    })
  } catch (e) {
    // event API not available — ignore silently
  }
}

window.addEventListener('DOMContentLoaded', () => {
  setupScanModeUi()

  // Native-detection: prefer explicit handshake flag then fall back to Tauri API
  const maxWait = 2000
  const interval = 150
  let waited = 0
  const poll = setInterval(() => {
    const isNative = !!(window.__IRONSIGHT_NATIVE || (window.__TAURI__ && window.__TAURI__.tauri && typeof window.__TAURI__.tauri.invoke === 'function'))
    if (isNative) {
      clearInterval(poll)
      return
    }
    waited += interval
    if (waited >= maxWait) {
      clearInterval(poll)
      // Native detection timed out. Per user request, do not display the browser banner.
    }
  }, interval)
})

// Setup README button/modal
function setupReadmeButton() {
  const btn = document.getElementById('readmeBtn')
  if (!btn) return
  btn.addEventListener('click', () => {
    const md = typeof readmeText !== 'undefined' ? readmeText : ''
    const html = `<div class="readme">${mdToHtml(md)}</div>`
    try { if (typeof sanitizeModalsOnOpen === 'function') sanitizeModalsOnOpen() } catch (e) { }
    let modal = document.getElementById('readmeModal')
    const closeExisting = () => {
      try { modal.classList.add('hidden'); modal.setAttribute('aria-hidden', 'true') } catch (e) { }
      try { detachModalAccessibility(modal) } catch (e) { }
    }
    if (modal) {
      const container = modal.querySelector('.detail-body') || modal
      if (container) container.innerHTML = html
      modal.classList.remove('hidden')
      modal.setAttribute('aria-hidden', 'false')
      try { const closeBtn = modal.querySelector('[data-close]'); if (closeBtn) closeBtn.focus() } catch (e) { }
      try { attachModalAccessibility(modal, closeExisting) } catch (e) { }
      return
    }

    try { if (typeof sanitizeModalsOnOpen === 'function') sanitizeModalsOnOpen() } catch (e) { }
    modal = document.createElement('div')
    modal.id = 'readmeModal'
    modal.className = 'detail-modal readme-modal'
    modal.setAttribute('aria-hidden', 'false')
    modal.innerHTML = `
        <div class="overlay" data-overlay tabindex="-1"></div>
        <div class="detail-panel" role="dialog" aria-modal="true" aria-labelledby="readmeTitle">
          <header>
            <h2 id="readmeTitle">README</h2>
            <div>
              <button class="detail-close" data-close aria-label="Close README">
                <img data-themed="true" data-icon="close" src="${ICON_MAP.close.dark}" alt="Close" />
              </button>
            </div>
          </header>
          <div class="detail-body">${html}</div>
        </div>`
    document.body.appendChild(modal)
    try { applyTheme && applyTheme(getSavedTheme()) } catch (e) { }
    const close = () => { try { modal.classList.add('hidden'); modal.setAttribute('aria-hidden', 'true') } catch (e) { }; try { detachModalAccessibility(modal) } catch (e) { } }
    modal.querySelectorAll('[data-close]').forEach(n => n.addEventListener('click', close))
    const overlay = modal.querySelector('[data-overlay]')
    if (overlay) overlay.addEventListener('click', close)
    try { attachModalAccessibility(modal, close) } catch (e) { }
  })
}

window.addEventListener('DOMContentLoaded', () => { setupReadmeButton() })
