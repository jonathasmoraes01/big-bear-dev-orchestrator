import { describe, expect, mock, test } from 'claude-code/testing'
import type { On, TurnStepResult } from 'claude-code'

/**
 * Nothing sits beneath the plugins in a test: this answers every call the
 * mod makes on `$`, as a session in a non-git folder with no rate-limit
 * reading would.
 */
function world(on: On, stored?: Record<string, unknown>, toasts: string[] = []) {
  mock.store(on, stored)
  mock.clock(on, { now: 1_760_000_000_000 })
  on('session.root', () => ({ value: '/work/demo' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] } }))
  on('session.surfaces', () => ({ value: ['terminal' as const] }))
  on('session.version', () => ({ value: { version: '2.1.293' } }))
  on('command.list', () => ({ value: [] }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('ui.copy', () => ({ value: { isCopied: true as const } }))
  on('process.run', () => ({ value: { exitCode: 128, stdout: '', stderr: 'not a git repository', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', () => ({ value: '' }))
}


type Drawn = { find: (q: { text?: RegExp; type?: string }) => Promise<unknown>; findAll: (q: { type?: string }) => Promise<{ props: Record<string, unknown> }[]> }

/** Text on the terminal is Text; on the desktop most of the panel is one Svg per section. */
async function shows(ui: Drawn, pattern: RegExp): Promise<boolean> {
  if ((await ui.find({ text: pattern })) !== undefined) return true
  const svgs = await ui.findAll({ type: 'Svg' })
  return svgs.some(svg => pattern.test(String(svg.props['source'] ?? '')) || pattern.test(String(svg.props['alt'] ?? '')))
}

const SCROLL = { offset: 0, bodyRows: 40 }
const run = (args: string) => ({ command: 'bigbear', args }) as never

describe('BIG BEAR inside the engine', () => {
  test('the /bigbear command answers help and status', async ($, on) => {
    world(on)
    const help = await $.command.run(run('help'))
    expect(help.text).toContain('/bigbear mode eco|balanced|god')
    const status = await $.command.run(run('status'))
    expect(status.text).toContain('BALANCED')
  })

  test('mode and manual model changes apply; bad input is refused', async ($, on) => {
    world(on)
    await $.command.run(run('mode eco'))
    await $.command.run(run('model opus'))
    const status = await $.command.run(run('status'))
    expect(status.text).toContain('ECO')
    expect(status.text).toContain('manual OPUS')
    const bad = await $.command.run(run('model gpt'))
    expect(bad.text).toContain('Uso:')
  })

  test('settings stored in an earlier session load at start', async ($, on) => {
    world(on, { config: { routing: { mode: 'god', blocked: ['haiku'] } } })
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    await $.session.start({ cwd: '/work/demo', surface: 'terminal', isInteractive: true })
    const status = await $.command.run(run('status'))
    expect(status.text).toContain('GOD')
    const models = await $.command.run(run('models'))
    expect(models.text).toContain('BLOQUEADO')
    expect(status.text).toContain('demo')
  })

  test('usage shows N/D when the engine has no rate-limit reading', async ($, on) => {
    world(on)
    const usage = await $.command.run(run('usage'))
    expect(usage.text).toContain('N/D — indisponível')
  })

  test('Code Guardian refuses a force push under the deny policy and lets safe commands through', async ($, on) => {
    world(on, { config: { guardian: { action: 'deny' } } })
    on('tool.call', () => ({ result: { stdout: 'ok', stderr: '', interrupted: false }, text: 'ran' }) as never)
    const forced = await $.tool.call({ tool: 'Bash', command: 'git push --force origin feature' } as never)
    expect(forced.text).not.toBe('ran')
    const safe = await $.tool.call({ tool: 'Bash', command: 'git status' } as never)
    expect(safe.text).toBe('ran')
  })

  test('irreversible commands are blocked even under the warn policy', async ($, on) => {
    world(on, { config: { guardian: { action: 'warn' } } })
    on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false }, text: 'ran' }) as never)
    const wiped = await $.tool.call({ tool: 'Bash', command: 'rm -rf /' } as never)
    expect(wiped.text).not.toBe('ran')
  })

  test('a prompt is routed: the turn runs on the chosen model and the task completes', async ($, on) => {
    world(on)
    let sentModel = ''
    on('prompt.submit', (_, e) => ({ text: e.text }))
    on('turn.start', (_, e) => ({ turnId: e.turnId }))
    on('turn.step', async function* (_, e): AsyncGenerator<never, TurnStepResult> {
      sentModel = e.model
      return {
        turnId: e.turnId,
        index: e.index,
        answer: 'Fica em combat/dano.ts',
        toolUses: [],
        stopReason: 'end_turn',
        usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: e.model },
      }
    })
    on('turn.complete', (_, e) => ({ text: e.answer }))

    await $.prompt.submit({ text: 'onde fica a função calcularDano?' } as never)
    await $.turn.start({ text: 'onde fica a função calcularDano?', turnId: 't1' })
    const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
    for await (const _ of stream) {
      // drain
    }
    expect(sentModel).toBe('claude-haiku-5-5')
    await $.turn.complete({ turnId: 't1', answer: 'Fica em combat/dano.ts', durationMs: 1200, isAborted: false, reason: 'answer' })

    const tasks = await $.command.run(run('tasks'))
    expect(tasks.text).toContain('COMPLETED')
    expect(tasks.text).toContain('HAIKU')
    const models = await $.command.run(run('models'))
    expect(models.text).toContain('uso 100%')
  })

  test('with routing off the request keeps the session model', async ($, on) => {
    world(on)
    let sentModel = ''
    on('prompt.submit', (_, e) => ({ text: e.text }))
    on('turn.start', (_, e) => ({ turnId: e.turnId }))
    on('turn.step', async function* (_, e): AsyncGenerator<never, TurnStepResult> {
      sentModel = e.model
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
    })
    await $.command.run(run('off'))
    await $.prompt.submit({ text: 'onde fica X?' } as never)
    await $.turn.start({ text: 'onde fica X?', turnId: 't2' })
    for await (const _ of $.turn.step({ turnId: 't2', index: 0, model: 'claude-opus-5-5', messageCount: 1 })) {
      // drain
    }
    expect(sentModel).toBe('claude-opus-5-5')
  })


  test('a short pane switches to the dense layout so nothing needs scrolling', async ($, on) => {
    world(on)
    const short = await $.ui.mount({
      plugin: 'big-bear',
      surface: 'desktop',
      component: 'Pane',
      requestId: 'bigbear',
      props: { title: 'BIG BEAR', isFocused: false, bodyColumns: 56, placement: 'dock', scroll: { offset: 0, bodyRows: 24 }, view: {} },
    })
    expect(await shows(short as unknown as Drawn, /TOKEN INTELLIGENCE/)).toBe(false)
    expect(await shows(short as unknown as Drawn, /GUARDIANS/)).toBe(true)
    await short.unmount()
    const tall = await $.ui.mount({
      plugin: 'big-bear',
      surface: 'desktop',
      component: 'Pane',
      requestId: 'bigbear',
      props: { title: 'BIG BEAR', isFocused: false, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 52 }, view: {} },
    })
    expect(await shows(tall as unknown as Drawn, /TOKEN INTELLIGENCE/)).toBe(true)
    await tall.unmount()
  })


  test('a notification appears when a task finishes', async ($, on) => {
    const toasts: string[] = []
    world(on, undefined, toasts)
    on('prompt.submit', (_, e) => ({ text: e.text }))
    on('turn.start', (_, e) => ({ turnId: e.turnId }))
    on('turn.complete', (_, e) => ({ text: e.answer }))

    await $.prompt.submit({ text: 'onde fica a função calcularDano?' } as never)
    await $.turn.start({ text: 'onde fica a função calcularDano?', turnId: 'n1' })
    await $.turn.complete({ turnId: 'n1', answer: 'Fica em combat/dano.ts', durationMs: 900, isAborted: false, reason: 'answer' })
    const done = toasts.find(text => text.includes('Tarefa concluída'))
    expect(done).toBeDefined()
    expect(done).toContain('HAIKU')
    expect(done).toContain('calcularDano')

    await $.turn.start({ text: 'x', turnId: 'n2' })
    await $.turn.complete({ turnId: 'n2', answer: '', durationMs: 100, isAborted: true, reason: 'aborted' })
    expect(toasts.some(text => text.includes('Tarefa cancelada'))).toBe(true)
  })

  test('with notifications off no toast is raised for a finished task', async ($, on) => {
    const toasts: string[] = []
    world(on, { config: { ui: { notifyOnFinish: false } } }, toasts)
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    on('prompt.submit', (_, e) => ({ text: e.text }))
    on('turn.start', (_, e) => ({ turnId: e.turnId }))
    on('turn.complete', (_, e) => ({ text: e.answer }))
    await $.session.start({ cwd: '/work/demo', surface: 'terminal', isInteractive: true })
    await $.prompt.submit({ text: 'onde fica X?' } as never)
    await $.turn.start({ text: 'onde fica X?', turnId: 'n3' })
    await $.turn.complete({ turnId: 'n3', answer: 'ok', durationMs: 100, isAborted: false, reason: 'answer' })
    expect(toasts.filter(text => text.includes('Tarefa'))).toHaveLength(0)
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`the Task Command pane draws on ${surface}`, async ($, on) => {
      world(on)
      const ui = await $.ui.mount({
        plugin: 'big-bear',
        surface,
        component: 'Pane',
        requestId: 'bigbear',
        props: { title: 'BIG BEAR', isFocused: false, bodyColumns: 90, placement: 'dock', scroll: SCROLL, view: {} },
      })
      expect(await shows(ui as unknown as Drawn, /^BIG BEAR$/)).toBe(true)
      expect(await shows(ui as unknown as Drawn, /TOKEN INTELLIGENCE/)).toBe(true)
      expect(await shows(ui as unknown as Drawn, /Ocioso/)).toBe(true)
      expect(await shows(ui as unknown as Drawn, /0 EXECUTANDO/)).toBe(true)
      expect(await shows(ui as unknown as Drawn, /TRABALHANDO HÁ ocioso/)).toBe(true)
      expect(await shows(ui as unknown as Drawn, /TRABALHOU 0s/)).toBe(true)
      expect(await shows(ui as unknown as Drawn, /RESTA —/)).toBe(true)
      expect(await shows(ui as unknown as Drawn, /0 CONCLUÍDAS/)).toBe(true)
      await ui.press({ key: 'mode:god' })
      const status = await $.command.run(run('status'))
      expect(status.text).toContain('GOD')
      await ui.unmount()
    })

    test(`the pane fits a narrow column on ${surface}`, async ($, on) => {
      world(on)
      const ui = await $.ui.mount({
        plugin: 'big-bear',
        surface,
        component: 'Pane',
        requestId: 'bigbear',
        props: { title: 'BIG BEAR', isFocused: false, bodyColumns: 40, placement: 'inline', scroll: SCROLL, view: {} },
      })
      expect(await shows(ui as unknown as Drawn, /^BIG BEAR$/)).toBe(true)
      await ui.unmount()
    })

    test(`the usage band draws on ${surface}`, async ($, on) => {
      world(on)
      const ui = await $.ui.mount({
        plugin: 'big-bear',
        surface,
        component: 'AbovePrompt',
        props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 120, scroll: { offset: 0, bodyRows: 4 }, view: {} },
      })
      expect(await shows(ui as unknown as Drawn, /5H N\/D/)).toBe(true)
      expect(await shows(ui as unknown as Drawn, /BALANCED/)).toBe(true)
      await ui.unmount()
    })

    test(`settings and showcase draw on ${surface}`, async ($, on) => {
      world(on)
      const settings = await $.ui.mount({
        plugin: 'big-bear',
        surface,
        component: 'Pane',
        requestId: 'bigbear-settings',
        props: { title: 'Settings', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: SCROLL, view: {} },
      })
      await settings.press({ key: 'mod:autoQa' })
      expect((await settings.find({ key: 'mod:autoQa' }))?.text).toContain('○')
      await settings.unmount()
      const showcase = await $.ui.mount({
        plugin: 'big-bear',
        surface,
        component: 'Pane',
        requestId: 'bigbear-showcase',
        props: { title: 'Showcase', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: SCROLL, view: {} },
      })
      expect(await shows(showcase as unknown as Drawn, /BIG BEAR DEV ORCHESTRATOR/)).toBe(true)
      await showcase.unmount()
    })
  }
})
