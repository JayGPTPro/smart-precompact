// The row above the prompt: one dock-look image row on the desktop, the text row in a terminal.
import { expect, mock, test } from 'claude-code/testing'

const BAND = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 95, scroll: { offset: 0, bodyRows: 10 }, view: {} }

function world(on: any, percent: number): void {
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
  // The engine's own row beneath: the mod's row must keep it.
  on('ui.render', { component: 'AbovePrompt' }, ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="engine-band">engine</Text>
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
