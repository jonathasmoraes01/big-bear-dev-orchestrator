import type { BigBearActivity, BigBearDecision, BigBearStatus, BigBearTask, BigBearTokens } from '../../../types'
import { addTokens, emptyTokens } from '../services/pricing'

/**
 * Milestones, each reached by an event the engine raised, never guessed:
 * 1 classified (prompt.submit), 2 started (turn.start or agent.spawn),
 * 3 first model step answered (turn.step), 4 turn ended with an answer
 * (turn.complete), 5 verified (QA passed, or no QA asked for).
 */
export const MILESTONES = 5

export const DONE: readonly BigBearStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED']

export function isOpen(task: BigBearTask): boolean {
  return !DONE.includes(task.status)
}

export function newTask(args: {
  id: string
  now: number
  title: string
  decision: BigBearDecision
  routed: boolean
  etaMs: number | null
  kind?: BigBearTask['kind']
  parentId?: string
}): BigBearTask {
  return {
    id: args.id,
    title: args.title,
    kind: args.kind ?? 'turn',
    parentId: args.parentId,
    category: args.decision.category,
    tier: args.decision.tier,
    model: args.decision.model,
    reasons: args.decision.reasons,
    status: 'ANALYZING',
    startedAt: args.now,
    steps: 0,
    toolCalls: 0,
    toolErrors: 0,
    tokens: emptyTokens(),
    costUsd: 0,
    escalations: 0,
    milestones: 1,
    etaMs: args.etaMs,
    routed: args.routed,
  }
}

export function patch(tasks: readonly BigBearTask[], id: string, change: (task: BigBearTask) => BigBearTask): BigBearTask[] {
  return tasks.map(task => (task.id === id ? change(task) : task))
}

export function addUsage(task: BigBearTask, tokens: BigBearTokens, costUsd: number): BigBearTask {
  return { ...task, tokens: addTokens(task.tokens, tokens), costUsd: task.costUsd + costUsd }
}

export function finish(task: BigBearTask, status: BigBearStatus, now: number, extra: Partial<BigBearTask> = {}): BigBearTask {
  const milestones = status === 'COMPLETED' ? MILESTONES : task.milestones
  return { ...task, ...extra, status, endedAt: now, milestones, pendingTool: undefined }
}

/** Progress as reached milestones over all; null while a step runs with no milestone ahead known. */
export function progress(task: BigBearTask): number {
  return Math.round((task.milestones / MILESTONES) * 100)
}

export type Overall = {
  total: number
  done: number
  completed: number
  failed: number
  percent: number | null
  /** Since the first task began, gaps included. */
  elapsedMs: number
  /** Time the agent actually spent on tasks: each task's own duration, summed. */
  workedMs: number
  /** How long the oldest open task has been running; null when none is. */
  runningMs: number | null
  etaMs: number | null
}

export function overall(tasks: readonly BigBearTask[], now: number): Overall {
  const roots = tasks.filter(task => task.kind === 'turn')
  const done = roots.filter(task => !isOpen(task)).length
  const completed = roots.filter(task => task.status === 'COMPLETED').length
  const failed = roots.filter(task => task.status === 'FAILED').length
  const first = roots.reduce((min, task) => Math.min(min, task.startedAt), Number.POSITIVE_INFINITY)
  const elapsedMs = Number.isFinite(first) ? now - first : 0
  const open = roots.filter(isOpen)
  const workedMs = roots.reduce((sum, task) => sum + Math.max(0, (task.endedAt ?? now) - task.startedAt), 0)
  const runningMs = open.length === 0 ? null : Math.max(0, now - Math.min(...open.map(task => task.startedAt)))
  // An estimate exists only when every open task has one from history.
  const etaMs =
    open.length === 0
      ? 0
      : open.every(task => task.etaMs !== null)
        ? open.reduce((sum, task) => sum + Math.max(0, (task.etaMs ?? 0) - (now - task.startedAt)), 0)
        : null
  return { total: roots.length, done, completed, failed, percent: roots.length === 0 ? null : Math.round((done / roots.length) * 100), elapsedMs, workedMs, runningMs, etaMs }
}

const READ_TOOLS = /^(Read|Grep|Glob|LS|WebFetch|WebSearch|ToolSearch|NotebookRead|LSP|ListMcpResourcesTool|ReadMcpResourceTool|TaskOutput|AskUserQuestion)$/
const READ_MCP = /(read|get|list|search|fetch|query|find|status|view)/i

/** What a tool call says the session is doing, for the avatar. */
export function activityForTool(tool: string): BigBearActivity {
  if (READ_TOOLS.test(tool)) return 'research'
  if (tool.startsWith('mcp__')) return READ_MCP.test(tool.split('__').at(-1) ?? '') ? 'research' : 'work'
  if (tool === 'Agent' || tool === 'Task') return 'research'
  return 'work'
}

/** Activity from the task list alone: idle when nothing is open. */
export function activityForTasks(tasks: readonly BigBearTask[], last: BigBearActivity): BigBearActivity {
  const open = tasks.filter(isOpen)
  if (open.length === 0) return 'idle'
  if (open.some(task => task.status === 'VALIDATING')) return 'work'
  return last === 'idle' ? 'research' : last
}
