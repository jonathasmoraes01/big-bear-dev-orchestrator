import type { SessionRateLimit, SessionUsage } from 'claude-code'
import type { Io } from './io'

import type { BigBearAlert, BigBearConfig, BigBearGit, BigBearModuleId, BigBearUsage } from '../../../types'
import { DEFAULT_CONFIG, loadConfig } from '../config/defaults'
import { MAX_ALERTS } from '../core/state'
import { notARepo, parseStatus } from '../modules/git'
import { redactSecrets } from '../modules/guardian'
import type { ProjectFacts, QaPlan } from '../modules/qa'
import { tail } from '../modules/qa'
import type { HistoryRecord } from './analytics'

/**
 * Everything that touches the engine for the mod's services: the durable
 * store, git, the project's files and the QA runs. Hooks call these; the
 * rules they apply live in pure modules.
 */

/** The longest a QA step may run: the engine's own ceiling. */
export const QA_STEP_TIMEOUT_MS = 10 * 60 * 1000

const STORE_CONFIG = 'config'
const STORE_HISTORY = 'history'
const projectKey = (root: string) => `project:${root.toLowerCase()}`
const decisionsKey = (root: string) => `decisions:${root.toLowerCase()}`

export async function loadSettings(io: Io, root: string): Promise<BigBearConfig> {
  const [global, project] = await Promise.all([io.store.get(STORE_CONFIG), io.store.get(projectKey(root))])
  return loadConfig(global, project)
}

/** Saves the global settings, or this project's policy on top of them. */
export async function saveSettings(io: Io, config: BigBearConfig, scope: 'global' | 'project' = 'global'): Promise<void> {
  const root = await io.state.project.get()
  if (scope === 'project') {
    await io.store.set(projectKey(root), { routing: { mode: config.routing.mode, manualTier: config.routing.manualTier, blocked: config.routing.blocked } })
  } else {
    await io.store.set(STORE_CONFIG, config)
  }
  await io.state.config.set(() => config)
}

export async function resetSettings(io: Io): Promise<BigBearConfig> {
  const root = await io.state.project.get()
  await io.store.delete(STORE_CONFIG)
  await io.store.delete(projectKey(root))
  await io.state.config.set(() => DEFAULT_CONFIG)
  return DEFAULT_CONFIG
}

export async function hasProjectPolicy(io: Io): Promise<boolean> {
  const root = await io.state.project.get()
  return (await io.store.get(projectKey(root))) !== undefined
}

export async function clearProjectPolicy(io: Io): Promise<void> {
  const root = await io.state.project.get()
  await io.store.delete(projectKey(root))
  const config = loadConfig(await io.store.get(STORE_CONFIG))
  await io.state.config.set(() => config)
}

export async function loadHistory(io: Io): Promise<HistoryRecord[]> {
  const stored = await io.store.get(STORE_HISTORY)
  return Array.isArray(stored) ? (stored as HistoryRecord[]) : []
}

export async function saveHistory(io: Io, history: HistoryRecord[]): Promise<void> {
  await io.store.set(STORE_HISTORY, history)
}

export type DecisionNote = { at: number; text: string }

export async function loadDecisions(io: Io, root: string): Promise<DecisionNote[]> {
  const stored = await io.store.get(decisionsKey(root))
  return Array.isArray(stored) ? (stored as DecisionNote[]) : []
}

export async function addDecision(io: Io, root: string, text: string, now: number): Promise<DecisionNote[]> {
  const list = [...(await loadDecisions(io, root)), { at: now, text: redactSecrets(text).slice(0, 500) }].slice(-100)
  await io.store.set(decisionsKey(root), list)
  return list
}

export async function alert(io: Io, module: BigBearModuleId, level: BigBearAlert['level'], text: string): Promise<void> {
  const at = await io.clock.now()
  await io.state.alerts.set(list => [...list, { at, level, module, text }].slice(-MAX_ALERTS))
}

function windowOf(limits: readonly SessionRateLimit[], kind: string): BigBearUsage['fiveHour'] {
  const found = limits.find(limit => limit.kind === kind)
  return found === undefined ? null : { percent: found.percentUsed, resetsAt: found.resetsAt }
}

export function usageSnapshot(at: number, usage: Pick<SessionUsage, 'context' | 'rateLimits' | 'cost'>): BigBearUsage {
  return {
    at,
    fiveHour: windowOf(usage.rateLimits, 'five_hour'),
    week: windowOf(usage.rateLimits, 'seven_day'),
    contextPercent: usage.context.percent ?? null,
    contextTokens: usage.context.tokens ?? null,
    contextWindow: usage.context.window ?? null,
    sessionUsd: usage.cost?.usd ?? null,
  }
}

export async function refreshGit(io: Io, root: string): Promise<BigBearGit> {
  const at = await io.clock.now()
  let git: BigBearGit
  try {
    const status = await io.process.run(['git', 'status', '--porcelain=v1', '--branch'], { cwd: root, timeoutMs: 10_000 })
    if (status.exitCode !== 0) {
      git = notARepo(at)
    } else {
      git = parseStatus(status.stdout, at)
      const [log, merge] = await Promise.all([
        io.process.run(['git', 'log', '-1', '--format=%h %s (%cr)'], { cwd: root, timeoutMs: 10_000 }),
        io.process.run(['git', 'rev-parse', '-q', '--verify', 'MERGE_HEAD'], { cwd: root, timeoutMs: 10_000 }),
      ])
      git.lastCommit = log.exitCode === 0 ? redactSecrets(log.stdout.trim()).slice(0, 120) || null : null
      git.merging = merge.exitCode === 0
    }
  } catch {
    git = notARepo(at)
  }
  await io.state.git.set(() => git)
  return git
}

export async function projectFacts(io: Io, root: string): Promise<ProjectFacts> {
  const sep = root.includes('\\') ? '\\' : '/'
  const path = (name: string) => `${root}${root.endsWith(sep) ? '' : sep}${name}`
  let entries: string[] = []
  try {
    entries = (await io.fs.list(root)).map(entry => entry.name)
  } catch {
    entries = []
  }
  let packageName: string | null = null
  let scripts: Record<string, string> = {}
  if (entries.includes('package.json')) {
    try {
      const pkg = JSON.parse(await io.fs.read(path('package.json'))) as { name?: unknown; scripts?: unknown }
      packageName = typeof pkg.name === 'string' ? pkg.name : null
      if (typeof pkg.scripts === 'object' && pkg.scripts !== null) {
        scripts = Object.fromEntries(Object.entries(pkg.scripts).filter((pair): pair is [string, string] => typeof pair[1] === 'string'))
      }
    } catch {
      // A broken package.json leaves no scripts to run.
    }
  }
  const hasLockfile = entries.includes('pnpm-lock.yaml')
    ? 'pnpm'
    : entries.includes('yarn.lock')
      ? 'yarn'
      : entries.includes('bun.lockb') || entries.includes('bun.lock')
        ? 'bun'
        : entries.includes('package-lock.json')
          ? 'npm'
          : null
  return { packageName, scripts, entries, isWindows: /^[A-Za-z]:[\\/]/.test(root), hasLockfile }
}

/** Runs a QA plan for real, step by step, writing each result as it lands. */
export async function runQa(io: Io, root: string, plan: QaPlan): Promise<'passed' | 'failed' | null> {
  const startedAt = await io.clock.now()
  await io.state.qa.set(() => ({ profile: plan.profile, startedAt, endedAt: null, steps: plan.steps, lastResult: null }))
  if (plan.steps.length === 0) {
    await io.state.qa.set(qa => ({ ...qa, endedAt: startedAt }))
    return null
  }
  let failed = false
  for (let index = 0; index < plan.steps.length; index++) {
    const step = plan.steps[index]!
    await io.state.qa.set(qa => ({ ...qa, steps: qa.steps.map((s, i) => (i === index ? { ...s, status: 'running' as const } : s)) }))
    const began = await io.clock.now()
    let exitCode = 1
    let output = ''
    try {
      const ran = await io.process.run(step.argv, { cwd: root, env: { CI: '1', FORCE_COLOR: '0' }, timeoutMs: QA_STEP_TIMEOUT_MS })
      exitCode = ran.exitCode
      output = `${ran.stdout}\n${ran.stderr}`
    } catch (error) {
      output = error instanceof Error ? error.message : String(error)
    }
    const durationMs = (await io.clock.now()) - began
    const status: 'passed' | 'failed' = exitCode === 0 ? 'passed' : 'failed'
    if (status === 'failed') failed = true
    await io.state.qa.set(qa => ({
      ...qa,
      steps: qa.steps.map((s, i) => (i === index ? { ...s, status, exitCode, durationMs, tail: redactSecrets(tail(output)) } : s)),
    }))
  }
  const endedAt = await io.clock.now()
  const lastResult: 'passed' | 'failed' = failed ? 'failed' : 'passed'
  await io.state.qa.set(qa => ({ ...qa, endedAt, lastResult }))
  return lastResult
}
