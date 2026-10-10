import type { BigBearConfig, BigBearMode, BigBearTask, BigBearTier } from '../../../types'
import { TIERS } from '../config/defaults'
import { isOpen, MILESTONES, overall, progress } from '../core/tasks'
import { saveSettings } from '../services/engine'
import type { Io } from '../services/io'
import { distribution, savings, sessionCost, sessionTokens, totalTokens } from '../services/pricing'
import { clip, compact, duration, PALETTE, projectName, STATUS_COLOR, STATUS_GLYPH, TIER_COLOR, TIER_ROLE, usd } from '../utils/format'
import type { Kit } from './kit'
import { ACTIVITY_COLOR, ACTIVITY_LABEL, avatar, card, pill, section } from './kit'
import { panelView } from './model'
import type { Level } from './model'

export const MAIN_PANE = 'bigbear'

const LEVEL_COLOR: Record<Level, string> = { ok: PALETTE.primary, info: PALETTE.secondary, warn: PALETTE.warning, danger: PALETTE.danger, idle: PALETTE.muted }
const MODE_LABEL: Record<BigBearMode, string> = { eco: 'ECO', balanced: 'BALANCED', god: 'GOD' }
const MODE_COLOR: Record<BigBearMode, string> = { eco: PALETTE.primary, balanced: PALETTE.secondary, god: PALETTE.accent }

export async function setMode(io: Io, mode: BigBearMode): Promise<BigBearConfig> {
  const config = await io.state.config.get()
  const next = { ...config, routing: { ...config.routing, mode } }
  await saveSettings(io, next)
  return next
}

/** Native controls: buttons keep focus, hotkeys and clicks. Short labels in a narrow pane. */
function controls(ui: Kit, io: Io, config: BigBearConfig, isNarrow: boolean) {
  const mode = config.routing.mode
  return (
    <ui.Box flexDirection="row" flexWrap="wrap" columnGap={1}>
      <ui.Button key="mode:eco" label="ECO" hotkey="1" variant={mode === 'eco' ? 'primary' : undefined} onPress={() => setMode(io, 'eco')} />
      <ui.Button
        key="mode:balanced"
        label={isNarrow ? 'BAL' : 'BALANCED'}
        hotkey="2"
        variant={mode === 'balanced' ? 'primary' : undefined}
        onPress={() => setMode(io, 'balanced')}
      />
      <ui.Button key="mode:god" label="GOD" hotkey="3" variant={mode === 'god' ? 'primary' : undefined} onPress={() => setMode(io, 'god')} />
      <ui.Button
        key="routing"
        label={config.routing.enabled ? 'Auto ON' : 'Auto OFF'}
        hotkey="a"
        onPress={async () => {
          const c = await io.state.config.get()
          await saveSettings(io, { ...c, routing: { ...c.routing, enabled: !c.routing.enabled } })
        }}
      />
      <ui.Button key="open:settings" label={isNarrow ? 'Set' : 'Settings'} hotkey="s" onPress={() => io.ui.open({ id: 'bigbear-settings', title: 'BIG BEAR · Settings' })} />
      {config.modules.showcase && (
        <ui.Button key="open:showcase" label={isNarrow ? 'Show' : 'Showcase'} hotkey="w" onPress={() => io.ui.open({ id: 'bigbear-showcase', title: 'BIG BEAR · Showcase' })} />
      )}
    </ui.Box>
  )
}

/** Five steps, one per verified milestone. */
function milestoneBar(task: BigBearTask): string {
  return '▰'.repeat(task.milestones) + '▱'.repeat(Math.max(0, MILESTONES - task.milestones))
}

function taskRow(ui: Kit, io: Io, task: BigBearTask, now: number, width: number, isExpanded: boolean, indent: string) {
  const elapsed = (task.endedAt ?? now) - task.startedAt
  const tokens = totalTokens(task.tokens)
  const isNarrow = width < 60
  const titleWidth = Math.max(8, width - (isNarrow ? 24 : 54) - indent.length)
  const status = task.status === 'WAITING' && task.pendingTool !== undefined ? `WAITING ${task.pendingTool}` : task.status
  return (
    <ui.Box flexDirection="column">
      <ui.Box flexDirection="row" columnGap={1} backgroundColor={isOpen(task) && indent.length === 0 ? PALETTE.surface : undefined}>
        {indent.length > 0 ? <ui.Text color={PALETTE.muted}>{indent}</ui.Text> : <ui.Text color={isOpen(task) ? TIER_COLOR[task.tier] : PALETTE.surface}>▌</ui.Text>}
        <ui.Text color={STATUS_COLOR[task.status]}>{STATUS_GLYPH[task.status]}</ui.Text>
        <ui.Text color={TIER_COLOR[task.tier]} bold>
          {task.tier.slice(0, 1).toUpperCase()}
        </ui.Text>
        <ui.Text color={PALETTE.text} wrap="truncate-end">
          {clip(task.title, titleWidth)}
        </ui.Text>
        <ui.Box flexGrow={1} />
        {!isNarrow && <ui.Text color={STATUS_COLOR[task.status]}>{clip(status, 14)}</ui.Text>}
        <ui.Text color={TIER_COLOR[task.tier]}>{milestoneBar(task)}</ui.Text>
        <ui.Text color={PALETTE.muted}>{duration(elapsed)}</ui.Text>
        {!isNarrow &&
          (isOpen(task) ? (
            <ui.Text color={task.etaMs === null ? PALETTE.warning : PALETTE.accent}>
              {task.etaMs === null ? 'ETA ?' : task.etaMs - elapsed <= 0 ? 'além da média' : `ETA ~${duration(task.etaMs - elapsed)}`}
            </ui.Text>
          ) : (
            <ui.Text color={PALETTE.muted}>{tokens > 0 ? `${compact(tokens)} tok` : '—'}</ui.Text>
          ))}
        {task.toolErrors > 0 && <ui.Text color={PALETTE.danger}>!{task.toolErrors}</ui.Text>}
        <ui.Button
          key={`exp:${task.id}`}
          label={isExpanded ? '▾' : '▸'}
          plain
          dimColor
          onPress={() => io.state.view.set(view => ({ ...view, expanded: view.expanded === task.id ? null : task.id }))}
        />
      </ui.Box>
      {isExpanded && (
        <ui.Box flexDirection="column" paddingLeft={indent.length + 4} borderStyle="single" borderColor={PALETTE.surface}>
          <ui.Text color={PALETTE.muted}>
            #{task.id} · {task.category} · {task.model}
            {task.routed ? '' : ' (não roteado)'}
          </ui.Text>
          <ui.Text color={PALETTE.muted}>
            Progresso {progress(task)}% ({task.milestones}/{MILESTONES} marcos) · passos {task.steps} · ferramentas {task.toolCalls}
            {task.toolErrors > 0 ? ` (${task.toolErrors} erros)` : ''} · escalonamentos {task.escalations}
          </ui.Text>
          <ui.Text color={PALETTE.muted}>
            Tokens in {compact(task.tokens.input)} · out {compact(task.tokens.output)} · cache r {compact(task.tokens.cacheRead)} · w {compact(task.tokens.cacheWrite)} ·{' '}
            {usd(task.costUsd)} eq. API
          </ui.Text>
          <ui.Text color={PALETTE.muted}>
            ETA {task.endedAt !== undefined ? 'concluída' : task.etaMs === null ? 'Calculando (sem histórico)' : duration(Math.max(0, task.etaMs - elapsed))}
          </ui.Text>
          {task.reasons.map(reason => (
            <ui.Text color={PALETTE.muted}>• {clip(reason, Math.max(20, width - 10))}</ui.Text>
          ))}
          {task.result !== undefined && <ui.Text color={PALETTE.text}>↳ {clip(task.result, Math.max(20, width - 10))}</ui.Text>}
          {task.error !== undefined && <ui.Text color={PALETTE.danger}>✗ {clip(task.error, Math.max(20, width - 10))}</ui.Text>}
        </ui.Box>
      )}
    </ui.Box>
  )
}

/**
 * The central panel. It sizes itself to the rows the pane has so nothing
 * scrolls: full cards when there is room, a dense layout when there is not.
 */
export async function renderMainPane(ui: Kit, io: Io, width: number, rows: number) {
  const [config, tasks, metrics, view, git, qa, alerts, decision, project, activity, usage] = await Promise.all([
    io.state.config.get(),
    io.state.tasks.get(),
    io.state.metrics.get(),
    io.state.view.get(),
    io.state.git.get(),
    io.state.qa.get(),
    io.state.alerts.get(),
    io.state.decision.get(),
    io.state.project.get(),
    io.state.activity.get(),
    io.state.usage.get(),
  ])
  await io.state.tick.get()
  const now = await io.clock.now()
  const mode = config.routing.mode
  const running = tasks.find(task => isOpen(task) && task.kind === 'turn')
  const current = running ?? tasks.filter(task => task.kind === 'turn').at(-1)
  const activeTier: BigBearTier | null = running?.tier ?? decision?.tier ?? null
  const isNarrow = width < 60
  const isWide = width >= 72
  const cardWidth = isWide ? Math.floor((width - 3) / 2) : width
  const all = overall(tasks, now)
  const roots = tasks.filter(task => task.kind === 'turn')
  const liveRoots = roots.filter(isOpen)
  const doneRoots = roots.filter(task => !isOpen(task)).reverse()
  // 'RESTA': a number only when history supports one; never a bare 0 while work is open.
  const remaining =
    liveRoots.length === 0 ? '—' : all.etaMs === null ? 'calculando' : all.etaMs <= 0 ? 'finalizando' : `~${duration(all.etaMs)}`
  const tokens = sessionTokens(metrics)
  const save = savings(metrics)
  const share = distribution(metrics)
  const tiles = panelView({ config, tasks, metrics, usage, git, qa, alerts, activity, decisionTier: decision?.tier ?? null, project, now, showAll: false }).guardians

  // Row budget. The header is 6 rows (the bear), the controls 1-2.
  const budget = Math.max(12, rows)
  const controlRows = isNarrow ? 2 : 1
  const isFull = budget >= 40 && config.modules.tokenIntelligence
  const tokenRows = !config.modules.tokenIntelligence ? 0 : isFull ? (isWide ? 13 : 25) : 3
  const guardianRows = isFull && isWide ? 3 : 2
  const taskTitleRows = 4
  const room = budget - 8 - controlRows - tokenRows - guardianRows - taskTitleRows - 1
  const taskRows = Math.max(1, Math.min(isFull ? 8 : 6, room))
  const shownLive = liveRoots.slice(0, taskRows)
  const childRows = (task: BigBearTask) => tasks.filter(child => child.parentId === task.id)
  let left = taskRows - shownLive.length
  const shownDone = view.showAll ? doneRoots : doneRoots.slice(0, Math.max(0, left))
  const hidden = doneRoots.length - shownDone.length + (liveRoots.length - shownLive.length)

  return (
    <ui.Box flexDirection="column" width={width}>
      {/* HEADER */}
      <ui.Box
        flexDirection="row"
        columnGap={2}
        alignItems="center"
        borderStyle="round"
        borderColor={activeTier !== null && config.routing.enabled ? TIER_COLOR[activeTier] : PALETTE.muted}
        backgroundColor={PALETTE.surface}
        paddingX={1}
      >
        {avatar(ui, activity, 'xs', 'avatar')}
        <ui.Box flexDirection="column" flexGrow={1}>
          <ui.Box flexDirection="row" columnGap={1}>
            <ui.Text color={PALETTE.text} bold>
              BIG BEAR
            </ui.Text>
            <ui.Text color={PALETTE.muted}>DEV</ui.Text>
            <ui.Box flexGrow={1} />
            <ui.Text color={ACTIVITY_COLOR[activity]} bold>
              ● {ACTIVITY_LABEL[activity]}
            </ui.Text>
          </ui.Box>
          <ui.Text color={PALETTE.muted} wrap="truncate-end">
            {clip(`${projectName(project) || 'sem projeto'}${git?.isRepo === true && git.branch !== null ? `  ⎇ ${git.branch}` : ''}`, Math.max(10, width - 26))}
          </ui.Text>
          <ui.Box flexDirection="row" columnGap={1} marginTop={1}>
            {pill(ui, MODE_LABEL[mode], MODE_COLOR[mode])}
            {config.routing.enabled && config.modules.smartBrain ? (
              activeTier !== null ? (
                pill(ui, `${activeTier.toUpperCase()}${isNarrow ? '' : ` · ${TIER_ROLE[activeTier]}`}`, TIER_COLOR[activeTier])
              ) : (
                <ui.Text color={PALETTE.muted}>aguardando pedido</ui.Text>
              )
            ) : (
              pill(ui, 'ROTEAMENTO OFF', PALETTE.warning)
            )}
            {config.routing.manualTier !== null && <ui.Text color={PALETTE.warning}>manual</ui.Text>}
          </ui.Box>
        </ui.Box>
      </ui.Box>

      {/* TASKS */}
      {config.modules.taskCommand && (
        <ui.Box flexDirection="column">
          {section(
            ui,
            'TASKS',
            `${all.done}/${all.total}${all.percent !== null ? ` · ${all.percent}%` : ''}`,
            PALETTE.secondary,
          )}
          <ui.Box flexDirection="row" columnGap={1}>
            {pill(ui, `${liveRoots.length} EXECUTANDO`, liveRoots.length > 0 ? PALETTE.secondary : PALETTE.muted)}
            {pill(ui, `${all.completed} CONCLUÍDAS`, all.completed > 0 ? PALETTE.primary : PALETTE.muted)}
            {all.failed > 0 && pill(ui, `${all.failed} FALHA${all.failed > 1 ? 'S' : ''}`, PALETTE.danger)}
          </ui.Box>
          <ui.Box flexDirection="row" flexWrap="wrap" columnGap={1} marginBottom={1}>
            {pill(ui, `${isNarrow ? 'AGORA' : 'TRABALHANDO HÁ'} ${all.runningMs === null ? 'ocioso' : duration(all.runningMs)}`, all.runningMs === null ? PALETTE.muted : PALETTE.secondary)}
            {pill(ui, `${isNarrow ? 'TRAB.' : 'TRABALHOU'} ${duration(all.workedMs)}`, all.workedMs > 0 ? PALETTE.primary : PALETTE.muted)}
            {pill(ui, `RESTA ${remaining}`, all.etaMs === null ? PALETTE.warning : liveRoots.length === 0 ? PALETTE.muted : PALETTE.accent)}
          </ui.Box>
          {roots.length === 0 && <ui.Text color={PALETTE.muted}>Nenhuma tarefa ainda. Envie um pedido: o Smart Brain escolhe o modelo.</ui.Text>}
          {shownLive.map(task => (
            <ui.Box flexDirection="column">
              {taskRow(ui, io, task, now, width, view.expanded === task.id, '')}
              {childRows(task)
                .slice(0, isFull ? 4 : 1)
                .map((child, index, list) => taskRow(ui, io, child, now, width, view.expanded === child.id, index === list.length - 1 ? '└─' : '├─'))}
            </ui.Box>
          ))}
          {shownDone.map(task => taskRow(ui, io, task, now, width, view.expanded === task.id, ''))}
          {hidden > 0 && (
            <ui.Button key="show-all" label={`+${hidden} anteriores`} plain dimColor onPress={() => io.state.view.set(v => ({ ...v, showAll: true }))} />
          )}
          {view.showAll && <ui.Button key="show-less" label="mostrar menos" plain dimColor onPress={() => io.state.view.set(v => ({ ...v, showAll: false }))} />}
        </ui.Box>
      )}

      {/* TOKEN INTELLIGENCE */}
      {config.modules.tokenIntelligence &&
        (isFull ? (
          <ui.Box flexDirection="column">
            {section(ui, 'TOKEN INTELLIGENCE', undefined, PALETTE.accent)}
            <ui.Box flexDirection="row" flexWrap="wrap" columnGap={1}>
              {card(
                ui,
                'TOKENS',
                PALETTE.secondary,
                [
                  { label: 'entrada', value: compact(tokens.input) },
                  { label: 'saída', value: compact(tokens.output) },
                  { label: 'cache lido', value: compact(tokens.cacheRead) },
                  { label: 'cache criado', value: compact(tokens.cacheWrite) },
                  { label: 'tarefa atual', value: current !== undefined ? compact(totalTokens(current.tokens)) : '—' },
                  { label: 'sessão', value: compact(totalTokens(tokens)) },
                ],
                cardWidth,
              )}
              {card(
                ui,
                'API EQUIVALENT',
                PALETTE.accent,
                [
                  ...TIERS.map(tier => ({ label: tier.toUpperCase(), value: usd(metrics.byTier[tier].costUsd), color: TIER_COLOR[tier] })),
                  { label: 'total', value: usd(sessionCost(metrics)) },
                  { label: 'preços', value: config.pricing.updatedAt, color: PALETTE.muted },
                ],
                cardWidth,
              )}
              {card(
                ui,
                'SMART SAVINGS',
                PALETTE.primary,
                save.isAvailable
                  ? [
                      {
                        label: 'economia est.',
                        value: `${save.percent >= 0 ? '−' : '+'}${Math.abs(save.percent).toFixed(1)}%`,
                        color: save.percent >= 0 ? PALETTE.primary : PALETTE.warning,
                      },
                      { label: 'tokens poupados', value: save.tokensSaved > 0 ? `~${compact(save.tokensSaved)}` : '0', color: PALETTE.primary },
                      { label: `vs ${config.pricing.baseline.toUpperCase()}`, value: usd(save.baselineUsd) },
                      { label: 'observado', value: usd(save.observedUsd) },
                    ]
                  : [{ label: save.reason, value: '', color: PALETTE.muted }],
                cardWidth,
              )}
              {card(
                ui,
                'MODEL USAGE',
                PALETTE.warning,
                share === null
                  ? [{ label: 'sem dados coletados', value: '', color: PALETTE.muted }]
                  : TIERS.map(tier => ({
                      label: tier.toUpperCase(),
                      value: `${'█'.repeat(Math.round(share[tier] / 10))}${'░'.repeat(10 - Math.round(share[tier] / 10))} ${share[tier]}%`,
                      color: TIER_COLOR[tier],
                    })),
                cardWidth,
              )}
            </ui.Box>
          </ui.Box>
        ) : (
          <ui.Box flexDirection="column">
            {section(ui, 'TOKENS', undefined, PALETTE.accent)}
            <ui.Box flexDirection="row" columnGap={3} flexWrap="wrap" backgroundColor={PALETTE.surface} paddingX={1}>
              <ui.Text>
                <ui.Text color={PALETTE.secondary} bold>
                  {compact(totalTokens(tokens))}
                </ui.Text>
                <ui.Text color={PALETTE.muted}> tok</ui.Text>
              </ui.Text>
              <ui.Text>
                <ui.Text color={PALETTE.accent} bold>
                  {usd(sessionCost(metrics))}
                </ui.Text>
                <ui.Text color={PALETTE.muted}> eq. API</ui.Text>
              </ui.Text>
              <ui.Text color={save.isAvailable && save.percent >= 0 ? PALETTE.primary : PALETTE.muted} bold>
                {save.isAvailable ? `${save.percent >= 0 ? '−' : '+'}${Math.abs(save.percent).toFixed(0)}% econ.${save.tokensSaved > 0 ? ` ~${compact(save.tokensSaved)} tok` : ''}` : 'econ. N/D'}
              </ui.Text>
            </ui.Box>
            <ui.Box flexDirection="row" columnGap={2} backgroundColor={PALETTE.surface} paddingX={1}>
              {share === null ? (
                <ui.Text color={PALETTE.muted}>uso por modelo: sem dados</ui.Text>
              ) : (
                TIERS.map(tier => (
                  <ui.Text color={TIER_COLOR[tier]} bold>
                    {tier.slice(0, 1).toUpperCase()} {share[tier]}%
                  </ui.Text>
                ))
              )}
            </ui.Box>
          </ui.Box>
        ))}

      {/* GUARDIANS */}
      {section(ui, 'GUARDIANS', undefined, PALETTE.warning)}
      <ui.Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        {[tiles.git, tiles.qa, tiles.security, tiles.context].map(item => (
          <ui.Box flexDirection="row" columnGap={1} backgroundColor={PALETTE.surface} paddingX={1} width={Math.floor((width - 1) / 2)}>
            <ui.Text color={LEVEL_COLOR[item.level]} bold>
              ●
            </ui.Text>
            <ui.Text color={PALETTE.muted}>{item.label}</ui.Text>
            <ui.Box flexGrow={1} />
            <ui.Text color={item.level === 'idle' ? PALETTE.muted : LEVEL_COLOR[item.level]} bold wrap="truncate-end">
              {item.value}
            </ui.Text>
          </ui.Box>
        ))}
      </ui.Box>
      {alerts.length > 0 && (
        <ui.Text color={alerts.at(-1)!.level === 'danger' ? PALETTE.danger : alerts.at(-1)!.level === 'warn' ? PALETTE.warning : PALETTE.muted} wrap="truncate-end">
          ⚠ {clip(alerts.at(-1)!.text, Math.max(20, width - 4))}
        </ui.Text>
      )}

      {/* CONTROLS */}
      <ui.Box marginTop={1}>{controls(ui, io, config, isNarrow)}</ui.Box>
    </ui.Box>
  )
}
