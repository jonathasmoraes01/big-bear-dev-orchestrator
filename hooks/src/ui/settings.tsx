
import type { BigBearConfig, BigBearTier } from '../../../types'
import { MODULES, TIERS } from '../config/defaults'
import { hasProjectPolicy, resetSettings, saveSettings } from '../services/engine'
import { PALETTE, TIER_COLOR } from '../utils/format'
import type { Kit } from './kit'
import { section } from './kit'
import type { Io } from '../services/io'


export const SETTINGS_PANE = 'bigbear-settings'

async function change(io: Io, edit: (config: BigBearConfig) => BigBearConfig, scope: 'global' | 'project' = 'global') {
  const config = await io.state.config.get()
  await saveSettings(io, edit(JSON.parse(JSON.stringify(config)) as BigBearConfig), scope)
}

function toggle(ui: Kit, key: string, label: string, isOn: boolean, onPress: () => unknown) {
  return <ui.Button key={key} label={`${isOn ? '●' : '○'} ${label}`} variant={isOn ? 'primary' : undefined} onPress={onPress} />
}

export async function renderSettings(ui: Kit, io: Io, width: number) {
  const config = await io.state.config.get()
  const isProject = await hasProjectPolicy(io)
  const r = config.routing

  return (
    <ui.Box flexDirection="column" width={width}>
      <ui.Text color={PALETTE.text} bold>
        🐻 BIG BEAR · SETTINGS
      </ui.Text>
      <ui.Text color={PALETTE.muted}>Salvo entre sessões ({isProject ? 'política deste projeto ativa' : 'configuração global'}).</ui.Text>

      {section(ui, 'MÓDULOS')}
      <ui.Box flexDirection="row" flexWrap="wrap" gap={1}>
        {MODULES.map(m =>
          toggle(ui, `mod:${m.id}`, m.label, config.modules[m.id], () => change(io, c => ((c.modules[m.id] = !c.modules[m.id]), c))),
        )}
      </ui.Box>

      {section(ui, 'SMART BRAIN')}
      <ui.Box flexDirection="row" flexWrap="wrap" gap={1}>
        {toggle(ui, 'routing', 'Roteamento automático', r.enabled, () => change(io, c => ((c.routing.enabled = !c.routing.enabled), c)))}
        {(['eco', 'balanced', 'god'] as const).map(mode =>
          toggle(ui, `mode:${mode}`, mode.toUpperCase(), r.mode === mode, () => change(io, c => ((c.routing.mode = mode), c))),
        )}
      </ui.Box>
      <ui.Box flexDirection="row" flexWrap="wrap" gap={1}>
        <ui.Text color={PALETTE.muted}>Modelo:</ui.Text>
        {toggle(ui, 'manual:auto', 'Auto', r.manualTier === null, () => change(io, c => ((c.routing.manualTier = null), c)))}
        {TIERS.map(tier =>
          toggle(ui, `manual:${tier}`, tier.toUpperCase(), r.manualTier === tier, () => change(io, c => ((c.routing.manualTier = tier), c))),
        )}
      </ui.Box>
      <ui.Box flexDirection="row" flexWrap="wrap" gap={1}>
        <ui.Text color={PALETTE.muted}>Bloquear:</ui.Text>
        {TIERS.map((tier: BigBearTier) =>
          toggle(ui, `block:${tier}`, tier.toUpperCase(), r.blocked.includes(tier), () =>
            change(io, c => ((c.routing.blocked = c.routing.blocked.includes(tier) ? c.routing.blocked.filter(t => t !== tier) : [...c.routing.blocked, tier]), c)),
          ),
        )}
      </ui.Box>
      <ui.Box flexDirection="row" flexWrap="wrap" gap={1}>
        {toggle(ui, 'subagents', 'Rotear subagentes', r.routeSubagents, () => change(io, c => ((c.routing.routeSubagents = !c.routing.routeSubagents), c)))}
        {toggle(ui, 'cache', 'Preservar cache', r.cacheAware, () => change(io, c => ((c.routing.cacheAware = !c.routing.cacheAware), c)))}
        {toggle(ui, 'escalation', `Escalonamento (${r.escalation.maxPerTurn}/turno)`, r.escalation.enabled, () =>
          change(io, c => ((c.routing.escalation.enabled = !c.routing.escalation.enabled), c)),
        )}
        {toggle(ui, 'learn', 'Aprender c/ histórico', r.learnFromHistory, () => change(io, c => ((c.routing.learnFromHistory = !c.routing.learnFromHistory), c)))}
        {toggle(ui, 'ai', 'Classificador IA (custo extra)', r.aiClassifier, () => change(io, c => ((c.routing.aiClassifier = !c.routing.aiClassifier), c)))}
      </ui.Box>
      {TIERS.map(tier => (
        <ui.Text color={TIER_COLOR[tier]}>
          {tier.toUpperCase().padEnd(7)} {r.models[tier]}
        </ui.Text>
      ))}

      {section(ui, 'CONSUMO E CONTEXTO')}
      <ui.Box flexDirection="row" flexWrap="wrap" gap={1}>
        <ui.Text color={PALETTE.muted}>
          Alertas {config.usage.warn}% / {config.usage.high}% / {config.usage.critical}% · contexto {config.context.warnPercent}%
        </ui.Text>
        {toggle(ui, 'autoeco', 'ECO automático no limite', config.usage.autoEco, () => change(io, c => ((c.usage.autoEco = !c.usage.autoEco), c)))}
      </ui.Box>
      <ui.Box flexDirection="row" flexWrap="wrap" gap={1}>
        <ui.Text color={PALETTE.muted}>Referência p/ economia:</ui.Text>
        {TIERS.map(tier =>
          toggle(ui, `baseline:${tier}`, tier.toUpperCase(), config.pricing.baseline === tier, () => change(io, c => ((c.pricing.baseline = tier), c))),
        )}
      </ui.Box>

      {section(ui, 'PROTEÇÃO E QA')}
      <ui.Box flexDirection="row" flexWrap="wrap" gap={1}>
        <ui.Text color={PALETTE.muted}>Comando perigoso:</ui.Text>
        {(['ask', 'deny', 'warn'] as const).map(action =>
          toggle(ui, `guard:${action}`, action === 'ask' ? 'Perguntar' : action === 'deny' ? 'Bloquear' : 'Só avisar', config.guardian.action === action, () =>
            change(io, c => ((c.guardian.action = action), c)),
          ),
        )}
      </ui.Box>
      <ui.Box flexDirection="row" flexWrap="wrap" gap={1}>
        {toggle(ui, 'qa-auto', 'QA automático após alterações', config.qa.autoRun, () => change(io, c => ((c.qa.autoRun = !c.qa.autoRun), c)))}
        <ui.Text color={PALETTE.muted}>perfil: {config.qa.profile}</ui.Text>
      </ui.Box>

      {section(ui, 'APARÊNCIA')}
      <ui.Box flexDirection="row" flexWrap="wrap" gap={1}>
        {toggle(ui, 'autoopen', 'Abrir painel ao iniciar', config.ui.autoOpenPane, () => change(io, c => ((c.ui.autoOpenPane = !c.ui.autoOpenPane), c)))}
        {toggle(ui, 'notify', 'Notificar ao concluir tarefa', config.ui.notifyOnFinish, () => change(io, c => ((c.ui.notifyOnFinish = !c.ui.notifyOnFinish), c)))}
        {toggle(ui, 'band', 'Faixa de uso', config.ui.showBand, () => change(io, c => ((c.ui.showBand = !c.ui.showBand), c)))}
        {[500, 1000, 2000].map(ms =>
          toggle(ui, `refresh:${ms}`, `${ms}ms`, config.ui.refreshMs === ms, () => change(io, c => ((c.ui.refreshMs = ms), c))),
        )}
      </ui.Box>

      <ui.Box flexDirection="row" flexWrap="wrap" gap={1} marginTop={1}>
        <ui.Button key="save-project" label="Salvar roteamento p/ este projeto" onPress={() => change(io, c => c, 'project')} />
        <ui.Button key="reset" label="Restaurar padrão" onPress={() => resetSettings(io)} />
        <ui.Button key="close" label="Fechar" role="dismiss" onPress={() => io.ui.close({ id: SETTINGS_PANE })} />
      </ui.Box>
    </ui.Box>
  )
}
