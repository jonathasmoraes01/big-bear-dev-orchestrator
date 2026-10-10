// BIG BEAR DEV ORCHESTRATOR — type contract.
// Every value the mod keeps in `$.state` is declared here, under the
// plugin's name, so `claude plugin validate` can hold the module to it.

export type BigBearTier = 'haiku' | 'sonnet' | 'opus'
export type BigBearMode = 'eco' | 'balanced' | 'god'

export type BigBearModuleId =
  | 'smartBrain'
  | 'taskCommand'
  | 'tokenIntelligence'
  | 'usageMonitor'
  | 'codeGuardian'
  | 'autoQa'
  | 'bugHunter'
  | 'gitGuardian'
  | 'contextManager'
  | 'devAnalytics'
  | 'showcase'

export type BigBearCategory =
  | 'continue'
  | 'trivial'
  | 'lookup'
  | 'docs'
  | 'test'
  | 'bugfix'
  | 'feature'
  | 'refactor'
  | 'architecture'
  | 'audit'
  | 'critical'

export type BigBearPrice = {
  /** USD per million uncached input tokens. */
  input: number
  /** USD per million output tokens. */
  output: number
  /** USD per million tokens read from the prompt cache. */
  cacheRead: number
  /** USD per million tokens written to the prompt cache (5-minute TTL). */
  cacheWrite: number
}

export type BigBearConfig = {
  version: 1
  routing: {
    enabled: boolean
    mode: BigBearMode
    /** A tier forced by the person; null lets the Smart Brain decide. */
    manualTier: BigBearTier | null
    blocked: BigBearTier[]
    /** Model ids sent to the API for each tier. */
    models: Record<BigBearTier, string>
    routeSubagents: boolean
    /** Keep the previous model while the prompt cache is warm. */
    cacheAware: boolean
    /** Ask a small model only when local rules are not confident. Off by default. */
    aiClassifier: boolean
    escalation: {
      enabled: boolean
      maxPerTurn: number
      toolErrorThreshold: number
    }
    /** Learn from history: bump a tier whose failure rate is high. */
    learnFromHistory: boolean
  }
  modules: Record<BigBearModuleId, boolean>
  usage: {
    warn: number
    high: number
    critical: number
    /** Switch to ECO on its own once `high` is crossed. Off by default. */
    autoEco: boolean
  }
  pricing: {
    baseline: BigBearTier
    table: Record<BigBearTier, BigBearPrice>
    source: string
    updatedAt: string
  }
  guardian: {
    /** What a dangerous command meets: a question, a refusal, or a warning. */
    action: 'ask' | 'deny' | 'warn'
    criticalPaths: string[]
    protectedBranches: string[]
  }
  qa: {
    autoRun: boolean
    profile: string
  }
  context: {
    warnPercent: number
  }
  ui: {
    autoOpenPane: boolean
    showBand: boolean
    /** A toast whenever a task finishes. */
    notifyOnFinish: boolean
    refreshMs: number
  }
}

export type BigBearTokens = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export type BigBearStatus =
  | 'PENDING'
  | 'ANALYZING'
  | 'RUNNING'
  | 'WAITING'
  | 'VALIDATING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'

export type BigBearDecision = {
  tier: BigBearTier
  model: string
  category: BigBearCategory
  complexity: number
  risk: number
  /** Why this tier, in short reasons a person can check. */
  reasons: string[]
  /** Paths named in the prompt. */
  files: string[]
  source: 'rules' | 'manual' | 'sticky' | 'ai' | 'history' | 'bughunter'
  confidence: number
}

export type BigBearTask = {
  id: string
  turnId?: string
  agentId?: string
  parentId?: string
  title: string
  kind: 'turn' | 'subagent'
  category: BigBearCategory
  tier: BigBearTier
  model: string
  reasons: string[]
  status: BigBearStatus
  startedAt: number
  endedAt?: number
  steps: number
  toolCalls: number
  toolErrors: number
  pendingTool?: string
  tokens: BigBearTokens
  costUsd: number
  escalations: number
  /** Milestones reached, each one checked by an event: 0..5. */
  milestones: number
  etaMs: number | null
  result?: string
  error?: string
  routed: boolean
}

export type BigBearModelBucket = BigBearTokens & { steps: number; costUsd: number }

export type BigBearMetrics = {
  byTier: Record<BigBearTier, BigBearModelBucket>
  /** Tokens of models outside the three tiers, by model id. */
  other: Record<string, BigBearModelBucket>
  /** What the same tokens would cost at the baseline tier. */
  baselineUsd: number
  escalations: number
}

export type BigBearUsage = {
  at: number
  fiveHour: { percent: number; resetsAt?: string } | null
  week: { percent: number; resetsAt?: string } | null
  contextPercent: number | null
  contextTokens: number | null
  contextWindow: number | null
  sessionUsd: number | null
}

export type BigBearGit = {
  at: number
  isRepo: boolean
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  staged: number
  modified: number
  untracked: number
  conflicts: number
  lastCommit: string | null
  merging: boolean
}

export type BigBearQaStep = {
  name: string
  argv: string[]
  status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped'
  exitCode?: number
  durationMs?: number
  tail?: string
}

export type BigBearQa = {
  profile: string | null
  startedAt: number | null
  endedAt: number | null
  steps: BigBearQaStep[]
  lastResult: 'passed' | 'failed' | null
}

export type BigBearAlert = {
  at: number
  level: 'info' | 'warn' | 'danger'
  module: BigBearModuleId
  text: string
}

/** What the avatar shows: no turn, reading/searching, or changing things. */
export type BigBearActivity = 'idle' | 'research' | 'work'

export type BigBearView = {
  expanded: string | null
  showAll: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'big-bear': {
      config: BigBearConfig
      decision: BigBearDecision | null
      tasks: BigBearTask[]
      metrics: BigBearMetrics
      usage: BigBearUsage | null
      git: BigBearGit | null
      qa: BigBearQa
      alerts: BigBearAlert[]
      view: BigBearView
      tick: number
      project: string
      activity: BigBearActivity
    }
  }
}
