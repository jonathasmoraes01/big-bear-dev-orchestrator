import type { BigBearDecision, BigBearTier } from '../../../types'
import type { HistoryRecord } from '../services/analytics'
import type { Io } from '../services/io'

/**
 * The module's own working memory: what a hot reload may drop without harm.
 * Anything a drawing reads lives in `$.state` instead (core/state.ts).
 */
export type TurnRun = {
  taskId: string
  tier: BigBearTier
  routed: boolean
  escalations: number
  toolErrors: number
  hadEdits: boolean
}

export const runtime = {
  /** The session-wide Io (built from session.start's `$`), for work that outlives one dispatch. */
  session: null as Io | null,
  root: '',
  history: [] as HistoryRecord[],
  /** The task a submitted prompt created, waiting for its turn.start. */
  pendingTaskId: null as string | null,
  /** A routing the next prompt must take (Bug Hunter). */
  forced: null as Pick<BigBearDecision, 'tier' | 'reasons' | 'source'> | null,
  turns: new Map<string, TurnRun>(),
  previous: null as { tier: BigBearTier; endedAt: number } | null,
  /** Usage alerts already raised, by window, level and reset time. */
  alerted: new Set<string>(),
  lastGitAt: 0,
  qaRunning: false,
  nextId: 1,
}

export function newId(): string {
  return String(runtime.nextId++)
}
