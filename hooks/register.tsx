import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { COMMAND, runCommand } from './src/commands'
import {
  afterSpawn,
  afterStep,
  afterTool,
  beforeSpawn,
  beforeStep,
  beforeTool,
  onPromptSubmit,
  onTurnComplete,
  onTurnStart,
} from './src/core/orchestrator'
import type { BigBearQa, BigBearTask } from '../types'
import { DEFAULT_CONFIG } from './src/config/defaults'
import { runtime } from './src/core/runtime'
import { isOpen } from './src/core/tasks'
import { guardEdit, guardShell, shellFallback } from './src/modules/guard-hooks'
import type { EditInput } from './src/modules/guard-hooks'
import { onMeasure } from './src/modules/monitor'
import { loadHistory, loadSettings, refreshGit, usageSnapshot } from './src/services/engine'
import type { Io } from './src/services/io'
import { emptyMetrics } from './src/services/pricing'
import type { ApiUsage } from './src/services/pricing'
import { renderBand } from './src/ui/band'
import { kitOf } from './src/ui/kit'
import { MAIN_PANE, renderMainPane } from './src/ui/pane'
import { renderSettings, SETTINGS_PANE } from './src/ui/settings'
import { renderShowcase, SHOWCASE_PANE } from './src/ui/showcase'

// The session values, held by the host so a hot reload keeps them.
const configAtom = atom({ plugin: 'big-bear', key: 'config' } as const, DEFAULT_CONFIG)
const decisionAtom = atom({ plugin: 'big-bear', key: 'decision' } as const, null)
const tasksAtom = atom({ plugin: 'big-bear', key: 'tasks' } as const, [])
const metricsAtom = atom({ plugin: 'big-bear', key: 'metrics' } as const, emptyMetrics())
const usageAtom = atom({ plugin: 'big-bear', key: 'usage' } as const, null)
const gitAtom = atom({ plugin: 'big-bear', key: 'git' } as const, null)
const qaAtom = atom({ plugin: 'big-bear', key: 'qa' } as const, {
  profile: null,
  startedAt: null,
  endedAt: null,
  steps: [],
  lastResult: null,
} satisfies BigBearQa)
const alertsAtom = atom({ plugin: 'big-bear', key: 'alerts' } as const, [])
const viewAtom = atom({ plugin: 'big-bear', key: 'view' } as const, { expanded: null, showAll: false })
const tickAtom = atom({ plugin: 'big-bear', key: 'tick' } as const, 0)
const projectAtom = atom({ plugin: 'big-bear', key: 'project' } as const, '')
const activityAtom = atom({ plugin: 'big-bear', key: 'activity' } as const, 'idle')


/**
 * BIG BEAR DEV ORCHESTRATOR — Code Smarter. Build Faster. Spend Less.
 *
 * This file is the event-capture layer and the only one that holds `$`: the
 * engine follows `$` into functions of this file alone, so it hands the
 * modules an `Io` built here. Each event is its own hook, so a module that
 * fails is skipped by the engine (or answered by its `.catch`) while the
 * rest keep running.
 */
function io($: EngineInterface): Io {
  return {
    // Each value spelled out: the engine reads every state access statically.
    state: {
      config: { get: () => read($, configAtom), set: change => update($, configAtom, change) },
      decision: { get: () => read($, decisionAtom), set: change => update($, decisionAtom, change) },
      tasks: { get: () => read($, tasksAtom), set: change => update($, tasksAtom, change) },
      metrics: { get: () => read($, metricsAtom), set: change => update($, metricsAtom, change) },
      usage: { get: () => read($, usageAtom), set: change => update($, usageAtom, change) },
      git: { get: () => read($, gitAtom), set: change => update($, gitAtom, change) },
      qa: { get: () => read($, qaAtom), set: change => update($, qaAtom, change) },
      alerts: { get: () => read($, alertsAtom), set: change => update($, alertsAtom, change) },
      view: { get: () => read($, viewAtom), set: change => update($, viewAtom, change) },
      tick: { get: () => read($, tickAtom), set: change => update($, tickAtom, change) },
      project: { get: () => read($, projectAtom), set: change => update($, projectAtom, change) },
      activity: { get: () => read($, activityAtom), set: change => update($, activityAtom, change) },
    },
    clock: {
      now: () => $.clock.now(),
      after: (ms, fn) => $.clock.after(ms, fn),
      every: (ms, fn) => $.clock.every(ms, fn),
    },
    ui: {
      toast: (text, options) => $.ui.toast(text, options),
      log: (text, options) => $.ui.log(text, options),
      open: pane => $.ui.open(pane),
      close: pane => $.ui.close(pane),
      panes: () => $.ui.panes(),
      ask: (question, options) => $.ui.ask(question, options),
      copy: args => $.ui.copy(args),
    },
    store: {
      get: key => $.store.get(key),
      set: (key, value) => $.store.set(key, value),
      delete: key => $.store.delete(key),
      keys: () => $.store.keys(),
    },
    process: { run: (argv, init) => $.process.run(argv, init) },
    fs: { list: path => $.fs.list(path), read: path => $.fs.read(path) },
    session: {
      root: () => $.session.root(),
      model: () => $.session.model(),
      usage: args => $.session.usage(args),
      version: () => $.session.version(),
      surfaces: () => $.session.surfaces(),
    },
    command: { list: () => $.command.list(), register: spec => $.command.register(spec) },
    model: {
      complete: (request, options) => $.model.complete(request, options),
      classify: (text, labels, options) => $.model.classify(text, labels, options),
    },
    prompt: { submit: input => $.prompt.submit(input) },
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const x = io($)
    runtime.session = x
    runtime.root = await $.session.root()
    await update($, projectAtom, () => runtime.root)

    const config = await loadSettings(x, runtime.root)
    await update($, configAtom, () => config)
    runtime.history = await loadHistory(x)

    // Ids continue after the tasks the host kept across a reload.
    const tasks = await read($, tasksAtom)
    runtime.nextId = tasks.reduce((max, task) => Math.max(max, Number(task.id) || 0), 0) + 1

    const clash = (await $.command.list()).find(command => command.name === COMMAND && command.source !== 'plugin')
    if (clash !== undefined) $.ui.log(`big-bear: /${COMMAND} também existe como comando ${clash.source}.`)
    await $.command.register({
      name: COMMAND,
      description: '🐻 BIG BEAR: central de orquestração (status, mode, qa, bug, settings, showcase, doctor...)',
      argumentHint: '[status|mode eco|balanced|god|model|qa|bug|tasks|usage|models|history|settings|showcase|doctor|on|off|help]',
    })

    const usage = await $.session.usage()
    const now = await $.clock.now()
    await update($, usageAtom, () => usageSnapshot(now, usage))
    if (config.modules.gitGuardian) void refreshGit(x, runtime.root)

    // One ticker, writing only while a task runs, so elapsed times move.
    $.clock.every(config.ui.refreshMs, async () => {
      const list = await read($, tasksAtom)
      if (list.some(isOpen)) await update($, tickAtom, n => n + 1)
    })

    if (config.ui.autoOpenPane && config.modules.taskCommand) {
      const isUp = (await $.ui.panes()).some(pane => pane.id === MAIN_PANE)
      if (!isUp) void $.ui.open({ id: MAIN_PANE, title: 'BIG BEAR' })
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // ── Smart Brain and Task Command ──────────────────────────────────────────
  on('prompt.submit', async ($, e, next) => {
    await onPromptSubmit(io($), e.text)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    await onTurnStart(io($), e.turnId, e.text)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    let model: string | null = null
    try {
      model = await beforeStep(io($), e.turnId, e.agentId, e.model)
    } catch {
      model = null
    }
    const result = yield* next(model === null ? e : { ...e, model })
    try {
      await afterStep(io($), e.turnId, e.agentId, result.usage as ApiUsage | null, result.toolUses[0]?.name)
    } catch {
      // Metrics are best effort: the response stands either way.
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    await onTurnComplete(io($), {
      turnId: e.turnId,
      agentId: e.agentId,
      reason: e.reason,
      refusalCategory: e.reason === 'refusal' ? e.refusal.category : undefined,
      answer: e.answer,
    })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const planned = await beforeSpawn(io($), {
      description: e.description,
      prompt: e.prompt,
      subagentType: e.subagentType,
      model: e.model,
      parentModel: e.parentModel,
      fork: e.fork,
    })
    const result = await next(planned.model === null ? e : { ...e, model: planned.model })
    await afterSpawn(io($), planned.taskId, result)
    return result
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    let task: BigBearTask | undefined
    try {
      task = await beforeTool(io($), tool, e.agentId)
    } catch {
      task = undefined
    }
    const result = await next(e)
    await afterTool(io($), task, tool, result.deny !== undefined || result.isError === true)
    return result
  }).catch(($, e, next) => next(e))

  // ── Code Guardian and Git Guardian ────────────────────────────────────────
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => (await guardShell(io($), 'Bash', String(e.command ?? ''))) ?? next(e)).catch(($, e, next) =>
    next.called ? next(e) : (shellFallback(String(e.command ?? '')) ?? next(e)),
  )

  // PowerShell is a tool of some builds only: its name is not in this build's table.
  on('tool.call', { tool: 'PowerShell' as never }, async ($, e, next) => {
    const command = String((e as unknown as { command?: unknown }).command ?? '')
    return (await guardShell(io($), 'PowerShell', command)) ?? next(e)
  }).catch(($, e, next) => (next.called ? next(e) : (shellFallback(String((e as unknown as { command?: unknown }).command ?? '')) ?? next(e))))

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => (await guardEdit(io($), 'Edit', e as unknown as EditInput)) ?? next(e)).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'Write' }, async ($, e, next) => (await guardEdit(io($), 'Write', e as unknown as EditInput)) ?? next(e)).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'MultiEdit' as never }, async ($, e, next) => (await guardEdit(io($), 'MultiEdit', e as unknown as EditInput)) ?? next(e)).catch(
    ($, e, next) => next(e),
  )

  // ── Usage Monitor and Context Manager ─────────────────────────────────────
  on('session.measure', async ($, e, next) => {
    await onMeasure(io($), e)
    return next(e)
  }).catch(($, e, next) => next(e))

  // ── Commands ──────────────────────────────────────────────────────────────
  on('command.run', { command: COMMAND }, async ($, e) => runCommand(io($), e.args)).catch(() => ({
    text: '🐻 BIG BEAR: o comando falhou. Tente /bigbear doctor.',
  }))

  // ── Interface ─────────────────────────────────────────────────────────────
  on('ui.render', { component: 'Pane', requestId: MAIN_PANE }, async ($, e) =>
    renderMainPane(kitOf($.ui.resolve(e), e.surface), io($), e.props.bodyColumns, e.props.scroll.bodyRows),
  )

  on('ui.render', { component: 'Pane', requestId: SETTINGS_PANE }, async ($, e) => renderSettings(kitOf($.ui.resolve(e), e.surface), io($), e.props.bodyColumns))

  on('ui.render', { component: 'Pane', requestId: SHOWCASE_PANE }, async ($, e) => renderShowcase(kitOf($.ui.resolve(e), e.surface), io($), e.props.bodyColumns))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const config = await read($, configAtom)
    if (e.props.hasSurvey || !config.ui.showBand || !config.modules.usageMonitor) return next(e)
    return renderBand(kitOf($.ui.resolve(e), e.surface), io($), e.props.bodyColumns)
  })
}
