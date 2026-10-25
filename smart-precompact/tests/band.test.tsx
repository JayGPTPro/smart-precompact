// The row above the prompt: one dock-look image row on the desktop, the text row in a terminal.
import { expect, mock, test } from 'claude-code/testing'

const BAND = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 95, scroll: { offset: 0, bodyRows: 10 }, view: {} }

const written = new Map<string, string>()
function world(on: any, percent: number, withModsRow = false): void {
  written.clear()
  on('session.usage', async () => ({
    value: {
      context: { percent, tokens: percent * 10_000, window: 1_000_000 },
      cost: { usd: 12.4 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 41 }],
    },
  }))
  on('session.start', async ($: any, e: any) => ({ cwd: e.cwd }))
  on('ui.status', async () => ({ value: undefined }))
  on('env.get', async () => ({ value: undefined }))
  on('session.id', async () => ({ value: 'abcdef12-0000' }))
  on('fs.write', async (_: any, e: any) => {
    written.set(e.path, e.text)
    return { value: undefined }
  })
  // The engine's own row beneath: the mod's row must keep it.
  on('ui.render', { component: 'AbovePrompt' }, ($: any, e: any) => {
    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    const engine = <Text key="engine-band">engine</Text>
    if (!withModsRow) return engine
    // The shared row the mods in context-mods draw when no row of Smart PreCompact's is beneath
    // them: a mod's tile on the desktop, a spacer, then the buttons.
    const isDesktop = e.surface === 'desktop'
    return (
      <Box flexDirection="column">
        <Box key="mods-row" flexDirection="row" alignItems="center" gap={1}>
          {isDesktop ? <ui.Svg source="<svg/>" alt="Tile" width={34} height={26} /> : null}
          <Box flexGrow={1} />
          <Button key="tldr-off" label="↩ No TL;DR" onPress={() => undefined} />
          <Button key="other" label="Other mod" onPress={() => undefined} />
        </Box>
        {engine}
      </Box>
    )
  })
  mock.store(on, {})
  mock.clock(on, { now: Date.parse('2026-10-06T10:00:00Z') })
}

for (const percent of [23, 64, 83]) {
  test(`the meter at ${percent}% draws as one dock row on the desktop`, async ($: any, on: any) => {
    world(on, percent)
    await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
    const band = await $.ui.mount({ plugin: 'smart-precompact-mod', surface: 'desktop', component: 'AbovePrompt', props: BAND })
    const tree = JSON.stringify(await band.drawn())
    console.log(`DUMP>>smart-precompact>>${percent}>>${tree}`)
    expect(tree).toContain(`${percent}%`)
    expect(tree).toContain('"type":"Svg"')
    expect(tree).toContain(percent >= 80 ? 'class=\\"hot\\"' : percent >= 60 ? 'class=\\"warm\\"' : 'class=\\"m\\"')
    expect(tree).not.toContain('"variant":"primary"')
    expect(tree).toContain('["engine"]')
    expect(await band.find({ key: 'compact' })).toBeDefined()
    expect(await band.find({ key: 'hide' })).toBeDefined()
  })
}

test('a terminal keeps the text row', async ($: any, on: any) => {
  world(on, 64)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount({ plugin: 'smart-precompact-mod', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  const tree = JSON.stringify(await band.drawn())
  expect(tree).not.toContain('"type":"Svg"')
  expect(tree).toContain('["64","%"]')
  expect(await band.find({ key: 'compact' })).toBeDefined()
})

// What a row holds, in order: each Button's label, each Svg's alt (the hairline's is "").
function rowOf(tree: any, key: string): string[] | null {
  if (tree === null || typeof tree !== 'object') return null
  if (tree.props?.key === key) {
    return (tree.children ?? []).flatMap((c: any) =>
      c?.type === 'Button' ? [String(c.props.label)] : c?.type === 'Svg' ? [`svg:${c.props.alt}`] : c?.type === 'Box' ? ['spacer'] : [],
    )
  }
  for (const child of tree.children ?? []) {
    const found = rowOf(child, key)
    if (found) return found
  }
  return null
}

test('a wide desktop takes the mods\' shared row beneath into its own, behind a hairline', async ($: any, on: any) => {
  world(on, 64, true)
  await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount({ plugin: 'smart-precompact-mod', surface: 'desktop', component: 'AbovePrompt', props: { ...BAND, bodyColumns: 140 } })
  const tree = await band.drawn()
  expect(rowOf(tree, 'spc-band')).toEqual(['svg:Smart PreCompact', 'spacer', 'svg:Tile', '↩ No TL;DR', 'Other mod', 'svg:', 'Smart compact', 'Hide'])
  expect(rowOf(tree, 'mods-row')).toBeNull()
  const json = JSON.stringify(tree)
  expect(json.split('"alt":""').length - 1).toBe(1)
  expect(json).toContain('["engine"]')
  expect(await band.find({ key: 'other' })).toBeDefined()
})

test('a narrow desktop leaves both rows as they are', async ($: any, on: any) => {
  world(on, 64, true)
  await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
  const band = await $.ui.mount({ plugin: 'smart-precompact-mod', surface: 'desktop', component: 'AbovePrompt', props: { ...BAND, bodyColumns: 50 } })
  const tree = await band.drawn()
  expect(rowOf(tree, 'spc-band')).toEqual(['svg:Smart PreCompact', 'spacer', 'Smart compact', 'Hide'])
  expect(rowOf(tree, 'mods-row')).toEqual(['svg:Tile', 'spacer', '↩ No TL;DR', 'Other mod'])
  expect(JSON.stringify(tree)).not.toContain('"alt":""')
  expect(JSON.stringify(tree)).toContain('["engine"]')
})

test('a terminal leaves the mods\' row and its own text row apart', async ($: any, on: any) => {
  world(on, 64, true)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount({ plugin: 'smart-precompact-mod', surface: 'terminal', component: 'AbovePrompt', props: { ...BAND, bodyColumns: 140 } })
  const tree = await band.drawn()
  expect(rowOf(tree, 'mods-row')).toEqual(['spacer', '↩ No TL;DR', 'Other mod'])
  expect(rowOf(tree, 'spc-band')).toContain('Smart compact')
  expect(rowOf(tree, 'spc-band')).not.toContain('Other mod')
  expect(JSON.stringify(tree)).toContain('["engine"]')
})

test('every reading writes the window the engine measures against, for the Python hook', async ($: any, on: any) => {
  world(on, 23)
  await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
  const entry = [...written.entries()].find(([path]) => path.endsWith('.window.json'))
  expect(entry).toBeDefined()
  expect(JSON.parse(entry?.[1] ?? '{}').window).toBe(1_000_000)
})
