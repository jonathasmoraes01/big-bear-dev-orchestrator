import type { BigBearConfig, BigBearModuleId, BigBearTier } from '../../../types'

export const TIERS: readonly BigBearTier[] = ['haiku', 'sonnet', 'opus']

export const MODULES: readonly { id: BigBearModuleId; label: string }[] = [
  { id: 'smartBrain', label: 'Smart Brain' },
  { id: 'taskCommand', label: 'Task Command' },
  { id: 'tokenIntelligence', label: 'Token Intelligence' },
  { id: 'usageMonitor', label: 'Usage Monitor' },
  { id: 'codeGuardian', label: 'Code Guardian' },
  { id: 'autoQa', label: 'Auto QA' },
  { id: 'bugHunter', label: 'Bug Hunter' },
  { id: 'gitGuardian', label: 'Git Guardian' },
  { id: 'contextManager', label: 'Context Manager' },
  { id: 'devAnalytics', label: 'Dev Analytics' },
  { id: 'showcase', label: 'Showcase' },
]

/**
 * Prices in USD per million tokens. Input and output come from the
 * Anthropic model table bundled with Claude Code 2.1.293 (cached
 * 2026-10-06). Cache reads for Opus 5.5 and Sonnet 5.5 come from the same
 * source; the Haiku cache read and every cache write are derived with the
 * standard multipliers (read 0.1x input, 5-minute write 1.25x input).
 * Update them with `/bigbear price <tier> <in> <out> <read> <write>`.
 */
export const DEFAULT_PRICING: BigBearConfig['pricing'] = {
  baseline: 'sonnet',
  table: {
    haiku: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
    sonnet: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
    opus: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  },
  source:
    'Anthropic model table (Claude Code 2.1.293 bundle, cached 2026-10-06); cache writes and Haiku cache read derived (1.25x / 0.1x input)',
  updatedAt: '2026-10-06',
}

export const DEFAULT_CONFIG: BigBearConfig = {
  version: 1,
  routing: {
    enabled: true,
    mode: 'balanced',
    manualTier: null,
    blocked: [],
    models: {
      haiku: 'claude-haiku-5-5',
      sonnet: 'claude-sonnet-5-5',
      opus: 'claude-opus-5-5',
    },
    routeSubagents: true,
    cacheAware: true,
    aiClassifier: false,
    escalation: { enabled: true, maxPerTurn: 1, toolErrorThreshold: 3 },
    learnFromHistory: true,
  },
  modules: {
    smartBrain: true,
    taskCommand: true,
    tokenIntelligence: true,
    usageMonitor: true,
    codeGuardian: true,
    autoQa: true,
    bugHunter: true,
    gitGuardian: true,
    contextManager: true,
    devAnalytics: true,
    showcase: true,
  },
  usage: { warn: 70, high: 85, critical: 95, autoEco: false },
  pricing: DEFAULT_PRICING,
  guardian: {
    action: 'ask',
    criticalPaths: [
      '.env',
      '.env.*',
      'package.json',
      'package-lock.json',
      'pnpm-lock.yaml',
      'yarn.lock',
      'tsconfig*.json',
      '.github/workflows/*',
      '**/migrations/**',
      'Dockerfile',
      'docker-compose*.yml',
      '*.sql',
    ],
    protectedBranches: ['main', 'master', 'production', 'prod', 'release'],
  },
  qa: { autoRun: false, profile: 'auto' },
  context: { warnPercent: 80 },
  ui: { autoOpenPane: true, showBand: true, notifyOnFinish: true, refreshMs: 1000 },
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Lays `stored` over `base`, keeping only keys `base` knows and only values
 * of the same kind, so an old or hand-edited store never breaks a load.
 */
export function mergeShape<T>(base: T, stored: unknown): T {
  if (stored === undefined || stored === null) return base
  if (Array.isArray(base)) return (Array.isArray(stored) ? stored : base) as T
  if (isPlainObject(base)) {
    if (!isPlainObject(stored)) return base
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(base)) {
      out[key] = mergeShape((base as Record<string, unknown>)[key], stored[key])
    }
    return out as T
  }
  if (base === null) return stored as T
  return (typeof stored === typeof base ? stored : base) as T
}

export function loadConfig(stored: unknown, project?: unknown): BigBearConfig {
  const global = mergeShape(DEFAULT_CONFIG, stored)
  // A fresh copy: values handed to $.state are frozen by the host, and the
  // defaults must never be mutated.
  const merged = JSON.parse(JSON.stringify(project ? mergeShape(global, project) : global)) as BigBearConfig
  // manualTier is nullable: mergeShape keeps any string, so check it here.
  if (merged.routing.manualTier !== null && !TIERS.includes(merged.routing.manualTier)) {
    merged.routing.manualTier = null
  }
  merged.routing.blocked = merged.routing.blocked.filter(tier => TIERS.includes(tier))
  if (!['eco', 'balanced', 'god'].includes(merged.routing.mode)) merged.routing.mode = 'balanced'
  if (!['ask', 'deny', 'warn'].includes(merged.guardian.action)) merged.guardian.action = 'ask'
  merged.ui.refreshMs = Math.min(10_000, Math.max(250, merged.ui.refreshMs))
  merged.routing.escalation.maxPerTurn = Math.min(2, Math.max(0, merged.routing.escalation.maxPerTurn))
  return merged
}
