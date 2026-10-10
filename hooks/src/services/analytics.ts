import type { BigBearCategory, BigBearStatus, BigBearTask, BigBearTier } from '../../../types'
import type { HistoryStat } from '../core/router'
import { totalTokens } from './pricing'

/** One finished task as Dev Analytics keeps it: no prompt text, no code. */
export type HistoryRecord = {
  at: number
  project: string
  category: BigBearCategory
  tier: BigBearTier
  status: BigBearStatus
  durationMs: number
  tokens: number
  costUsd: number
  escalations: number
  steps: number
}

export const HISTORY_LIMIT = 1000

export function toRecord(task: BigBearTask, project: string): HistoryRecord | null {
  if (task.endedAt === undefined) return null
  return {
    at: task.endedAt,
    project,
    category: task.category,
    tier: task.tier,
    status: task.status,
    durationMs: task.endedAt - task.startedAt,
    tokens: totalTokens(task.tokens),
    costUsd: task.costUsd,
    escalations: task.escalations,
    steps: task.steps,
  }
}

export function appendHistory(history: readonly HistoryRecord[], record: HistoryRecord): HistoryRecord[] {
  return [...history, record].slice(-HISTORY_LIMIT)
}

/** Failure counts by `${category}:${tier}`, for the router. */
export function failureStats(history: readonly HistoryRecord[]): Record<string, HistoryStat> {
  const stats: Record<string, HistoryStat> = {}
  for (const record of history) {
    if (record.status === 'CANCELLED') continue
    const key = `${record.category}:${record.tier}`
    const stat = (stats[key] ??= { runs: 0, failures: 0 })
    stat.runs++
    // A task that had to escalate failed on the tier it started with.
    if (record.status === 'FAILED' || record.escalations > 0) stat.failures++
  }
  return stats
}

/** Median duration of past tasks of the same category and tier; null under 3 samples. */
/** The median of at least `min` samples, or null. */
function median(values: number[], min: number): number | null {
  if (values.length < min) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

/**
 * How long a task of this kind usually takes, from finished tasks only.
 * The same category and model first (3 samples); failing that, any task on
 * the same model (4); failing that, any task (6). Fewer than that: null, and
 * the panel says it is still calculating.
 */
export function estimateMs(history: readonly HistoryRecord[], category: BigBearCategory, tier: BigBearTier): number | null {
  const done = history.filter(r => r.status === 'COMPLETED').slice(-80)
  return (
    median(done.filter(r => r.category === category && r.tier === tier).slice(-50).map(r => r.durationMs), 3) ??
    median(done.filter(r => r.tier === tier).map(r => r.durationMs), 4) ??
    median(done.map(r => r.durationMs), 6)
  )
}

export type Summary = {
  total: number
  completed: number
  failed: number
  cancelled: number
  avgMs: number | null
  escalations: number
  tokens: number
  costUsd: number
  byTier: Record<BigBearTier, number>
  byCategory: { category: BigBearCategory; runs: number; successRate: number; avgMs: number }[]
  byProject: { project: string; runs: number; costUsd: number }[]
}

export function summarize(history: readonly HistoryRecord[]): Summary {
  const byTier: Record<BigBearTier, number> = { haiku: 0, sonnet: 0, opus: 0 }
  const categories = new Map<BigBearCategory, { runs: number; ok: number; ms: number }>()
  const projects = new Map<string, { runs: number; costUsd: number }>()
  let completed = 0
  let failed = 0
  let cancelled = 0
  let ms = 0
  let escalations = 0
  let tokens = 0
  let costUsd = 0
  for (const r of history) {
    byTier[r.tier]++
    if (r.status === 'COMPLETED') completed++
    else if (r.status === 'FAILED') failed++
    else if (r.status === 'CANCELLED') cancelled++
    ms += r.durationMs
    escalations += r.escalations
    tokens += r.tokens
    costUsd += r.costUsd
    const c = categories.get(r.category) ?? { runs: 0, ok: 0, ms: 0 }
    c.runs++
    c.ms += r.durationMs
    if (r.status === 'COMPLETED') c.ok++
    categories.set(r.category, c)
    const p = projects.get(r.project) ?? { runs: 0, costUsd: 0 }
    p.runs++
    p.costUsd += r.costUsd
    projects.set(r.project, p)
  }
  return {
    total: history.length,
    completed,
    failed,
    cancelled,
    avgMs: history.length > 0 ? ms / history.length : null,
    escalations,
    tokens,
    costUsd,
    byTier,
    byCategory: [...categories.entries()]
      .map(([category, c]) => ({ category, runs: c.runs, successRate: c.ok / c.runs, avgMs: c.ms / c.runs }))
      .sort((a, b) => b.runs - a.runs),
    byProject: [...projects.entries()].map(([project, p]) => ({ project, ...p })).sort((a, b) => b.runs - a.runs),
  }
}
