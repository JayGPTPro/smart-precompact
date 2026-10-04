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
import type { EngineInterface, Register } from 'claude-code'

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

    // The flame where the surface draws SVG (the desktop app); a mark in its color in a terminal.
    const mark =
      'Svg' in ui ? (
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
