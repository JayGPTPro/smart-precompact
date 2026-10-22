// Smart PreCompact, mod edition.
// Status line: the live context percentage. One row above the prompt from the first reading:
// the Smart PreCompact mark, the meter, where things stand, what the session has used, one
// button (Smart compact), and Hide, which hides the row until the next threshold.
// Smart compact is the whole job in one press: when the skill prepared a /compact line in the
// last few minutes it uses that line; otherwise it prepares one quietly (a fork of the
// conversation that adds nothing to it, written to the handoff file in the skill's format),
// and then compacts with it. After a compact the row turns into a receipt: tokens before and
// after, and the running total saved.
// Every compaction that arrives without instructions (the automatic one, or a bare /compact)
// gets the prepared line, or a keep-list when there is none.
// The 60%/80% notes and the restore after a compact stay with the Python hook.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Meter, Receipt } from '../types'

const meter = atom({ plugin: 'smart-precompact-mod', key: 'meter' } as const, null)
const hasHandoff = atom({ plugin: 'smart-precompact-mod', key: 'hasHandoff' } as const, false)
const hiddenAtTier = atom({ plugin: 'smart-precompact-mod', key: 'hiddenAtTier' } as const, 0)
const busy = atom({ plugin: 'smart-precompact-mod', key: 'busy' } as const, null)
const receipt = atom({ plugin: 'smart-precompact-mod', key: 'receipt' } as const, null)

// Theme keys, so every color follows the app's light or dark theme.
const BRAND = 'claude'
const DANGER = 'error'
const GOOD = 'success'
const TRACK = 'inactive'

// The Smart PreCompact flame, as on jaygptpro.com/smart-precompact.
const FLAME =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><defs><linearGradient id="spc-flame" x1="12" y1="2" x2="12" y2="22.7" gradientUnits="userSpaceOnUse"><stop stop-color="#ffb648"/><stop offset=".5" stop-color="#ff7a18"/><stop offset="1" stop-color="#d97757"/></linearGradient></defs><path d="M12 2c1 3.5-1.5 5-1.5 7.5 0 1.4 1 2.5 2.3 2.5 1.6 0 2.4-1.3 2.2-3 2.3 1.7 3.5 4.2 3.5 6.7A7 7 0 0 1 5.5 15.7c0-4.6 4.6-7.4 6.5-13.7Z" fill="url(#spc-flame)"/></svg>'

const BAR_CELLS = 12
const HANDOFF_CHARS = 3000
const COMPACT_LINE = /^<!-- compact: (.*) -->\s*$/m
const GENERIC =
  "Keep every approach that already failed and why, every decision with its reason, and the user's explicit instructions in their own words. Compress routine file reads, intermediate drafts and finished debugging rounds."
// What the quiet prepare follows when the skill's own files cannot be read.
const RULES_FALLBACK =
  "Triage what must survive, in this order: dead ends with the reason each failed (the most expensive to lose), decisions with their reasons, the user's corrections in their own words, working state (files touched, what is half done or untested), open items. Drop what the code, git or CLAUDE.md already hold, what was only true for a moment, and anything a later conclusion replaced. Copy exact strings (paths, errors, commands) word for word. Replace any secret with [REDACTED: what it is]. Never invent a reason nobody stated."
// A press older than this is a leftover (a reload mid-press cancels its `finally`). A fork over
// a full 1M window can take minutes, so this stays well above that.
const BUSY_MS = 15 * 60_000
// The engine's refusals that the person's own /compact gets past: a headless session (the
// desktop app), and a press that landed while a turn runs.
export const FALLBACK = /headless|inside a turn|a turn is running/i
// A line the skill prepared this recently is used as it is; an older one is prepared again.
const REUSE_MS = 15 * 60_000
// How long the receipt stays up after a compact.
const RECEIPT_MS = 10 * 60_000
// When each session last compacted, kept across restarts so a resumed session does not
// treat a spent handoff as fresh. The last 50 sessions.
const COMPACTED = 'compactedAt'
const COMPACTED_KEEP = 50
// Tokens taken out of the context by every compact the mod saw, across sessions.
const SAVED = 'saved'

type Handoff = { body: string; compactLine: string | null; mtimeMs: number }
type Saved = { tokens: number; compacts: number }

const steps = (window: number): readonly [number, number] => (window >= 500_000 ? [60, 80] : [50, 70])

const tierOf = (m: Meter) => {
  const [first, last] = steps(m.window)
  return m.percent >= last ? 2 : m.percent >= first ? 1 : 0
}

// USERPROFILE first: on Windows it is the home Claude Code and the Python hook use, whatever HOME says.
const home = async ($: EngineInterface) => (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
const sessionKey = async ($: EngineInterface) => (await $.session.id()).replace(/[^A-Za-z0-9_-]/g, '_')

const compactedAt = async ($: EngineInterface) => {
  const map = ((await $.store.get(COMPACTED)) ?? {}) as Record<string, number>
  return map[await $.session.id()] ?? 0
}

const markCompacted = async ($: EngineInterface) => {
  const id = await $.session.id()
  const map = { ...(((await $.store.get(COMPACTED)) ?? {}) as Record<string, number>) }
  delete map[id]
  map[id] = await $.clock.now()
  await $.store.set(COMPACTED, Object.fromEntries(Object.entries(map).slice(-COMPACTED_KEEP)))
}

const addSaved = async ($: EngineInterface, tokens: number) => {
  const was = ((await $.store.get(SAVED)) ?? { tokens: 0, compacts: 0 }) as Saved
  await $.store.set(SAVED, { tokens: was.tokens + Math.max(0, tokens), compacts: was.compacts + 1 })
}

// The receipt for a compact that ran. Without an after-count yet, the next reading fills it in.
const recordCompact = async ($: EngineInterface, before: number | undefined, after: number | undefined) => {
  if (before === undefined) return
  // The total first, so the receipt's first drawing already counts this compact.
  if (after !== undefined) await addSaved($, before - after)
  await update($, receipt, () => ({ before, ...(after === undefined ? {} : { after }), at: Date.now() }))
}

// Claims the busy flag; false when another press already holds it.
const claim = async ($: EngineInterface, label: string) => {
  const now = await $.clock.now()
  let mine = false
  await update($, busy, held => {
    // update reruns this when another write landed first, so the verdict is decided each run.
    mine = false
    if (held !== null && now - held.at < BUSY_MS) return held
    mine = true
    return { label, at: now }
  })
  return mine
}

const handoffPath = async ($: EngineInterface) =>
  `${await home($)}/.claude/handoffs/${(await sessionKey($)).slice(0, 8)}.md`

// The Python hook's record of the handoff version it put back after a compact (seconds).
const restoredMtime = async ($: EngineInterface) => {
  try {
    const state = JSON.parse(await $.fs.read(`${await home($)}/.claude/handoffs/.state/${await sessionKey($)}.json`)) as {
      restored_mtime?: unknown
    }
    return typeof state.restored_mtime === 'number' ? state.restored_mtime : 0
  } catch {
    return 0
  }
}

// The handoff counts only when the skill wrote it during this session, after the last compact:
// the mod's own record, or the hook's, which also covers a compact the mod did not see.
const freshHandoff = async ($: EngineInterface): Promise<Handoff | null> => {
  try {
    const path = await handoffPath($)
    const [stat, usage] = await Promise.all([$.fs.stat(path), $.session.usage()])
    const since = Math.max(usage.startedAt, await compactedAt($))
    if (stat.kind !== 'file' || stat.mtimeMs < since) return null
    if (Math.floor(stat.mtimeMs / 1000) <= (await restoredMtime($))) return null
    const text = (await $.fs.read(path)).split('\n').slice(1).join('\n')
    const compactLine = COMPACT_LINE.exec(text)?.[1]?.trim() || null
    const body = text.replace(COMPACT_LINE, '').trim().slice(0, HANDOFF_CHARS)
    return body || compactLine ? { body, compactLine, mtimeMs: stat.mtimeMs } : null
  } catch {
    return null
  }
}

// The skill's own /compact line when it saved one; otherwise the keep-list, with the handoff when there is one.
const instructionsFor = async ($: EngineInterface) => {
  const handoff = await freshHandoff($)
  if (handoff?.compactLine) return handoff.compactLine
  return handoff?.body
    ? `${GENERIC} In particular, keep these items intact, with their reasons and exact strings:\n\n${handoff.body}`
    : GENERIC
}

// The skill's triage and writing rules (its steps 2 and 3, and the block templates), so the quiet
// prepare and the skill never drift apart.
const skillRules = async ($: EngineInterface) => {
  // The skill folder this mod ships in, else the usual install.
  const root = $.plugin.root.replace(/[\\/]\.claude-plugin[\\/]?$/, '')
  const usual = `${await home($)}/.claude/skills/smart-precompact`
  const dir = (await $.fs.stat(`${root}/SKILL.md`).then(s => s.kind === 'file').catch(() => false)) ? root : usual
  try {
    const skill = await $.fs.read(`${dir}/SKILL.md`)
    const from = skill.indexOf('## Step 2')
    const to = skill.indexOf('## Step 4')
    const steps23 = from < 0 ? '' : skill.slice(from, to < 0 ? undefined : to)
    const templates = await $.fs.read(`${dir}/reference/prompt-templates.md`).catch(() => '')
    return [steps23, templates].filter(Boolean).join('\n\n') || RULES_FALLBACK
  } catch {
    return RULES_FALLBACK
  }
}

const stamp = async ($: EngineInterface) => {
  try {
    const out = (await $.process.run(['date', '+%Y-%m-%d %H:%M'])).stdout.trim()
    if (/^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(out)) return out
  } catch {
    // falls through to UTC below
  }
  return new Date().toISOString().slice(0, 16).replace('T', ' ')
}

const between = (text: string, tag: string) =>
  new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text)?.[1]?.replace(/^\s*```\w*\n?|\n?```\s*$/g, '').trim() ?? ''

type Prepared = { line: string } | { reason: string }

// Prepares the /compact line the way the skill does, without a turn: one question over the
// conversation as it stands, whose answer never joins it. Saves the handoff file in the skill's
// format, so the hook brings it back after the compact.
const prepareQuietly = async ($: EngineInterface): Promise<Prepared> => {
  const path = await handoffPath($)
  const shown = `~/.claude/handoffs/${(await sessionKey($)).slice(0, 8)}.md`
  const prompt = [
    '[Smart PreCompact] The user pressed Smart compact: this conversation is about to be compacted. Do not call tools and do not continue the work. Follow the rules of the smart-precompact skill below and answer with its two blocks only.',
    await skillRules($),
    `Write both blocks in the language of the user's messages. Block 1, the /compact line: at most 60 words, one line, without the leading "/compact", ending with "Handoff file: ${shown}". Block 2, the resume prompt: at most 200 words, standing on its own for a session that never saw this conversation.`,
    'Answer in exactly this shape and nothing else:\n<compact>block 1</compact>\n<resume>block 2</resume>',
  ].join('\n\n')
  const reply = await $.model.fork({ prompt })
  if (!reply.isAnswered) return { reason: reply.reason }
  const line = between(reply.text, 'compact')
    .replace(/^\/compact\s+/, '')
    .replace(/\s+/g, ' ')
    .replace(/-+->/g, '->')
    .trim()
  const resume = between(reply.text, 'resume')
  if (!line || !resume) return { reason: "Claude's reply came back incomplete" }
  const root = await $.session.root().catch(() => '')
  // A file that cannot be saved costs the restore after the compact, not the line itself.
  await $.fs.write(path, `# Handoff . ${root} . ${await stamp($)}\n\n${resume}\n<!-- compact: ${line} -->\n`).catch(() => undefined)
  return { line }
}

const money = (usd: number) => (usd >= 100 ? `$${Math.round(usd)}` : `$${usd.toFixed(2)}`)

const tokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`

const refresh = async ($: EngineInterface) => {
  const { context, cost, rateLimits } = await $.session.usage()
  const fiveHour = rateLimits.find(limit => limit.kind === 'five_hour')?.percentUsed
  const next: Meter | null =
    context.percent === undefined
      ? null
      : {
          percent: context.percent,
          tokens: context.tokens ?? 0,
          window: context.window,
          ...(cost ? { costUsd: cost.usd } : {}),
          ...(fiveHour === undefined ? {} : { fiveHour: Math.round(fiveHour) }),
        }
  await update($, meter, () => next)
  const saved = (await freshHandoff($)) !== null
  await update($, hasHandoff, () => saved)
  // The receipt: filled in by the first reading after the compact, cleared once it is old.
  const r = await read($, receipt)
  if (r !== null) {
    if (Date.now() - r.at > RECEIPT_MS) await update($, receipt, () => null)
    // A reading at or above the before-count is still the one from before the compact.
    else if (r.after === undefined && next !== null && next.tokens < r.before) {
      // Decided inside the update, so a dismissed receipt stays dismissed and two readings count once.
      let filled = 0
      await update($, receipt, cur => {
        filled = 0
        if (cur === null || cur.at !== r.at || cur.after !== undefined) return cur
        filled = cur.before - next.tokens
        return { ...cur, after: next.tokens }
      })
      if (filled > 0) await addSaved($, filled)
    }
  }
  if (next === null) {
    $.ui.status(undefined)
    return
  }
  const mark = tierOf(next) === 2 ? '▲' : tierOf(next) === 1 ? '◆' : '◇'
  $.ui.status(`${mark} context ${next.percent}%`)
  // Hide holds until the tier it named; a drop below it moves it to the next threshold up.
  // A reading from before a compact still under way says nothing about the tier after it.
  const isStale = r !== null && next.tokens >= r.before
  const tier = tierOf(next)
  if (!isStale) await update($, hiddenAtTier, h => (tier >= h ? 0 : tier + 1))
}

// ---------- the dock look ----------
// The same look as the Context Mods' rows, so they read as one panel.
// On the desktop each row above the prompt is one SVG image (a pale brand tile, then a few
// quiet chips) beside the native buttons. HTML inside the SVG gives the system font and
// right-to-left Hebrew. It must stay a plain image: an interactive SVG drops the HTML and draws
// nothing (probed in the Code tab, 6.10.26). Color is kept for what needs a person: only a
// warning or a failure is a filled pill; everything else is text with a small dot or icon.
const DOCK_PX = 7.9 // CSS pixels per band column on the desktop (measured against the 20px tile, 6.10.26)
const DOCK_H = 26
const DOCK_LEAD = 30 // the tile and the space after it
const DOCK_SEP = 15 // the small dot between two chips, with its spacing
const DOCK_FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',system-ui,sans-serif"
const DOCK_HEBREW = /[֐-׿]/
const DOCK_CSS = [
  `.r{display:flex;align-items:center;height:${DOCK_H}px;font:500 12px/1 ${DOCK_FONT};color:#45413b;white-space:nowrap;overflow:hidden;-webkit-font-smoothing:antialiased}`,
  '.tile{flex:none;display:flex;width:20px;height:20px;margin-right:10px}',
  '.sep{flex:none;width:3px;height:3px;border-radius:2px;background:rgba(60,55,45,.2);margin:0 6px}',
  '.c{display:inline-flex;align-items:center;gap:6px;height:20px;flex:none;padding:0 1px}',
  '.c i{width:6px;height:6px;border-radius:3px;flex:none;background:#aaa59c}',
  '.c s{text-decoration:none;color:#9b968d;font-weight:400}',
  '.c svg{flex:none}',
  '.good i{background:#36a463}',
  '.info{color:#2f5ea8}',
  '.info i{background:#3b74d9}',
  '.quiet{color:#8d887f;font-weight:450}',
  '.warn,.bad{padding:0 9px;border-radius:10px}',
  '.warn{color:#8a520a;background:rgba(232,152,30,.16)}',
  '.warn i{background:#e0901c}',
  '.bad{color:#ad3527;background:rgba(225,72,56,.12)}',
  '.bad i{background:#e0483a}',
  '.m{display:inline-flex;align-items:center;gap:8px;flex:none}',
  '.m em{font-style:normal;font-weight:600;font-variant-numeric:tabular-nums;color:#45413b}',
  '.m em.warm{color:#c4613d}',
  '.m em.hot{color:#d23b2d}',
  '.bar{position:relative;width:96px;height:4px;border-radius:2px;background:rgba(45,40,30,.1)}',
  '.bar b{position:absolute;left:0;top:0;bottom:0;border-radius:2px}',
  '.bar u{position:absolute;top:-2px;width:1.5px;height:8px;margin-left:-1px;border-radius:1px;background:rgba(45,40,30,.22)}',
  '@media (prefers-color-scheme:dark){.r{color:#dedad3}.sep{background:rgba(255,255,255,.2)}.c s{color:#8f8a82}.info{color:#9bbcf6}.quiet{color:#9a958d}.warn{color:#f2bd63;background:rgba(240,170,60,.17)}.bad{color:#ff8f80;background:rgba(240,90,70,.18)}.m em{color:#dedad3}.m em.warm{color:#f0956c}.bar{background:rgba(255,255,255,.14)}.bar u{background:rgba(255,255,255,.3)}}',
].join('')

type DockTone = 'good' | 'warn' | 'bad' | 'info' | 'plain' | 'quiet'
type DockChip = { html: string; px: number }

function dockEsc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// One chip (about 6px a character in the real font, measured 6.10.26). Hebrew runs right to
// left with its mark on the right; `dim` trails lighter; `icon` is trusted SVG markup drawn in
// place of the dot, and a quiet chip has no dot. `px` is the width it is expected to take.
function dockChip(text: string, tone: DockTone, extra: { dim?: string; icon?: string } = {}): DockChip {
  const dir = DOCK_HEBREW.test(text) ? 'rtl' : 'ltr'
  const mark = extra.icon ?? (tone === 'quiet' ? '' : '<i></i>')
  const dim = extra.dim ? ` <s>${dockEsc(extra.dim)}</s>` : ''
  const chars = text.length + (extra.dim ? extra.dim.length + 1 : 0)
  const isPill = tone === 'warn' || tone === 'bad'
  const px = Math.ceil(chars * 6.1 + (isPill ? 20 : 2) + (mark ? 12 : 0))
  return { html: `<span class="c ${tone}" dir="${dir}">${mark}<span>${dockEsc(text)}</span>${dim}</span>`, px }
}

// The whole row as an SVG document: the tile, then the chips with a small dot between them.
function dockRow(width: number, tile: string, chips: DockChip[]): string {
  const w = Math.max(DOCK_LEAD, Math.round(width))
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${DOCK_H}" viewBox="0 0 ${w} ${DOCK_H}">` +
    `<foreignObject x="0" y="0" width="${w}" height="${DOCK_H}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" class="r"><style>${DOCK_CSS}</style>` +
    `<span class="tile">${tile}</span>${chips.map(c => c.html).join('<span class="sep"></span>')}</div>` +
    '</foreignObject></svg>'
  )
}

// A native desktop button's width: about 7.2px a character and 12px of padding, plus the
// one-column gap before it (measured 6.10.26).
function dockButtonPx(label: string): number {
  return label.length * 7.2 + 12 + DOCK_PX
}

// Keeps the chips that fit beside the buttons, in order (the first are the most important), and
// sizes the image to them with a little slack, so a short estimate never clips a last letter.
function dockLayout(bodyColumns: number, buttonsPx: number, chips: DockChip[]): { width: number; chips: DockChip[] } {
  const columns = Number.isFinite(bodyColumns) && bodyColumns > 0 ? bodyColumns : 100
  const room = columns * DOCK_PX - buttonsPx - 16
  const kept: DockChip[] = []
  let used = DOCK_LEAD
  for (const chip of chips) {
    const add = (kept.length > 0 ? DOCK_SEP : 0) + chip.px
    if (used + add > room) break
    kept.push(chip)
    used += add
  }
  return { width: Math.max(DOCK_LEAD, Math.min(room, used + 20)), chips: kept }
}
// ---------- end of the dock look ----------

// The mods in JayGPTPro/context-mods (TL;DR) share one row above the
// prompt (key 'mods-row'). Hooks nest in the order the skills folder lists them: when a mod is
// outer of this one it moves into this row by itself (its hooks/panel.ts); when this one is outer
// of every mod, it takes their row in here. On the desktop only, and only when all of it fits, by
// the same width math as panel.ts; otherwise both rows stay as they are.
const MODS_ROW = 'mods-row'
// The hairline between the mods' buttons and this mod's own: panel.ts's DIVIDER, told apart by its empty alt.
const MODS_DIVIDER =
  '<svg xmlns="http://www.w3.org/2000/svg" width="9" height="16" viewBox="0 0 9 16"><rect x="4" y="1" width="1" height="14" rx=".5" fill="rgba(60,55,45,.18)"/></svg>'
const MODS_DIVIDER_PX = 9 + DOCK_PX

type Drawn = { type?: unknown; props?: Record<string, unknown>; children?: unknown[] }
const asDrawn = (node: unknown): Drawn | null => (node !== null && typeof node === 'object' ? (node as Drawn) : null)
const isButtonNode = (node: unknown) => asDrawn(node)?.type === 'Button'
const isSvgNode = (node: unknown) => asDrawn(node)?.type === 'Svg'

/** The first node, depth first, with this key. */
function findKeyed(node: unknown, key: string): Drawn | null {
  const n = asDrawn(node)
  if (n === null) return null
  if (n.props?.key === key) return n
  for (const child of n.children ?? []) {
    const found = findKeyed(child, key)
    if (found) return found
  }
  return null
}

/** The tree without `target`, copied along the path. */
function dropNode(node: unknown, target: Drawn): unknown {
  const n = asDrawn(node)
  if (n === null || !n.children) return node
  let changed = false
  const children: unknown[] = []
  for (const child of n.children) {
    if (child === target) {
      changed = true
      continue
    }
    const next = dropNode(child, target)
    if (next !== child) changed = true
    children.push(next)
  }
  return changed ? { ...n, children } : node
}

/**
 * The mods' row beneath, taken in: its images and buttons, and the drawing beneath without it.
 * Null when there is none, when it holds anything else (a word, a terminal row), or when it does
 * not fit beside `ownPx`, what this row's image and buttons take.
 */
function adoptModsRow(beneath: unknown, bodyColumns: number, ownPx: number): { guests: unknown[]; beneath: unknown } | null {
  const row = findKeyed(beneath, MODS_ROW)
  if (row === null) return null
  const kids = (row.children ?? []).filter(child => child !== null && child !== undefined && child !== false)
  const isSpacer = (node: unknown) => asDrawn(node)?.type === 'Box' && (asDrawn(node)?.children ?? []).length === 0
  if (!kids.every(child => isButtonNode(child) || isSvgNode(child) || isSpacer(child))) return null
  // A hairline already there would be a second one: this row draws its own.
  const guests = kids.filter(child => isButtonNode(child) || (isSvgNode(child) && asDrawn(child)?.props?.alt !== ''))
  if (guests.length === 0) return null
  const guestsPx = guests.reduce<number>((sum, child) => {
    const props = asDrawn(child)?.props ?? {}
    if (isSvgNode(child)) return sum + (typeof props.width === 'number' ? props.width + DOCK_PX : 0)
    return sum + (typeof props.label === 'string' ? dockButtonPx(props.label) : 0)
  }, 0)
  const columns = Number.isFinite(bodyColumns) && bodyColumns > 0 ? bodyColumns : 100
  if (ownPx + guestsPx + MODS_DIVIDER_PX > columns * DOCK_PX - 16) return null
  return { guests, beneath: beneath === row ? null : dropNode(beneath, row) }
}

// The row's tile: the flame on a pale warm square.
const FLAME_TILE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">' +
  '<defs><linearGradient id="spc-tile" x1="12" y1="2" x2="12" y2="22.7" gradientUnits="userSpaceOnUse">' +
  '<stop stop-color="#ffb648"/><stop offset=".5" stop-color="#ff7a18"/><stop offset="1" stop-color="#d97757"/></linearGradient></defs>' +
  '<rect width="20" height="20" rx="6" fill="#fdeadc"/>' +
  '<path transform="translate(2.4 2.35) scale(.62)" d="M12 2c1 3.5-1.5 5-1.5 7.5 0 1.4 1 2.5 2.3 2.5 1.6 0 2.4-1.3 2.2-3 2.3 1.7 3.5 4.2 3.5 6.7A7 7 0 0 1 5.5 15.7c0-4.6 4.6-7.4 6.5-13.7Z" fill="url(#spc-tile)"/></svg>'

const CHECK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 12 12"><path d="M2.4 6.3l2.4 2.4 4.8-5.2" fill="none" stroke="#36a463" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'

// The meter: the percentage, then a thin rounded bar in the flame's colors with a tick at each
// threshold. The number stays ink until the first threshold, warms past it, turns red past the last.
const meterChip = (m: Meter): DockChip => {
  const tier = tierOf(m)
  const fill = tier === 2 ? 'linear-gradient(90deg,#ff9a6b,#e5484d)' : 'linear-gradient(90deg,#ffb648,#ff7a18 60%,#d97757)'
  const ticks = steps(m.window)
    .map(step => `<u style="left:${step}%"></u>`)
    .join('')
  const width = Math.max(3, Math.min(100, m.percent))
  const tone = tier === 2 ? ' class="hot"' : tier === 1 ? ' class="warm"' : ''
  return {
    html: `<span class="m"><em${tone}>${m.percent}%</em><span class="bar"><b style="width:${width}%;background:${fill}"></b>${ticks}</span></span>`,
    px: 140,
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const ran = await next(e)
    // A busy flag held across a reload belongs to work the reload cancelled.
    await update($, busy, () => null)
    await refresh($).catch(() => undefined)
    return ran
  })

  on('prompt.submit', async ($, e, next) => {
    const ran = await next(e)
    await refresh($).catch(() => undefined)
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)
    await refresh($).catch(() => undefined)
    return ran
  })

  // A /clear starts a new conversation without a session.start: drop the old one's readings.
  on('session.end', async ($, e, next) => {
    const ran = await next(e)
    // A /resume in place swaps the conversation without a session.start, like /clear.
    if (e.reason === 'clear' || e.reason === 'resume') {
      await update($, meter, () => null)
      await update($, hasHandoff, () => false)
      await update($, hiddenAtTier, () => 0)
      await update($, receipt, () => null)
      $.ui.status(undefined)
    }
    return ran
  })

  // The skill's line rides on every compaction of the main conversation that has no
  // instructions of its own: the automatic one, a bare /compact.
  on('session.compact', async ($, e, next) => {
    const isMain = e.agentId === undefined
    // Core reuses a precomputed summary for the compaction that follows, even when the skill
    // prepared a line in between. Skipping it means every compact is summarized with the line
    // current at that moment.
    if (isMain && e.trigger === 'precompute') return { skip: 'Smart PreCompact summarizes at compact time' }
    const isBare = (e.instructions ?? '').trim() === ''
    const added = isMain && e.trigger !== 'plugin' && isBare ? await instructionsFor($) : null
    const ran = await next(added === null ? e : { ...e, instructions: added })
    const done = !('skip' in ran && ran.skip)
    const before = 'tokensBefore' in ran ? ran.tokensBefore : undefined
    const after = 'tokensAfter' in ran ? ran.tokensAfter : undefined
    if (isMain && done) {
      // The line is spent: the next compact needs a fresh prepare. A hidden band waits for the first threshold.
      await markCompacted($)
      await update($, hiddenAtTier, h => Math.min(h, 1))
      await update($, busy, () => null)
      await recordCompact($, before, after)
    }
    // A record of every compact the mod saw, so whether the line was added can be checked afterwards.
    await $.fs
      .write(
        `${await home($)}/.claude/handoffs/.state/mod-compact-hook.json`,
        JSON.stringify(
          {
            at: new Date().toISOString(),
            trigger: e.trigger,
            isMain,
            isBare,
            done,
            skip: 'skip' in ran ? ran.skip : null,
            tokensBefore: before ?? null,
            tokensAfter: after ?? null,
            added: added !== null,
          },
          null,
          2,
        ),
      )
      .catch(() => undefined)
    if (added !== null && done) {
      $.ui.toast('Smart PreCompact told this compact what to keep', { timeoutMs: 5000 })
    }
    await refresh($).catch(() => undefined)
    return ran
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    const isRoomy = e.props.bodyColumns >= 100
    const isWide = e.props.bodyColumns >= 120
    // Another mod's row, or the engine's own, stays under this one.
    const stacked = async (row: ReturnType<typeof Box>) => (
      <Box key="spc-stack" flexDirection="column">
        {row}
        {await next(e)}
      </Box>
    )

    // The desktop draws each state as one image row in the dock look, beside native buttons.
    // Asked by surface: the terminal's table answers 'Svg' too and draws nothing for it.
    const isDesktop = e.surface === 'desktop' && 'Svg' in ui
    // The whole drawing: this row, with the mods' shared row taken in when it fits, then the rest beneath.
    const dockBand = async (key: string, chips: DockChip[], labels: string[], pressable: RenderChildren[]) => {
      if (!(e.surface === 'desktop' && 'Svg' in ui)) return null
      const Svg = ui.Svg
      const buttonsPx = labels.reduce((sum, label) => sum + dockButtonPx(label), 0)
      const lay = dockLayout(e.props.bodyColumns, buttonsPx, chips)
      const beneath = await next(e)
      const mods = adoptModsRow(beneath, e.props.bodyColumns, lay.width + DOCK_PX + buttonsPx)
      return (
        <Box key="spc-stack" flexDirection="column">
          <Box key={key} flexDirection="row" alignItems="center" gap={1}>
            <Svg source={dockRow(lay.width, FLAME_TILE, lay.chips)} alt="Smart PreCompact" width={lay.width} height={DOCK_H} />
            <Box flexGrow={1} />
            {mods ? (mods.guests as RenderChildren[]) : null}
            {mods ? <Svg source={MODS_DIVIDER} alt="" width={9} height={16} /> : null}
            {pressable}
          </Box>
          {mods ? (mods.beneath as typeof beneath) : beneath}
        </Box>
      )
    }

    // The flame where the surface draws SVG (the desktop app); a mark in its color in a terminal.
    const mark =
      isDesktop ? (
        <ui.Svg source={FLAME} alt="Smart PreCompact" width={14} height={14} />
      ) : (
        <Text color={BRAND} bold>
          ◆
        </Text>
      )
    const title = isRoomy ? (
      <Text color={BRAND} bold>
        Smart PreCompact
      </Text>
    ) : null

    // After a compact: the receipt, until it is dismissed or ten minutes pass.
    const done = await read($, receipt)
    if (done !== null) {
      const total = (await $.store.get(SAVED)) as Saved | undefined
      const dismiss = (
        <Button key="dismiss" label="OK" hotkey={isDesktop ? undefined : 'o'} dimColor onPress={() => update($, receipt, () => null)} />
      )
      const receiptBand = await dockBand(
        'spc-receipt',
        [
          dockChip(done.after === undefined ? `Compacted · ${tokens(done.before)}` : `Compacted · ${tokens(done.before)} → ${tokens(done.after)}`, 'good', { icon: CHECK_ICON }),
          done.after === undefined
            ? dockChip('counting after your next message', 'quiet')
            : dockChip(`${tokens(Math.max(0, done.before - done.after))} lighter`, 'quiet'),
          ...(total && total.compacts > 0 ? [dockChip(`${tokens(total.tokens)} saved in ${total.compacts} ${total.compacts === 1 ? 'compact' : 'compacts'}`, 'quiet')] : []),
        ],
        ['OK'],
        [dismiss],
      )
      if (receiptBand !== null) return receiptBand
      return stacked(
        <Box key="spc-receipt" flexDirection="row" gap={1} alignItems="center">
          {mark}
          {title}
          <Text color={GOOD} bold>
            ✓ Compacted
          </Text>
          <Text bold>
            {done.after === undefined ? `${tokens(done.before)} tokens` : `${tokens(done.before)} → ${tokens(done.after)}`}
          </Text>
          {done.after === undefined ? (
            <Text dimColor>· counting after your next message</Text>
          ) : (
            <Text color={GOOD}>· {tokens(Math.max(0, done.before - done.after))} lighter</Text>
          )}
          {isWide && total && total.compacts > 0 ? (
            <Text dimColor>
              · {tokens(total.tokens)} saved in {total.compacts} {total.compacts === 1 ? 'compact' : 'compacts'}
            </Text>
          ) : null}
          <Button key="dismiss" label="OK" hotkey="o" dimColor onPress={() => update($, receipt, () => null)} />
        </Box>
      )
    }

    const m = await read($, meter)
    if (m === null) return next(e)
    if (tierOf(m) < (await read($, hiddenAtTier))) return next(e)

    const isLast = tierOf(m) === 2
    const saved = await read($, hasHandoff)
    const held = await read($, busy)
    const working = held !== null && (await $.clock.now()) - held.at < BUSY_MS ? held.label : null
    const accent = isLast ? DANGER : BRAND
    const filled = Math.min(BAR_CELLS, Math.max(1, Math.round((m.percent / 100) * BAR_CELLS)))

    const log = async (entry: Record<string, unknown>) =>
      $.fs
        .write(`${await home($)}/.claude/handoffs/.state/mod-last-compact.json`, JSON.stringify(entry, null, 2))
        .catch(() => undefined)

    // Compacts with `instructions`: directly where the engine allows it, else as the person's
    // own /compact (the desktop app runs the session headless, where a plugin cannot compact
    // directly yet). Says whether a compact ran.
    const compactWith = async (instructions: string, prepared: string): Promise<boolean> => {
      try {
        const result = await $.session.compact({ instructions })
        if ('skip' in result) {
          await log({ at: new Date().toISOString(), via: 'direct', prepared, skip: result.skip })
          $.ui.toast(`Smart compact did not run: ${result.skip}`, { timeoutMs: 6000 })
          return false
        }
        // A plugin's own compact skips its own session.compact hook, so the record is kept here.
        await markCompacted($)
        await update($, hiddenAtTier, h => Math.min(h, 1))
        await recordCompact($, result.tokensBefore, result.tokensAfter)
        await log({ at: new Date().toISOString(), via: 'direct', prepared, tokensBefore: result.tokensBefore ?? null })
        return true
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        if (!FALLBACK.test(reason)) {
          await log({ at: new Date().toISOString(), via: 'direct', prepared, error: reason })
          $.ui.toast(`Smart compact did not run: ${reason.slice(0, 160)}`, { timeoutMs: 9000 })
          return false
        }
        try {
          const before = await compactedAt($)
          const ran = await $.command.run({ command: 'compact', args: instructions })
          const compacted = (await compactedAt($)) > before
          await log({ at: new Date().toISOString(), via: 'command', prepared, compacted, text: ran.text?.slice(0, 200) ?? null })
          if (!compacted) {
            $.ui.toast(`Smart compact did not run${ran.text ? `: ${ran.text.slice(0, 140)}` : '.'}`, { timeoutMs: 9000 })
          }
          return compacted
        } catch (fallbackError) {
          const why = fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
          await log({ at: new Date().toISOString(), via: 'command', prepared, error: why })
          $.ui.toast(`Smart compact did not run: ${why.slice(0, 160)}`, { timeoutMs: 9000 })
          return false
        }
      }
    }

    // One press: a recent prepared line as it is, else a quiet prepare, then the compact.
    const smartCompact = async () => {
      if (!(await claim($, 'preparing'))) return
      const compactedBefore = await compactedAt($)
      try {
        const handoff = await freshHandoff($)
        const isRecent = handoff?.compactLine && (await $.clock.now()) - handoff.mtimeMs < REUSE_MS
        let instructions: string
        let prepared: string
        if (isRecent && handoff?.compactLine) {
          instructions = handoff.compactLine
          prepared = 'recent'
        } else {
          const quiet = await prepareQuietly($).catch((error: unknown) => ({
            reason: error instanceof Error ? error.message : String(error),
          }))
          if ('line' in quiet) {
            instructions = quiet.line
            prepared = 'quiet'
          } else {
            // Still one press: the best instructions there are, and a word on why.
            instructions = await instructionsFor($)
            prepared = `fallback: ${quiet.reason}`
            $.ui.toast(`Could not prepare a new line (${quiet.reason.slice(0, 80)}). Compacting with the best notes there are.`, {
              timeoutMs: 7000,
            })
          }
        }
        // Another compact landed while the line was prepared: the conversation is already light,
        // and the line describes the one before it.
        if ((await compactedAt($)) > compactedBefore) {
          await log({ at: new Date().toISOString(), prepared, skipped: 'compacted while preparing' })
          return
        }
        await update($, busy, held => (held === null ? held : { ...held, label: 'compacting' }))
        await compactWith(instructions, prepared)
      } finally {
        await update($, busy, () => null)
        await refresh($).catch(() => undefined)
      }
    }

    const state =
      working !== null ? `${working}…` : e.props.isWorking ? 'Claude is working' : saved ? 'prepared' : 'ready'
    const used = [
      m.costUsd === undefined ? null : `${money(m.costUsd)} this session`,
      m.fiveHour === undefined ? null : `5h limit ${m.fiveHour}%`,
    ]
      .filter(Boolean)
      .join(' · ')

    const canCompact = !(working !== null || e.props.isWorking)
    const hide = async () => {
      const now = await read($, meter)
      if (now !== null) await update($, hiddenAtTier, () => tierOf(now) + 1)
    }
    // Words only when they say something: a press at work, Claude busy, a line already prepared.
    const stateChip =
      working !== null
        ? dockChip(state, 'info')
        : e.props.isWorking
          ? dockChip(state, 'quiet')
          : saved
            ? dockChip(state, 'quiet', { icon: CHECK_ICON })
            : null
    const meterBand = await dockBand(
      'spc-band',
      [meterChip(m), ...(stateChip ? [stateChip] : []), ...(isWide && used ? [dockChip(used, 'quiet')] : [])],
      [...(canCompact ? ['Smart compact'] : []), 'Hide'],
      [
        canCompact ? <Button key="compact" label="Smart compact" onPress={smartCompact} /> : null,
        <Button key="hide" label="Hide" dimColor onPress={hide} />,
      ],
    )
    if (meterBand !== null) return meterBand

    return stacked(
      <Box key="spc-band" flexDirection="row" gap={1} alignItems="center">
        {mark}
        {title}
        <Text color={accent} bold>
          {m.percent}%
        </Text>
        <Text>
          <Text backgroundColor={accent}>{' '.repeat(filled)}</Text>
          <Text backgroundColor={TRACK}>{' '.repeat(BAR_CELLS - filled)}</Text>
        </Text>
        <Text dimColor>{state}</Text>
        {isWide && used ? <Text dimColor>· {used}</Text> : null}
        {working !== null || e.props.isWorking ? null : (
          <Button key="compact" label="Smart compact" hotkey="c" variant="primary" onPress={smartCompact} />
        )}
        <Button
          key="hide"
          label="Hide"
          hotkey="h"
          dimColor
          onPress={async () => {
            const now = await read($, meter)
            if (now !== null) await update($, hiddenAtTier, () => tierOf(now) + 1)
          }}
        />
      </Box>
    )
  })
}
