import type { On } from 'claude-code'
import type { Io } from '../services/io'

import type { BigBearActivity, BigBearCategory, BigBearDecision, BigBearTask } from '../../../types'
import { refreshGit, alert, runQa, projectFacts, saveHistory } from '../services/engine'
import { appendHistory, estimateMs, failureStats, toRecord } from '../services/analytics'
import { addStep, priceStep, totalTokens } from '../services/pricing'
import { compact, duration } from '../utils/format'
import type { ApiUsage } from '../services/pricing'
import { redactPaths, redactSecrets } from '../modules/guardian'
import { planQa } from '../modules/qa'
import { classify } from './classifier'
import { notificationSummary, titleFor } from './title'
import type { Classification } from './classifier'
import { decide, shouldEscalate, subagentTier, tierOfModel } from './router'
import { newId, runtime } from './runtime'
import { MAX_TASKS } from './state'
import { activityForTasks, activityForTool, addUsage, finish, isOpen, newTask, patch } from './tasks'


const CATEGORIES: readonly BigBearCategory[] = ['lookup', 'docs', 'test', 'bugfix', 'feature', 'refactor', 'architecture', 'audit', 'critical']
const EDIT_TOOLS = /^(Edit|Write|MultiEdit|NotebookEdit)$/

/** The task's title: its kind and a clean summary, never raw markup (see core/title.ts). */
function title(text: string, category: BigBearCategory): string {
  return titleFor(redactSecrets(text), category)
}

async function setActivity(io: Io, activity: BigBearActivity): Promise<void> {
  const current = await io.state.activity.get()
  if (current !== activity) await io.state.activity.set(() => activity)
}

async function writeTasks(io: Io, change: (tasks: BigBearTask[]) => BigBearTask[]): Promise<BigBearTask[]> {
  return io.state.tasks.set(tasks => {
    const next = change(tasks)
    // Keep the newest; drop finished ones first.
    if (next.length <= MAX_TASKS) return next
    const overflow = next.length - MAX_TASKS
    let dropped = 0
    return next.filter(task => (dropped < overflow && !isOpen(task) ? (dropped++, false) : true))
  })
}

/** Refines a weak rules verdict with one small-model call: opt-in only. */
async function refine(io: Io, text: string, c: Classification): Promise<Classification> {
  const config = await io.state.config.get()
  if (!config.routing.aiClassifier || c.confidence >= 0.5 || c.category === 'continue' || c.category === 'trivial') return c
  try {
    const label = await io.model.classify(text.slice(0, 4000), CATEGORIES, { model: config.routing.models.haiku })
    if (label === undefined) return c
    return { ...c, category: label as BigBearCategory, signals: [...c.signals, `IA: ${label}`], confidence: 0.7 }
  } catch {
    return c
  }
}

async function makeDecision(io: Io, text: string): Promise<BigBearDecision> {
  const config = await io.state.config.get()
  const usage = await io.state.usage.get()
  const c = await refine(io, text, classify(notificationSummary(text) !== null ? '' : text))
  const decision = decide(config, c, {
    previous: runtime.previous,
    now: await io.clock.now(),
    contextTokens: usage?.contextTokens ?? null,
    history: config.routing.learnFromHistory ? failureStats(runtime.history) : {},
  })
  if (runtime.forced !== null) {
    const forced = runtime.forced
    runtime.forced = null
    return { ...decision, tier: forced.tier, model: config.routing.models[forced.tier], reasons: forced.reasons, source: forced.source }
  }
  return decision
}

const FINISH_ICON: Record<string, string> = { COMPLETED: '✓', FAILED: '✗', CANCELLED: '–' }
const FINISH_WORD: Record<string, string> = { COMPLETED: 'concluída', FAILED: 'falhou', CANCELLED: 'cancelada' }

/** The one-line notification for a finished task: outcome, model, title, time, tokens. */
function finishMessage(task: BigBearTask): string {
  const ms = (task.endedAt ?? task.startedAt) - task.startedAt
  const tokens = totalTokens(task.tokens)
  const title = task.title.length > 60 ? `${task.title.slice(0, 59)}…` : task.title
  const parts = [`${FINISH_ICON[task.status] ?? '•'} ${task.kind === 'subagent' ? 'Subagente' : 'Tarefa'} ${FINISH_WORD[task.status] ?? task.status.toLowerCase()}`, task.tier.toUpperCase(), title, duration(ms)]
  if (tokens > 0) parts.push(`${compact(tokens)} tok`)
  return `🐻 ${parts.join(' · ')}`
}

async function finishTask(io: Io, taskId: string, status: BigBearTask['status'], extra: Partial<BigBearTask>): Promise<BigBearTask | undefined> {
  const now = await io.clock.now()
  const tasks = await writeTasks(io, list => patch(list, taskId, task => finish(task, status, now, extra)))
  const task = tasks.find(t => t.id === taskId)
  const config = await io.state.config.get()
  if (task !== undefined && config.ui.notifyOnFinish) io.ui.toast(finishMessage(task))
  if (task !== undefined && config.modules.devAnalytics && task.kind === 'turn') {
    const record = toRecord(task, runtime.root)
    if (record !== null) {
      runtime.history = appendHistory(runtime.history, record)
      await saveHistory(io, runtime.history)
    }
  }
  return task
}

async function maybeRefreshGit(io: Io): Promise<void> {
  const config = await io.state.config.get()
  if (!config.modules.gitGuardian) return
  const now = await io.clock.now()
  if (now - runtime.lastGitAt < 5000) return
  runtime.lastGitAt = now
  await refreshGit(io, runtime.root)
}

/** Runs QA on the session's own `$`, after the turn that changed files ended. */
function scheduleQa(taskId: string): void {
  const session = runtime.session
  if (session === null || runtime.qaRunning) return
  runtime.qaRunning = true
  session.clock.after(0, async () => {
    try {
      const config = await session.state.config.get()
      const plan = planQa(await projectFacts(session, runtime.root), config.qa.profile)
      const result = await runQa(session, runtime.root, plan)
      const qa = await session.state.qa.get()
      const failedStep = qa.steps.find(step => step.status === 'failed')
      if (result === 'failed') {
        await finishTask(session, taskId, 'FAILED', { error: `QA falhou: ${failedStep?.name ?? '?'}` })
        await alert(session, 'autoQa', 'danger', `Auto QA falhou em ${failedStep?.name ?? '?'}`)
        session.ui.toast(`🐻 Auto QA: falhou em ${failedStep?.name ?? '?'}`)
      } else {
        await finishTask(session, taskId, 'COMPLETED', { result: result === 'passed' ? 'verificado: QA passou' : 'verificado: turno respondido; perfil de QA sem passos' })
      }
    } catch (error) {
      await finishTask(session, taskId, 'COMPLETED', { result: 'turno respondido; QA não pôde rodar', error: error instanceof Error ? error.message.slice(0, 200) : String(error) })
    } finally {
      runtime.qaRunning = false
      await setActivity(session, activityForTasks(await session.state.tasks.get(), 'idle'))
    }
  })
}

// ─── Event handlers. hooks/register.tsx captures the events and calls these. ───

/** prompt.submit — steps 1-8: intercept, classify, weigh risk, pick a model, record why. */
export async function onPromptSubmit(io: Io, text: string): Promise<void> {
  const config = await io.state.config.get()
  if (text.trimStart().startsWith('/') || (!config.modules.smartBrain && !config.modules.taskCommand)) return
  const decision = await makeDecision(io, text)
  if (!config.modules.smartBrain) decision.reasons = ['Smart Brain desligado: só acompanhamento']
  const routed = config.routing.enabled && config.modules.smartBrain
  if (!routed) {
    decision.model = await io.session.model()
    decision.tier = tierOfModel(decision.model) ?? decision.tier
  }
  await io.state.decision.set(() => decision)
  const id = newId()
  const now = await io.clock.now()
  await writeTasks(io, tasks => [
    ...tasks,
    newTask({ id, now, title: title(text, decision.category), decision, routed, etaMs: estimateMs(runtime.history, decision.category, decision.tier) }),
  ])
  runtime.pendingTaskId = id
  await setActivity(io, 'research')
}

export async function onTurnStart(io: Io, turnId: string, text: string): Promise<void> {
  const config = await io.state.config.get()
  let taskId = runtime.pendingTaskId
  runtime.pendingTaskId = null
  const routed = config.routing.enabled && config.modules.smartBrain
  if (taskId === null) {
    // A turn no typed prompt began (a continuation, a delivery): tracked too.
    const decision = await makeDecision(io, '')
    if (!routed) {
      decision.model = await io.session.model()
      decision.tier = tierOfModel(decision.model) ?? decision.tier
    }
    const id = newId()
    taskId = id
    const now = await io.clock.now()
    await writeTasks(io, tasks => [...tasks, newTask({ id, now, title: title(text, decision.category), decision, routed, etaMs: null })])
  }
  const id = taskId
  const tasks = await writeTasks(io, list => patch(list, id, task => ({ ...task, turnId, status: 'RUNNING', milestones: Math.max(task.milestones, 2) })))
  const task = tasks.find(t => t.id === id)
  runtime.turns.set(turnId, { taskId: id, tier: task?.tier ?? 'sonnet', routed, escalations: 0, toolErrors: 0, hadEdits: false })
}

/**
 * turn.step, before the request: steps 9-10. Returns the model the request
 * should name, or null to leave it. Escalates one tier when the turn keeps
 * failing, within the configured limit.
 */
export async function beforeStep(io: Io, turnId: string, agentId: string | undefined, model: string): Promise<string | null> {
  if (agentId !== undefined) return null
  const run = runtime.turns.get(turnId)
  const config = await io.state.config.get()
  if (run === undefined || !run.routed || !config.routing.enabled || !config.modules.smartBrain) return null
  const up = shouldEscalate(config, { tier: run.tier, escalations: run.escalations, toolErrors: run.toolErrors })
  if (up !== null) {
    const from = run.tier
    run.tier = up
    run.escalations++
    await io.state.metrics.set(m => ({ ...m, escalations: m.escalations + 1 }))
    await writeTasks(io, list =>
      patch(list, run.taskId, task => ({
        ...task,
        tier: up,
        model: config.routing.models[up],
        escalations: task.escalations + 1,
        reasons: [...task.reasons, `escalonado ${from.toUpperCase()} → ${up.toUpperCase()} após ${run.toolErrors} erros de ferramenta`],
      })),
    )
    io.ui.toast(`🐻 Escalonando ${from.toUpperCase()} → ${up.toUpperCase()}`)
  }
  const wanted = config.routing.models[run.tier]
  return wanted === model ? null : wanted
}

/** turn.step, after the response: tokens and cost per model, the avatar. */
export async function afterStep(io: Io, turnId: string, agentId: string | undefined, usage: ApiUsage | null, firstTool: string | undefined): Promise<void> {
  const config = await io.state.config.get()
  if (usage !== null && config.modules.tokenIntelligence) {
    const step = priceStep(config, usage)
    await io.state.metrics.set(m => addStep(m, usage.model, step))
    const run = agentId === undefined ? runtime.turns.get(turnId) : undefined
    const taskId = run?.taskId ?? (agentId !== undefined ? (await io.state.tasks.get()).find(t => t.agentId === agentId)?.id : undefined)
    if (taskId !== undefined) {
      await writeTasks(io, list =>
        patch(list, taskId, task => ({ ...addUsage(task, step.tokens, step.costUsd), steps: task.steps + 1, milestones: Math.max(task.milestones, 3) })),
      )
    }
  }
  if (firstTool !== undefined) await setActivity(io, activityForTool(firstTool))
}

export type TurnEnd = {
  turnId: string
  agentId?: string
  reason: 'answer' | 'aborted' | 'refusal' | 'error'
  refusalCategory?: string | null
  answer: string
}

export async function onTurnComplete(io: Io, end: TurnEnd): Promise<void> {
  const answer = redactPaths(redactSecrets(end.answer)).replace(/\s+/g, ' ').slice(0, 160)
  if (end.agentId !== undefined) {
    const child = (await io.state.tasks.get()).find(t => t.agentId === end.agentId && isOpen(t))
    if (child !== undefined) {
      await finishTask(io, child.id, end.reason === 'answer' ? 'COMPLETED' : end.reason === 'aborted' ? 'CANCELLED' : 'FAILED', {
        result: answer || undefined,
        error: end.reason === 'answer' ? undefined : end.reason,
      })
    }
    return
  }
  const run = runtime.turns.get(end.turnId)
  runtime.turns.delete(end.turnId)
  const config = await io.state.config.get()
  if (run !== undefined) {
    runtime.previous = { tier: run.tier, endedAt: await io.clock.now() }
    if (end.reason === 'answer') {
      if (config.modules.autoQa && config.qa.autoRun && run.hadEdits) {
        await writeTasks(io, list => patch(list, run.taskId, task => ({ ...task, status: 'VALIDATING', milestones: 4, result: answer || undefined })))
        scheduleQa(run.taskId)
      } else {
        await finishTask(io, run.taskId, 'COMPLETED', { result: answer || 'turno encerrado com resposta' })
      }
    } else if (end.reason === 'aborted') {
      await finishTask(io, run.taskId, 'CANCELLED', {})
    } else {
      await finishTask(io, run.taskId, 'FAILED', { error: end.reason === 'refusal' ? `recusa: ${end.refusalCategory ?? 'sem categoria'}` : 'erro de API' })
    }
  }
  await setActivity(io, activityForTasks(await io.state.tasks.get(), 'idle'))
  await maybeRefreshGit(io)
}

export type SpawnInput = { description: string; prompt: string; subagentType: string; model?: string; parentModel: string; fork: boolean }

/** agent.spawn, before: pick a model when the spawn named none; open a child task. */
export async function beforeSpawn(io: Io, e: SpawnInput): Promise<{ taskId: string; model: string | null }> {
  const config = await io.state.config.get()
  const c = classify(`${e.description}\n${e.prompt}`)
  const shouldRoute = config.routing.enabled && config.modules.smartBrain && config.routing.routeSubagents && e.model === undefined && !e.fork
  const tier = shouldRoute ? subagentTier(config, e.subagentType, c) : (tierOfModel(e.model ?? e.parentModel) ?? 'sonnet')
  const parent = (await io.state.tasks.get()).filter(t => t.kind === 'turn' && isOpen(t)).at(-1)
  const id = newId()
  const now = await io.clock.now()
  const decision: BigBearDecision = {
    tier,
    model: shouldRoute ? config.routing.models[tier] : (e.model ?? e.parentModel),
    category: c.category,
    complexity: c.complexity,
    risk: c.risk,
    reasons: shouldRoute ? [`subagente ${e.subagentType}: ${tier.toUpperCase()}`] : [`subagente ${e.subagentType}: modelo definido pela chamada`],
    files: c.files,
    source: 'rules',
    confidence: c.confidence,
  }
  await writeTasks(io, list => [
    ...list,
    newTask({ id, now, title: `${e.subagentType} — ${title(e.description, decision.category)}`, decision, routed: shouldRoute, etaMs: null, kind: 'subagent', parentId: parent?.id }),
  ])
  return { taskId: id, model: shouldRoute ? config.routing.models[tier] : null }
}

export async function afterSpawn(io: Io, taskId: string, result: { deny?: string; agentId?: string; model?: string }): Promise<void> {
  if (result.deny !== undefined) {
    await finishTask(io, taskId, 'FAILED', { error: result.deny })
    return
  }
  await writeTasks(io, list =>
    patch(list, taskId, task => ({
      ...task,
      agentId: result.agentId,
      model: result.model ?? task.model,
      status: 'RUNNING',
      milestones: 2,
      tier: tierOfModel(result.model) ?? task.tier,
    })),
  )
}

/** tool.call, before: counts and the avatar. Returns the task it belongs to. */
export async function beforeTool(io: Io, tool: string, agentId: string | undefined): Promise<BigBearTask | undefined> {
  const tasks = await io.state.tasks.get()
  const task = agentId !== undefined ? tasks.find(t => t.agentId === agentId && isOpen(t)) : tasks.filter(t => t.kind === 'turn' && isOpen(t)).at(-1)
  await setActivity(io, activityForTool(tool))
  if (task !== undefined) {
    await writeTasks(io, list =>
      patch(list, task.id, t => ({ ...t, toolCalls: t.toolCalls + 1, status: t.status === 'RUNNING' ? 'WAITING' : t.status, pendingTool: tool })),
    )
  }
  return task
}

/** tool.call, after: errors feed escalation; edits arm Auto QA. */
export async function afterTool(io: Io, task: BigBearTask | undefined, tool: string, failed: boolean): Promise<void> {
  if (task === undefined) return
  await writeTasks(io, list =>
    patch(list, task.id, t => ({ ...t, toolErrors: t.toolErrors + (failed ? 1 : 0), status: t.status === 'WAITING' ? 'RUNNING' : t.status, pendingTool: undefined })),
  )
  const run = task.turnId !== undefined ? runtime.turns.get(task.turnId) : undefined
  if (run !== undefined) {
    if (failed) run.toolErrors++
    if (!failed && EDIT_TOOLS.test(tool)) run.hadEdits = true
  }
}
