
import type { BigBearConfig, BigBearMetrics, BigBearTask } from '../../../types'
import { TIERS } from '../config/defaults'
import { overall } from '../core/tasks'
import { redactPaths, redactSecrets } from '../modules/guardian'
import { distribution, savings, sessionCost, sessionTokens, totalTokens } from '../services/pricing'
import { compact, duration, PALETTE, TIER_COLOR, TIER_ROLE, usd } from '../utils/format'
import type { Kit } from './kit'
import { ACTIVITY_COLOR, ACTIVITY_LABEL, avatar } from './kit'
import type { Io } from '../services/io'


export const SHOWCASE_PANE = 'bigbear-showcase'

function stat(ui: Kit, label: string, value: string, color: string, width: number) {
  return (
    <ui.Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} width={width} alignItems="center">
      <ui.Text color={color} bold>
        {value}
      </ui.Text>
      <ui.Text color={PALETTE.muted}>{label}</ui.Text>
    </ui.Box>
  )
}

export async function renderShowcase(ui: Kit, io: Io, width: number) {
  const [config, tasks, metrics, activity] = await Promise.all([io.state.config.get(), io.state.tasks.get(), io.state.metrics.get(), io.state.activity.get()])
  const now = await io.clock.now()
  const all = overall(tasks, now)
  const share = distribution(metrics)
  const save = savings(metrics)
  const tokens = totalTokens(sessionTokens(metrics))
  const barWidth = Math.max(10, Math.min(48, width - 6))
  const statWidth = Math.max(14, Math.floor((width - 4) / (width >= 80 ? 4 : 2)) - 1)

  const segments =
    share === null
      ? [<ui.Text color={PALETTE.muted}>{'░'.repeat(barWidth)}</ui.Text>]
      : TIERS.filter(tier => share[tier] > 0).map(tier => (
          <ui.Text color={TIER_COLOR[tier]}>{'█'.repeat(Math.max(1, Math.round((share[tier] / 100) * barWidth)))}</ui.Text>
        ))

  return (
    <ui.Box flexDirection="column" width={width} alignItems="center" paddingY={1}>
      {avatar(ui, activity, 'lg', 'showcase-avatar')}
      <ui.Text color={PALETTE.text} bold>
        🐻 BIG BEAR DEV ORCHESTRATOR
      </ui.Text>
      <ui.Text color={PALETTE.muted}>Code Smarter. Build Faster. Spend Less.</ui.Text>
      <ui.Box flexDirection="row" gap={1} marginTop={1}>
        <ui.Text color={ACTIVITY_COLOR[activity]}>● {ACTIVITY_LABEL[activity]}</ui.Text>
        <ui.Text color={PALETTE.muted}>·</ui.Text>
        <ui.Text color={PALETTE.secondary} bold>
          {config.routing.mode.toUpperCase()} MODE
        </ui.Text>
      </ui.Box>

      <ui.Box flexDirection="column" marginTop={1} alignItems="center">
        <ui.Box flexDirection="row">{segments}</ui.Box>
        <ui.Box flexDirection="row" gap={2}>
          {TIERS.map(tier => (
            <ui.Text color={TIER_COLOR[tier]}>
              ■ {tier.toUpperCase()} {share === null ? '—' : `${share[tier]}%`}
            </ui.Text>
          ))}
        </ui.Box>
      </ui.Box>

      <ui.Box flexDirection="row" flexWrap="wrap" gap={1} marginTop={1} justifyContent="center">
        {stat(ui, 'progresso', all.percent === null ? '—' : `${all.percent}%`, PALETTE.primary, statWidth)}
        {stat(ui, 'concluídas', `${all.completed}/${all.total}`, PALETTE.secondary, statWidth)}
        {stat(ui, 'tokens', compact(tokens), PALETTE.accent, statWidth)}
        {stat(ui, 'tempo total', duration(all.elapsedMs), PALETTE.warning, statWidth)}
        {stat(ui, 'eq. API', usd(sessionCost(metrics)), PALETTE.accent, statWidth)}
        {stat(ui, `economia vs ${config.pricing.baseline}`, save.isAvailable ? `${save.percent.toFixed(1)}%` : 'indisp.', PALETTE.primary, statWidth)}
      </ui.Box>
      <ui.Text color={PALETTE.muted} dimColor>
        Economia é estimativa em custo equivalente de API, não economia garantida de limite.
      </ui.Text>
    </ui.Box>
  )
}

/** A plain-text summary for sharing: no paths, no secrets, no prompt text. */
export function showcaseText(config: BigBearConfig, tasks: readonly BigBearTask[], metrics: BigBearMetrics, now: number): string {
  const all = overall(tasks, now)
  const share = distribution(metrics)
  const save = savings(metrics)
  const lines = [
    '🐻 BIG BEAR DEV ORCHESTRATOR — Code Smarter. Build Faster. Spend Less.',
    `Modo: ${config.routing.mode.toUpperCase()}`,
    `Tarefas: ${all.completed}/${all.total} concluídas · tempo total ${duration(all.elapsedMs)}`,
    `Tokens: ${compact(totalTokens(sessionTokens(metrics)))} · custo equivalente de API ${usd(sessionCost(metrics))}`,
    `Modelos: ${share === null ? 'sem dados' : TIERS.map(tier => `${tier.toUpperCase()} ${share[tier]}% (${TIER_ROLE[tier]})`).join(' · ')}`,
    `Economia estimada vs ${config.pricing.baseline.toUpperCase()}: ${save.isAvailable ? `${save.percent.toFixed(1)}%` : 'indisponível'} ${save.isAvailable && save.tokensSaved > 0 ? ` · ~${compact(save.tokensSaved)} tokens poupados` : ''} (estimativa, não garantia)`,
  ]
  return redactPaths(redactSecrets(lines.join('\n')))
}
