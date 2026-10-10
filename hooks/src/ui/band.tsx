
import type { BigBearTier } from '../../../types'
import { isOpen } from '../core/tasks'
import { bar, PALETTE, TIER_COLOR, untilReset } from '../utils/format'
import type { Kit } from './kit'
import { ACTIVITY_COLOR, ACTIVITY_LABEL, meterColor, pill } from './kit'
import type { Io } from '../services/io'


const MODE_COLOR = { eco: PALETTE.primary, balanced: PALETTE.secondary, god: PALETTE.accent } as const

/** The usage band above the prompt: account windows, mode, model. */
export async function renderBand(ui: Kit, io: Io, width: number) {
  const [config, usage, tasks, decision, activity] = await Promise.all([
    io.state.config.get(),
    io.state.usage.get(),
    io.state.tasks.get(),
    io.state.decision.get(),
    io.state.activity.get(),
  ])
  const now = await io.clock.now()
  const running = tasks.find(task => isOpen(task) && task.kind === 'turn')
  const tier: BigBearTier | null = running?.tier ?? decision?.tier ?? null
  const { warn, high } = config.usage
  const meterWidth = width >= 110 ? 10 : width >= 80 ? 6 : 4
  const isTwoLines = width < 72


  const meter = (label: string, value: { percent: number } | null) =>
    value === null ? (
      <ui.Text color={PALETTE.muted}>{label} N/D — indisponível</ui.Text>
    ) : (
      <ui.Text color={meterColor(value.percent, warn, high)}>
        {label} {bar(value.percent, meterWidth)} {Math.round(value.percent)}%
      </ui.Text>
    )

  const identity = (
    <ui.Box flexDirection="row" columnGap={1}>
      <ui.Text color={ACTIVITY_COLOR[activity]} bold>
        ●
      </ui.Text>
      <ui.Text color={PALETTE.text} bold>
        BIG BEAR
      </ui.Text>
      {pill(ui, config.routing.mode.toUpperCase(), MODE_COLOR[config.routing.mode])}
      {tier !== null && config.routing.enabled && pill(ui, tier.toUpperCase(), TIER_COLOR[tier])}
      {!config.routing.enabled && pill(ui, 'AUTO OFF', PALETTE.warning)}
      {width >= 90 && <ui.Text color={ACTIVITY_COLOR[activity]}>{ACTIVITY_LABEL[activity]}</ui.Text>}
    </ui.Box>
  )

  const meters = (
    <ui.Box flexDirection="row" gap={1}>
      {meter('5H', usage?.fiveHour ?? null)}
      <ui.Text color={PALETTE.muted}>│</ui.Text>
      {meter('WEEK', usage?.week ?? null)}
      {usage?.fiveHour?.resetsAt !== undefined && (
        <ui.Text color={PALETTE.muted}>│ RESET 5H {untilReset(usage.fiveHour.resetsAt, now)}</ui.Text>
      )}
      {usage?.contextPercent !== null && usage?.contextPercent !== undefined && width >= 96 && (
        <ui.Text color={meterColor(usage.contextPercent, config.context.warnPercent - 10, config.context.warnPercent)}>
          │ CTX {usage.contextPercent}%
        </ui.Text>
      )}
      {usage?.fiveHour !== null && usage?.fiveHour !== undefined && usage.fiveHour.percent >= high && (
        <ui.Text color={PALETTE.danger} bold>
          ▲ CONSUMO ELEVADO
        </ui.Text>
      )}
    </ui.Box>
  )

  return isTwoLines ? (
    <ui.Box flexDirection="column">
      {identity}
      {meters}
    </ui.Box>
  ) : (
    <ui.Box flexDirection="row" gap={1}>
      {identity}
      <ui.Text color={PALETTE.muted}>│</ui.Text>
      {meters}
    </ui.Box>
  )
}
