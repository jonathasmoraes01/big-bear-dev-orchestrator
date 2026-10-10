import type {
  BigBearConfig,
  BigBearMetrics,
  BigBearModelBucket,
  BigBearPrice,
  BigBearTier,
  BigBearTokens,
} from '../../../types'
import { TIERS } from '../config/defaults'
import { tierOfModel } from '../core/router'

/** A turn's usage as the engine reports it (ModelUsage plus the model). */
export type ApiUsage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
  model: string
}

export function toTokens(usage: ApiUsage): BigBearTokens {
  return {
    input: usage.input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheWrite: usage.cache_creation_input_tokens ?? 0,
  }
}

export function emptyTokens(): BigBearTokens {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
}

export function addTokens(a: BigBearTokens, b: BigBearTokens): BigBearTokens {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  }
}

export function totalTokens(t: BigBearTokens): number {
  return t.input + t.output + t.cacheRead + t.cacheWrite
}

/** API-equivalent cost in USD: not what a subscription bills. */
export function costOf(tokens: BigBearTokens, price: BigBearPrice): number {
  return (
    (tokens.input * price.input +
      tokens.output * price.output +
      tokens.cacheRead * price.cacheRead +
      tokens.cacheWrite * price.cacheWrite) /
    1_000_000
  )
}

export function emptyBucket(): BigBearModelBucket {
  return { ...emptyTokens(), steps: 0, costUsd: 0 }
}

export function emptyMetrics(): BigBearMetrics {
  return {
    byTier: { haiku: emptyBucket(), sonnet: emptyBucket(), opus: emptyBucket() },
    other: {},
    baselineUsd: 0,
    escalations: 0,
  }
}

export type PricedStep = { tier: BigBearTier | null; tokens: BigBearTokens; costUsd: number; baselineUsd: number }

export function priceStep(config: BigBearConfig, usage: ApiUsage): PricedStep {
  const tokens = toTokens(usage)
  const tier = tierOfModel(usage.model)
  const table = config.pricing.table
  const costUsd = tier === null ? 0 : costOf(tokens, table[tier])
  const baselineUsd = costOf(tokens, table[config.pricing.baseline])
  return { tier, tokens, costUsd, baselineUsd }
}

export function addStep(metrics: BigBearMetrics, model: string, step: PricedStep): BigBearMetrics {
  const bump = (bucket: BigBearModelBucket): BigBearModelBucket => ({
    ...addTokens(bucket, step.tokens),
    steps: bucket.steps + 1,
    costUsd: bucket.costUsd + step.costUsd,
  })
  if (step.tier === null) {
    return {
      ...metrics,
      other: { ...metrics.other, [model]: bump(metrics.other[model] ?? emptyBucket()) },
      // An unpriced model adds nothing to either side of the comparison.
    }
  }
  return {
    ...metrics,
    byTier: { ...metrics.byTier, [step.tier]: bump(metrics.byTier[step.tier]) },
    baselineUsd: metrics.baselineUsd + step.baselineUsd,
  }
}

export function sessionTokens(metrics: BigBearMetrics): BigBearTokens {
  let sum = emptyTokens()
  for (const tier of TIERS) sum = addTokens(sum, metrics.byTier[tier])
  for (const bucket of Object.values(metrics.other)) sum = addTokens(sum, bucket)
  return sum
}

export function sessionCost(metrics: BigBearMetrics): number {
  return TIERS.reduce((sum, tier) => sum + metrics.byTier[tier].costUsd, 0)
}

export type Savings =
  | { isAvailable: true; observedUsd: number; baselineUsd: number; savedUsd: number; percent: number; tokensSaved: number }
  | { isAvailable: false; reason: string }

/**
 * Estimated savings against a run of the same tokens on the baseline tier.
 * An estimate: a different model would not have spent the same tokens.
 *
 * `tokensSaved` is the saved share of the baseline cost expressed in tokens:
 * the session's tokens times that share. Routing does not make a request
 * smaller, it makes it cheaper, so this reads as "tokens of the baseline
 * model's bill that were not spent", never as tokens the account was refunded.
 */
export function savings(metrics: BigBearMetrics): Savings {
  const observedUsd = sessionCost(metrics)
  const steps = TIERS.reduce((sum, tier) => sum + metrics.byTier[tier].steps, 0)
  if (steps < 1 || metrics.baselineUsd <= 0) return { isAvailable: false, reason: 'Estimativa indisponível' }
  const savedUsd = metrics.baselineUsd - observedUsd
  const percent = (savedUsd / metrics.baselineUsd) * 100
  const tokensSaved = percent > 0 ? Math.round((totalTokens(sessionTokens(metrics)) * percent) / 100) : 0
  return { isAvailable: true, observedUsd, baselineUsd: metrics.baselineUsd, savedUsd, percent, tokensSaved }
}

/** Share of tokens per tier, as whole percents summing to 100, or null with no data. */
export function distribution(metrics: BigBearMetrics): Record<BigBearTier, number> | null {
  const totals = TIERS.map(tier => totalTokens(metrics.byTier[tier]))
  const sum = totals.reduce((a, b) => a + b, 0)
  if (sum === 0) return null
  const raw = totals.map(value => (value / sum) * 100)
  const floors = raw.map(Math.floor)
  let left = 100 - floors.reduce((a, b) => a + b, 0)
  const order = raw.map((value, index) => ({ index, frac: value - Math.floor(value) })).sort((a, b) => b.frac - a.frac)
  for (const { index } of order) {
    if (left <= 0) break
    floors[index]! += 1
    left -= 1
  }
  return { haiku: floors[0]!, sonnet: floors[1]!, opus: floors[2]! }
}
