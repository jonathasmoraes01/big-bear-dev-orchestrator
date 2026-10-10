import type {
  BigBearActivity,
  BigBearAlert,
  BigBearConfig,
  BigBearGit,
  BigBearMetrics,
  BigBearMode,
  BigBearQa,
  BigBearStatus,
  BigBearTask,
  BigBearTier,
  BigBearUsage,
} from '../../../types'
import { TIERS } from '../config/defaults'
import { isOpen, MILESTONES, overall } from '../core/tasks'
import { pendingChanges } from '../modules/git'
import { distribution, savings, sessionCost, sessionTokens, totalTokens } from '../services/pricing'
import { compact, duration, projectName, untilReset, usd } from '../utils/format'

/**
 * What the panel shows, computed once from the session values: plain data
 * both renderers read (the desktop's SVG and the terminal's text).
 */
export type Level = 'ok' | 'info' | 'warn' | 'danger' | 'idle'

export type TaskView = {
  id: string
  title: string
  tier: BigBearTier
  status: BigBearStatus
  /** Reached milestones over all: 0..1. */
  progress: number
  isLive: boolean
  elapsed: string
  /** ETA left, or a reason there is none. */
  eta: string | null
  tokens: string
  errors: number
  detail: string
  children: TaskView[]
}

export type Tile = { label: string; value: string; level: Level }

export type PanelView = {
  activity: BigBearActivity
  statusLabel: string
  mode: BigBearMode
  tier: BigBearTier | null
  isRouting: boolean
  isManual: boolean
  project: string
  branch: string | null
  overall: { done: number; total: number; percent: number | null; elapsed: string; eta: string }
  segments: { status: BigBearStatus; tier: BigBearTier }[]
  running: TaskView[]
  finished: TaskView[]
  hiddenFinished: number
  tokens: { total: string; input: string; output: string; cache: string; current: string }
  cost: { total: string; byTier: Record<BigBearTier, string>; pricedAt: string }
  savings: { isAvailable: boolean; percent: string; saved: string; tokensSaved: string; baseline: BigBearTier; level: Level }
  share: Record<BigBearTier, number> | null
  guardians: { git: Tile; qa: Tile; security: Tile; context: Tile }
  alert: { text: string; level: Level } | null
}

export type BandView = {
  mode: BigBearMode
  tier: BigBearTier | null
  isRouting: boolean
  activity: BigBearActivity
  fiveHour: { percent: number; level: Level } | null
  week: { percent: number; level: Level } | null
  reset: string | null
  context: number | null
  status: { label: string; level: Level }
}

export const ACTIVITY_STATUS: Record<BigBearActivity, string> = {
  idle: 'Ocioso',
  research: 'Pesquisando',
  work: 'Em execução',
}

export function usageLevel(percent: number, config: BigBearConfig): Level {
  if (percent >= config.usage.critical) return 'danger'
  if (percent >= config.usage.high) return 'danger'
  if (percent >= config.usage.warn) return 'warn'
  return 'ok'
}

function taskView(task: BigBearTask, all: readonly BigBearTask[], now: number): TaskView {
  const elapsedMs = (task.endedAt ?? now) - task.startedAt
  const tokens = totalTokens(task.tokens)
  let eta: string | null = null
  if (isOpen(task)) eta = task.etaMs === null ? 'calculando' : `~${duration(Math.max(0, task.etaMs - elapsedMs))}`
  return {
    id: task.id,
    title: task.title,
    tier: task.tier,
    status: task.status,
    progress: task.milestones / MILESTONES,
    isLive: isOpen(task),
    elapsed: duration(elapsedMs),
    eta,
    tokens: tokens > 0 ? `${compact(tokens)} tok` : '—',
    errors: task.toolErrors,
    detail: [
      `#${task.id} · ${task.category} · ${task.model}`,
      `${task.milestones}/${MILESTONES} marcos · ${task.steps} passos · ${task.toolCalls} ferramentas${task.toolErrors > 0 ? ` (${task.toolErrors} erros)` : ''}`,
      `${usd(task.costUsd)} eq. API · ${task.escalations} escalonamentos`,
      ...task.reasons,
      ...(task.result !== undefined ? [`↳ ${task.result}`] : []),
      ...(task.error !== undefined ? [`✗ ${task.error}`] : []),
    ].join('\n'),
    children: all.filter(child => child.parentId === task.id).map(child => taskView(child, [], now)),
  }
}

export function panelView(args: {
  config: BigBearConfig
  tasks: readonly BigBearTask[]
  metrics: BigBearMetrics
  usage: BigBearUsage | null
  git: BigBearGit | null
  qa: BigBearQa
  alerts: readonly BigBearAlert[]
  activity: BigBearActivity
  decisionTier: BigBearTier | null
  project: string
  now: number
  showAll: boolean
}): PanelView {
  const { config, tasks, metrics, usage, git, qa, alerts, now } = args
  const roots = tasks.filter(task => task.kind === 'turn')
  const live = roots.find(isOpen)
  const all = overall(tasks, now)
  const tokens = sessionTokens(metrics)
  const save = savings(metrics)
  const finished = roots.filter(task => !isOpen(task)).reverse()
  const finishedShown = args.showAll ? finished : finished.slice(0, 4)

  const gitTile: Tile =
    git === null
      ? { label: 'Git', value: '—', level: 'idle' }
      : !git.isRepo
        ? { label: 'Git', value: 'sem repositório', level: 'idle' }
        : git.conflicts > 0
          ? { label: 'Git', value: `${git.conflicts} conflitos`, level: 'danger' }
          : git.merging
            ? { label: 'Git', value: 'merge em curso', level: 'warn' }
            : pendingChanges(git) > 0
              ? { label: 'Git', value: `${pendingChanges(git)} alterações`, level: 'info' }
              : { label: 'Git', value: 'limpo', level: 'ok' }
  const qaTile: Tile =
    qa.profile === null
      ? { label: 'QA', value: 'não executado', level: 'idle' }
      : qa.lastResult === null
        ? { label: 'QA', value: 'rodando', level: 'info' }
        : qa.lastResult === 'passed'
          ? { label: 'QA', value: 'passou', level: 'ok' }
          : { label: 'QA', value: `falhou · ${qa.steps.filter(s => s.status === 'failed').length}`, level: 'danger' }
  const security = alerts.filter(a => a.module === 'codeGuardian')
  const securityTile: Tile =
    security.length === 0
      ? { label: 'Segurança', value: 'sem alertas', level: 'ok' }
      : { label: 'Segurança', value: `${security.length} alerta${security.length > 1 ? 's' : ''}`, level: security.some(a => a.level === 'danger') ? 'danger' : 'warn' }
  const ctx = usage?.contextPercent ?? null
  const contextTile: Tile =
    ctx === null
      ? { label: 'Contexto', value: 'N/D', level: 'idle' }
      : { label: 'Contexto', value: `${ctx}%`, level: ctx >= config.context.warnPercent ? 'warn' : 'ok' }
  const last = alerts.at(-1)

  return {
    activity: args.activity,
    statusLabel: ACTIVITY_STATUS[args.activity],
    mode: config.routing.mode,
    tier: live?.tier ?? args.decisionTier,
    isRouting: config.routing.enabled && config.modules.smartBrain,
    isManual: config.routing.manualTier !== null,
    project: projectName(args.project) || 'sem projeto',
    branch: git?.isRepo === true ? git.branch : null,
    overall: {
      done: all.done,
      total: all.total,
      percent: all.percent,
      elapsed: duration(all.elapsedMs),
      eta: all.total === 0 ? '—' : all.total === all.done ? 'concluído' : all.etaMs === null ? 'calculando' : `~${duration(all.etaMs)}`,
    },
    segments: roots.slice(-24).map(task => ({ status: task.status, tier: task.tier })),
    running: roots.filter(isOpen).map(task => taskView(task, tasks, now)),
    finished: finishedShown.map(task => taskView(task, tasks, now)),
    hiddenFinished: finished.length - finishedShown.length,
    tokens: {
      total: compact(totalTokens(tokens)),
      input: compact(tokens.input),
      output: compact(tokens.output),
      cache: compact(tokens.cacheRead + tokens.cacheWrite),
      current: live !== undefined ? compact(totalTokens(live.tokens)) : '—',
    },
    cost: {
      total: usd(sessionCost(metrics)),
      byTier: { haiku: usd(metrics.byTier.haiku.costUsd), sonnet: usd(metrics.byTier.sonnet.costUsd), opus: usd(metrics.byTier.opus.costUsd) },
      pricedAt: config.pricing.updatedAt,
    },
    savings: save.isAvailable
      ? {
          isAvailable: true,
          percent: `${save.percent >= 0 ? '−' : '+'}${Math.abs(save.percent).toFixed(0)}%`,
          saved: usd(Math.abs(save.savedUsd)),
          tokensSaved: save.tokensSaved > 0 ? `~${compact(save.tokensSaved)}` : '0',
          baseline: config.pricing.baseline,
          level: save.percent >= 0 ? 'ok' : 'warn',
        }
      : { isAvailable: false, percent: '—', saved: 'sem dados', tokensSaved: '—', baseline: config.pricing.baseline, level: 'idle' },
    share: distribution(metrics),
    guardians: { git: gitTile, qa: qaTile, security: securityTile, context: contextTile },
    alert: last === undefined ? null : { text: last.text, level: last.level === 'danger' ? 'danger' : last.level === 'warn' ? 'warn' : 'info' },
  }
}

export function bandView(args: {
  config: BigBearConfig
  usage: BigBearUsage | null
  activity: BigBearActivity
  tier: BigBearTier | null
  now: number
}): BandView {
  const { config, usage } = args
  const five = usage?.fiveHour ?? null
  const week = usage?.week ?? null
  const worst = Math.max(five?.percent ?? 0, week?.percent ?? 0)
  const status =
    worst >= config.usage.critical
      ? { label: 'Limite próximo', level: 'danger' as const }
      : worst >= config.usage.high
        ? { label: 'Consumo elevado', level: 'danger' as const }
        : worst >= config.usage.warn
          ? { label: 'Atenção', level: 'warn' as const }
          : { label: ACTIVITY_STATUS[args.activity], level: args.activity === 'idle' ? ('idle' as const) : ('ok' as const) }
  return {
    mode: config.routing.mode,
    tier: args.tier,
    isRouting: config.routing.enabled && config.modules.smartBrain,
    activity: args.activity,
    fiveHour: five === null ? null : { percent: five.percent, level: usageLevel(five.percent, config) },
    week: week === null ? null : { percent: week.percent, level: usageLevel(week.percent, config) },
    reset: five?.resetsAt !== undefined ? untilReset(five.resetsAt, args.now) : null,
    context: usage?.contextPercent ?? null,
    status,
  }
}

export { TIERS }
