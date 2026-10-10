import type { BigBearCategory, BigBearConfig, BigBearDecision, BigBearTier } from '../../../types'
import { TIERS } from '../config/defaults'
import type { Classification } from './classifier'

export const TIER_RANK: Record<BigBearTier, number> = { haiku: 0, sonnet: 1, opus: 2 }

export function tierOfModel(model: string | undefined): BigBearTier | null {
  if (model === undefined) return null
  const id = model.toLowerCase()
  if (id.includes('haiku')) return 'haiku'
  if (id.includes('sonnet')) return 'sonnet'
  if (id.includes('opus')) return 'opus'
  return null
}

/** The tier a mode gives a classified prompt, before any policy. */
export function tierForMode(mode: BigBearConfig['routing']['mode'], c: Classification): { tier: BigBearTier; why: string } {
  const { category, complexity, risk } = c
  const simple: readonly BigBearCategory[] = ['trivial', 'lookup', 'docs']
  const heavy: readonly BigBearCategory[] = ['architecture', 'audit', 'critical']

  if (mode === 'eco') {
    if (category === 'critical' && complexity >= 4) return { tier: 'opus', why: 'ECO: crítico e complexo' }
    if (simple.includes(category) || complexity <= 2) return { tier: 'haiku', why: 'ECO: tarefa simples' }
    if (heavy.includes(category) && risk >= 5) return { tier: 'opus', why: 'ECO: risco máximo' }
    return { tier: 'sonnet', why: 'ECO: exige desenvolvimento' }
  }

  if (mode === 'god') {
    if (simple.includes(category) && complexity <= 1) return { tier: 'haiku', why: 'GOD: simples continua econômico' }
    if (heavy.includes(category) || complexity >= 3 || risk >= 3) return { tier: 'opus', why: 'GOD: tarefa complexa ou arriscada' }
    if (simple.includes(category)) return { tier: 'sonnet', why: 'GOD: leitura com folga' }
    return { tier: 'sonnet', why: 'GOD: desenvolvimento intermediário' }
  }

  // balanced
  if (heavy.includes(category) || (complexity >= 5 && risk >= 3)) return { tier: 'opus', why: 'BALANCED: arquitetura/crítico' }
  if (simple.includes(category) && complexity <= 2 && risk <= 2) return { tier: 'haiku', why: 'BALANCED: leitura/busca simples' }
  return { tier: 'sonnet', why: 'BALANCED: desenvolvimento' }
}

/** The nearest allowed tier: upward first, then downward. */
export function allowedTier(tier: BigBearTier, blocked: readonly BigBearTier[]): BigBearTier | null {
  if (!blocked.includes(tier)) return tier
  const rank = TIER_RANK[tier]
  for (let r = rank + 1; r < TIERS.length; r++) if (!blocked.includes(TIERS[r]!)) return TIERS[r]!
  for (let r = rank - 1; r >= 0; r--) if (!blocked.includes(TIERS[r]!)) return TIERS[r]!
  return null
}

export type HistoryStat = { runs: number; failures: number }

export type RouteContext = {
  previous: { tier: BigBearTier; endedAt: number } | null
  now: number
  contextTokens: number | null
  /** Failure counts by `${category}:${tier}`, from Dev Analytics. */
  history: Record<string, HistoryStat>
}

/** Prompt cache lifetime the engine writes by default. */
export const CACHE_TTL_MS = 5 * 60 * 1000

export function decide(config: BigBearConfig, c: Classification, ctx: RouteContext): BigBearDecision {
  const routing = config.routing
  const reasons: string[] = []
  let source: BigBearDecision['source'] = 'rules'
  let tier: BigBearTier

  if (routing.manualTier !== null) {
    tier = routing.manualTier
    source = 'manual'
    reasons.push(`modelo fixado manualmente: ${tier.toUpperCase()}`)
  } else if (c.category === 'continue' && ctx.previous !== null) {
    tier = ctx.previous.tier
    source = 'sticky'
    reasons.push('continuação: mantém o modelo da etapa anterior')
  } else {
    const picked = tierForMode(routing.mode, c)
    tier = picked.tier
    reasons.push(picked.why)
    if (c.signals.length > 0) reasons.push(`sinais: ${c.signals.slice(0, 4).join(', ')}`)

    if (routing.learnFromHistory && tier !== 'opus') {
      const stat = ctx.history[`${c.category}:${tier}`]
      if (stat !== undefined && stat.runs >= 5 && stat.failures / stat.runs >= 0.4) {
        const up = TIERS[TIER_RANK[tier] + 1]!
        reasons.push(`histórico: ${stat.failures}/${stat.runs} falhas de ${c.category} em ${tier.toUpperCase()}, sobe para ${up.toUpperCase()}`)
        tier = up
        source = 'history'
      }
    }

    // Prompt cache is per model: a switch re-reads the whole conversation at
    // full price. While the cache is warm and the conversation is large,
    // keep the previous model unless the move is two tiers down.
    if (routing.cacheAware && ctx.previous !== null && tier !== ctx.previous.tier) {
      const isWarm = ctx.now - ctx.previous.endedAt < CACHE_TTL_MS
      const isLarge = (ctx.contextTokens ?? 0) >= 40_000
      const drop = TIER_RANK[ctx.previous.tier] - TIER_RANK[tier]
      if (isWarm && isLarge && drop === 1) {
        reasons.push(`cache quente com ${Math.round((ctx.contextTokens ?? 0) / 1000)}k tokens: mantém ${ctx.previous.tier.toUpperCase()}`)
        tier = ctx.previous.tier
        source = 'sticky'
      }
    }
  }

  const allowed = allowedTier(tier, routing.blocked)
  if (allowed === null) {
    reasons.push('todos os modelos bloqueados: o roteamento não interfere')
  } else if (allowed !== tier) {
    reasons.push(`${tier.toUpperCase()} bloqueado: usa ${allowed.toUpperCase()}`)
    tier = allowed
  }

  return {
    tier,
    model: routing.models[tier],
    category: c.category,
    complexity: c.complexity,
    risk: c.risk,
    reasons,
    files: c.files,
    source,
    confidence: c.confidence,
  }
}

export type EscalationState = { tier: BigBearTier; escalations: number; toolErrors: number }

/**
 * Whether the next step of a turn should run one tier up: enough tool
 * failures inside the turn, the limit not reached, and a higher tier allowed.
 */
export function shouldEscalate(config: BigBearConfig, state: EscalationState): BigBearTier | null {
  const policy = config.routing.escalation
  if (!policy.enabled || config.routing.manualTier !== null) return null
  if (state.escalations >= policy.maxPerTurn) return null
  if (state.toolErrors < policy.toolErrorThreshold * (state.escalations + 1)) return null
  for (let r = TIER_RANK[state.tier] + 1; r < TIERS.length; r++) {
    const next = TIERS[r]!
    if (!config.routing.blocked.includes(next)) return next
  }
  return null
}

/** The tier a subagent gets when its spawn named no model. */
export function subagentTier(config: BigBearConfig, subagentType: string, c: Classification): BigBearTier {
  const type = subagentType.toLowerCase()
  if (/explore|investigat|locator|search|scout/.test(type)) {
    return allowedTier(config.routing.mode === 'god' && c.complexity >= 4 ? 'sonnet' : 'haiku', config.routing.blocked) ?? 'haiku'
  }
  if (/plan|architect|review/.test(type)) {
    const base = config.routing.mode === 'eco' ? 'sonnet' : 'opus'
    return allowedTier(base, config.routing.blocked) ?? base
  }
  const picked = tierForMode(config.routing.mode, c).tier
  return allowedTier(picked, config.routing.blocked) ?? picked
}
