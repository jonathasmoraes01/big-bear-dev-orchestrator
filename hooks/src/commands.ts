import type { CommandRunResult } from 'claude-code'
import type { Io } from './services/io'

import type { BigBearConfig, BigBearMode, BigBearTier } from '../../types'
import { TIERS } from './config/defaults'
import { runtime } from './core/runtime'
import { overall } from './core/tasks'
import { pendingChanges } from './modules/git'
import { redactPaths, redactSecrets } from './modules/guardian'
import { availableProfiles, detectChecks, planQa } from './modules/qa'
import { summarize } from './services/analytics'
import {
  addDecision,
  clearProjectPolicy,
  loadDecisions,
  projectFacts,
  refreshGit,
  resetSettings,
  runQa,
  saveSettings,
} from './services/engine'
import { distribution, savings, sessionCost, sessionTokens, totalTokens } from './services/pricing'
import { compact, duration, projectName, untilReset, usd } from './utils/format'
import { MAIN_PANE } from './ui/pane'
import { SETTINGS_PANE } from './ui/settings'
import { SHOWCASE_PANE, showcaseText } from './ui/showcase'


export const COMMAND = 'bigbear'

const HELP = [
  '🐻 BIG BEAR — comandos',
  '/bigbear                      abre/fecha a central',
  '/bigbear status               estado geral',
  '/bigbear mode eco|balanced|god [--project]',
  '/bigbear model auto|haiku|sonnet|opus   fixa ou libera o modelo',
  '/bigbear block|unblock <tier>  impede/libera um modelo',
  '/bigbear on | off             liga/desliga o roteamento automático',
  '/bigbear tasks | usage | models | history | summary',
  '/bigbear qa [perfil|list]     roda testes reais do projeto',
  '/bigbear bug <erro>           Bug Hunter: investigação guiada',
  '/bigbear decision <texto>     registra uma decisão técnica',
  '/bigbear settings | showcase [export] | doctor [probe]',
  '/bigbear price <tier> <in> <out> <cacheRead> <cacheWrite>   USD/MTok',
  '/bigbear set-model <tier> <id>   troca o modelo de um nível',
  '/bigbear alerts <aviso> <elevado> <crítico>   limiares de uso (%)',
  '/bigbear qa-profile <perfil>     perfil padrão do Auto QA',
  '/bigbear project reset | reset',
].join('\n')

async function setConfig(io: Io, edit: (c: BigBearConfig) => void, scope: 'global' | 'project' = 'global'): Promise<BigBearConfig> {
  const config = JSON.parse(JSON.stringify(await io.state.config.get())) as BigBearConfig
  edit(config)
  await saveSettings(io, config, scope)
  return config
}

function isTier(value: string | undefined): value is BigBearTier {
  return value !== undefined && (TIERS as readonly string[]).includes(value)
}

async function statusText(io: Io): Promise<string> {
  const [config, tasks, metrics, usage, git, qa, decision] = await Promise.all([
    io.state.config.get(),
    io.state.tasks.get(),
    io.state.metrics.get(),
    io.state.usage.get(),
    io.state.git.get(),
    io.state.qa.get(),
    io.state.decision.get(),
  ])
  const now = await io.clock.now()
  const all = overall(tasks, now)
  const save = savings(metrics)
  const pct = (w: { percent: number; resetsAt?: string } | null | undefined) =>
    w === null || w === undefined ? 'N/D — indisponível' : `${Math.round(w.percent)}% (reset em ${untilReset(w.resetsAt, now)})`
  return [
    `🐻 BIG BEAR · ${projectName(runtime.root)} · ${config.routing.mode.toUpperCase()}${config.routing.enabled ? '' : ' · roteamento OFF'}${
      config.routing.manualTier !== null ? ` · manual ${config.routing.manualTier.toUpperCase()}` : ''
    }`,
    `Último roteamento: ${decision === null ? '—' : `${decision.tier.toUpperCase()} (${decision.model}) — ${decision.reasons.join('; ')}`}`,
    `Sessão do Claude: ${await io.session.model()}`,
    `Tarefas: ${all.done}/${all.total} · ${all.completed} concluídas · ${all.failed} falhas · ${duration(all.elapsedMs)}`,
    `Tokens: ${compact(totalTokens(sessionTokens(metrics)))} · eq. API ${usd(sessionCost(metrics))} · economia ${save.isAvailable ? `${save.percent.toFixed(1)}% vs ${config.pricing.baseline}${save.tokensSaved > 0 ? ` (~${compact(save.tokensSaved)} tokens poupados, estimativa)` : ''}` : 'indisponível'}`,
    `Uso 5H: ${pct(usage?.fiveHour)} · Semana: ${pct(usage?.week)} · Contexto: ${usage?.contextPercent ?? 'N/D'}%`,
    `Git: ${git === null ? '—' : git.isRepo ? `${git.branch ?? 'HEAD'} · ${pendingChanges(git)} alterações` : 'não é repositório'} · QA: ${qa.lastResult ?? 'não executado'}`,
  ].join('\n')
}

async function usageText(io: Io): Promise<string> {
  const usage = await io.session.usage()
  const now = await io.clock.now()
  const lines = ['🐻 USAGE (dados do próprio Claude Code: io.session.usage)']
  if (usage.rateLimits.length === 0) lines.push('Janelas de limite: N/D — indisponível (sem assinatura ou nenhuma resposta ainda).')
  for (const limit of usage.rateLimits) {
    lines.push(`${limit.kind}: ${limit.percentUsed}%${limit.resetsAt !== undefined ? ` · reset em ${untilReset(limit.resetsAt, now)}` : ''}`)
  }
  lines.push(
    `Contexto: ${usage.context.percent ?? 'N/D'}% de ${compact(usage.context.window)} tokens (janela de contexto ≠ limite da conta)`,
    `Custo da sessão (ledger do Claude Code): ${usage.cost !== undefined ? usd(usage.cost.usd) : 'N/D'}`,
  )
  return lines.join('\n')
}

async function modelsText(io: Io): Promise<string> {
  const config = await io.state.config.get()
  const metrics = await io.state.metrics.get()
  const share = distribution(metrics)
  const lines = [`🐻 MODELOS · sessão atual: ${await io.session.model()}`]
  for (const tier of TIERS) {
    const price = config.pricing.table[tier]
    lines.push(
      `${tier.toUpperCase().padEnd(7)} ${config.routing.models[tier].padEnd(20)} ${config.routing.blocked.includes(tier) ? 'BLOQUEADO ' : ''}` +
        `$${price.input}/$${price.output} por MTok · uso ${share === null ? '—' : `${share[tier]}%`} · ${compact(totalTokens(metrics.byTier[tier]))} tok`,
    )
  }
  for (const [model, bucket] of Object.entries(metrics.other)) lines.push(`outro   ${model} · ${compact(totalTokens(bucket))} tok (sem preço)`)
  lines.push(`Preços: ${config.pricing.source} (${config.pricing.updatedAt}).`, 'Disponibilidade real: /bigbear doctor probe (faz 1 chamada mínima por modelo).')
  return lines.join('\n')
}

async function historyText(): Promise<string> {
  const s = summarize(runtime.history)
  if (s.total === 0) return '🐻 HISTÓRICO: vazio. Ele cresce a cada tarefa concluída (só métricas, nunca código ou prompts).'
  const lines = [
    `🐻 HISTÓRICO · ${s.total} tarefas · ${s.completed} ok · ${s.failed} falhas · ${s.cancelled} canceladas · média ${duration(s.avgMs)}`,
    `Escalonamentos: ${s.escalations} · tokens ${compact(s.tokens)} · eq. API ${usd(s.costUsd)}`,
    `Por modelo: ${TIERS.map(t => `${t.toUpperCase()} ${s.byTier[t]}`).join(' · ')}`,
    'Por tipo:',
    ...s.byCategory.slice(0, 8).map(c => `  ${c.category.padEnd(13)} ${String(c.runs).padStart(4)}× · sucesso ${(c.successRate * 100).toFixed(0)}% · ${duration(c.avgMs)}`),
    'Por projeto:',
    ...s.byProject.slice(0, 5).map(p => `  ${projectName(p.project).padEnd(24)} ${p.runs}× · ${usd(p.costUsd)}`),
  ]
  return lines.join('\n')
}

async function qaCommand(io: Io, arg: string): Promise<CommandRunResult> {
  const config = await io.state.config.get()
  if (!config.modules.autoQa) return { text: 'Auto QA está desligado (Settings → Módulos).' }
  const facts = await projectFacts(io, runtime.root)
  const checks = detectChecks(facts)
  if (arg === 'list' || arg === 'perfis') {
    return {
      text: [
        `🐻 AUTO QA · perfis: ${availableProfiles(facts).join(', ')}`,
        `Detectado: typecheck=${checks.typecheck ?? '—'} · lint=${checks.lint ?? '—'} · test=${checks.test ?? '—'} · build=${checks.build ?? '—'}`,
        `Perfil padrão: ${config.qa.profile} · automático após edições: ${config.qa.autoRun ? 'sim' : 'não'}`,
      ].join('\n'),
    }
  }
  if (runtime.qaRunning) return { text: 'Auto QA já está rodando.' }
  const plan = planQa(facts, arg || config.qa.profile)
  if (plan.steps.length === 0) return { text: ['🐻 AUTO QA: nada a executar.', ...plan.notes].join('\n') }
  runtime.qaRunning = true
  try {
    await io.ui.open({ id: MAIN_PANE, title: 'BIG BEAR' })
    await runQa(io, runtime.root, plan)
  } finally {
    runtime.qaRunning = false
  }
  const qa = await io.state.qa.get()
  const lines = [`🐻 AUTO QA · ${plan.profile}: ${qa.lastResult === 'passed' ? 'PASSOU' : 'FALHOU'}`]
  for (const step of qa.steps) {
    lines.push(`${step.status === 'passed' ? '✓' : '✗'} ${step.name} · exit ${step.exitCode} · ${duration(step.durationMs)}`)
  }
  lines.push(...plan.notes)
  const failures = qa.steps.filter(step => step.status === 'failed' && step.tail)
  return {
    text: lines.join('\n'),
    // The model reads the failing output so it can act on it; the person sees the summary.
    context: failures.length > 0 ? [`BIG BEAR Auto QA falhou. Saída final dos passos com falha:\n${failures.map(f => `## ${f.name}\n${f.tail}`).join('\n\n')}`] : undefined,
  }
}

async function doctorText(io: Io, probe: boolean): Promise<string> {
  const config = await io.state.config.get()
  const version = await io.session.version()
  const surfaces = await io.session.surfaces()
  const commands = await io.command.list()
  const clashes = commands.filter(c => c.name === COMMAND && c.source !== 'plugin')
  const usage = await io.session.usage()
  const panes = await io.ui.panes()
  const lines = [
    '🐻 BIG BEAR DOCTOR',
    `Claude Code ${version.version} · superfícies: ${surfaces.join(', ') || 'nenhuma (headless)'}`,
    `Projeto: ${projectName(runtime.root)} · histórico: ${runtime.history.length} registros`,
    `Comando /${COMMAND}: ${clashes.length === 0 ? 'ok, sem conflito' : `CONFLITO com ${clashes.map(c => c.source).join(', ')}`}`,
    `Painéis abertos: ${panes.map(p => `${p.id}${p.isPlaced ? '' : ' (aguardando largura)'}`).join(', ') || 'nenhum'}`,
    `Rate limits: ${usage.rateLimits.length > 0 ? usage.rateLimits.map(r => r.kind).join(', ') : 'N/D (sem assinatura ou sem resposta ainda)'}`,
    `Roteamento: ${config.routing.enabled ? 'ON' : 'OFF'} · modo ${config.routing.mode} · módulos ativos ${Object.values(config.modules).filter(Boolean).length}/11`,
    surfaces.includes('vscode') ? 'Aviso: no chat da extensão VS Code o painel não aparece; use /bigbear status.' : '',
  ].filter(Boolean)
  if (probe) {
    lines.push('Sondagem de modelos (1 chamada mínima cada):')
    for (const tier of TIERS) {
      const model = config.routing.models[tier]
      const reply = await io.model.complete({ model, prompt: 'Reply with OK.', maxTokens: 16 })
      lines.push(
        `  ${tier.toUpperCase().padEnd(7)} ${model}: ${reply.isAnswered ? 'disponível' : `indisponível (${reply.reason}${reply.reason === 'api-error' ? ` ${reply.status ?? ''} ${reply.error ?? ''}` : ''})`}`,
      )
    }
  } else {
    lines.push('Para confirmar cada modelo na sua conta: /bigbear doctor probe')
  }
  return lines.join('\n')
}

function bugPrompt(error: string): string {
  return [
    'BIG BEAR · Bug Hunter. Investigue e corrija o erro abaixo seguindo este fluxo, nesta ordem:',
    '1. Identifique os componentes envolvidos.',
    '2. Investigue arquivos e logs relevantes (leitura antes de editar).',
    '3. Liste hipóteses e descarte as que a evidência não sustenta.',
    '4. Implemente a menor correção segura. Não altere comportamento não relacionado nem ajuste regras de jogo para passar em teste.',
    '5. Rode os testes relevantes do projeto e confira regressões.',
    '6. Se a causa for arquitetural, pare e explique antes de refatorar.',
    '7. Termine com: causa raiz, correção, testes executados e resultado.',
    '',
    'Erro relatado:',
    error,
  ].join('\n')
}

/** /bigbear and its subcommands. */
export async function runCommand(io: Io, args: string): Promise<CommandRunResult> {
  {
    const [sub = '', ...rest] = args.trim().split(/\s+/).filter(Boolean)
    const arg = rest.join(' ')
    const lower = sub.toLowerCase()

    switch (lower) {
      case '': {
        const isOpen = (await io.ui.panes()).some(p => p.id === MAIN_PANE)
        if (isOpen) {
          await io.ui.close({ id: MAIN_PANE })
          return { text: '🐻 Central fechada.' }
        }
        const opened = await io.ui.open({ id: MAIN_PANE, title: 'BIG BEAR' })
        return { text: opened.isPlaced ? '🐻 Central aberta.' : `🐻 Central aguardando espaço: ${opened.reason}` }
      }
      case 'help':
      case 'ajuda':
        return { text: HELP }
      case 'status':
        return { text: await statusText(io) }
      case 'mode':
      case 'modo': {
        const mode = rest[0]?.toLowerCase() as BigBearMode | undefined
        if (mode !== 'eco' && mode !== 'balanced' && mode !== 'god') return { text: 'Uso: /bigbear mode eco|balanced|god [--project]' }
        const scope = rest.includes('--project') ? 'project' : 'global'
        await setConfig(io, c => (c.routing.mode = mode), scope)
        return { text: `🐻 ${mode.toUpperCase()} MODE ativado${scope === 'project' ? ' para este projeto' : ''}.` }
      }
      case 'model':
      case 'modelo': {
        const target = rest[0]?.toLowerCase()
        if (target === 'auto') {
          await setConfig(io, c => (c.routing.manualTier = null))
          return { text: '🐻 Modelo automático (Smart Brain decide).' }
        }
        if (!isTier(target)) return { text: 'Uso: /bigbear model auto|haiku|sonnet|opus' }
        await setConfig(io, c => {
          c.routing.manualTier = target
          c.routing.enabled = true
        })
        return { text: `🐻 Modelo fixado: ${target.toUpperCase()}. /bigbear model auto para liberar.` }
      }
      case 'block':
      case 'unblock': {
        const target = rest[0]?.toLowerCase()
        if (!isTier(target)) return { text: `Uso: /bigbear ${lower} haiku|sonnet|opus` }
        const config = await setConfig(io, c => {
          c.routing.blocked = lower === 'block' ? [...new Set([...c.routing.blocked, target])] : c.routing.blocked.filter(t => t !== target)
        })
        return { text: `🐻 Bloqueados: ${config.routing.blocked.join(', ') || 'nenhum'}.` }
      }
      case 'off':
        await setConfig(io, c => (c.routing.enabled = false))
        return { text: '🐻 Roteamento automático DESLIGADO. O Claude Code usa o modelo da sessão normalmente; o painel segue acompanhando.' }
      case 'on':
        await setConfig(io, c => (c.routing.enabled = true))
        return { text: '🐻 Roteamento automático LIGADO.' }
      case 'tasks':
      case 'tarefas': {
        const tasks = await io.state.tasks.get()
        await io.ui.open({ id: MAIN_PANE, title: 'BIG BEAR' })
        const now = await io.clock.now()
        const lines = tasks
          .slice(-15)
          .map(t => `${t.kind === 'subagent' ? '  └ ' : ''}#${t.id} ${t.status.padEnd(10)} ${t.tier.toUpperCase().padEnd(6)} ${duration((t.endedAt ?? now) - t.startedAt).padStart(6)} ${t.title.slice(0, 60)}`)
        return { text: ['🐻 TAREFAS', ...(lines.length > 0 ? lines : ['nenhuma ainda'])].join('\n') }
      }
      case 'usage':
      case 'uso':
        return { text: await usageText(io) }
      case 'models':
      case 'modelos':
        return { text: await modelsText(io) }
      case 'settings':
      case 'config':
        await io.ui.open({ id: SETTINGS_PANE, title: 'BIG BEAR · Settings', focus: true, closeOnEscape: true })
        return { text: '🐻 Configurações abertas.' }
      case 'qa':
        return qaCommand(io, arg)
      case 'history':
      case 'historico':
        return { text: await historyText() }
      case 'summary':
      case 'resumo': {
        const tasks = await io.state.tasks.get()
        const decisions = await loadDecisions(io, runtime.root)
        const done = tasks.filter(t => t.kind === 'turn' && t.endedAt !== undefined).slice(-10)
        return {
          text: [
            `🐻 RESUMO TÉCNICO · ${projectName(runtime.root)}`,
            'Tarefas recentes (estado verificado por evento):',
            ...done.map(t => `  #${t.id} ${t.status} · ${t.tier.toUpperCase()} · ${t.category} · ${t.title.slice(0, 70)}`),
            'Decisões registradas:',
            ...(decisions.length > 0 ? decisions.slice(-10).map(d => `  • ${d.text}`) : ['  nenhuma (/bigbear decision <texto>)']),
          ].join('\n'),
        }
      }
      case 'decision':
      case 'decisao': {
        if (arg.length === 0) return { text: 'Uso: /bigbear decision <texto da decisão>' }
        const list = await addDecision(io, runtime.root, arg, await io.clock.now())
        return { text: `🐻 Decisão registrada (${list.length} no projeto).` }
      }
      case 'showcase': {
        if (rest[0] === 'export') {
          const [config, tasks, metrics] = await Promise.all([io.state.config.get(), io.state.tasks.get(), io.state.metrics.get()])
          const text = showcaseText(config, tasks, metrics, await io.clock.now())
          const copied = await io.ui.copy({ text })
          return { text: `${text}\n\n${copied.isCopied ? '(copiado para a área de transferência, sem caminhos nem segredos)' : '(sem área de transferência nesta superfície: copie o texto acima)'}` }
        }
        await io.ui.open({ id: SHOWCASE_PANE, title: 'BIG BEAR · Showcase', focus: true, closeOnEscape: true })
        return { text: '🐻 Showcase aberto. /bigbear showcase export gera o resumo para compartilhar.' }
      }
      case 'doctor':
        return { text: await doctorText(io, rest[0] === 'probe') }
      case 'bug': {
        const config = await io.state.config.get()
        if (!config.modules.bugHunter) return { text: 'Bug Hunter está desligado (Settings → Módulos).' }
        if (arg.length === 0) return { text: 'Uso: /bigbear bug <mensagem de erro ou descrição>' }
        const tier = config.routing.blocked.includes('sonnet') ? 'opus' : 'sonnet'
        runtime.forced = {
          tier,
          source: 'bughunter',
          reasons: [`Bug Hunter: investigação em ${tier.toUpperCase()}; escalona para OPUS se a causa for arquitetural`],
        }
        await io.ui.open({ id: MAIN_PANE, title: 'BIG BEAR' })
        void io.prompt.submit({ text: bugPrompt(redactSecrets(arg)) })
        return { text: '🐻 Bug Hunter iniciado.' }
      }
      case 'price':
      case 'preco': {
        const [tier, ...values] = rest
        const numbers = values.map(Number)
        if (!isTier(tier) || numbers.length !== 4 || numbers.some(n => !Number.isFinite(n) || n < 0)) {
          return { text: 'Uso: /bigbear price <haiku|sonnet|opus> <input> <output> <cacheRead> <cacheWrite> (USD por milhão de tokens)' }
        }
        const today = new Date(await io.clock.now()).toISOString().slice(0, 10)
        await setConfig(io, c => {
          c.pricing.table[tier] = { input: numbers[0]!, output: numbers[1]!, cacheRead: numbers[2]!, cacheWrite: numbers[3]! }
          c.pricing.source = `editado pelo usuário em ${today}`
          c.pricing.updatedAt = today
        })
        return { text: `🐻 Preço de ${tier.toUpperCase()} atualizado.` }
      }
      case 'set-model': {
        const [tier, id] = rest
        if (!isTier(tier) || id === undefined || !/^[\w.:@/-]{3,100}$/.test(id)) {
          return { text: 'Uso: /bigbear set-model <haiku|sonnet|opus> <id do modelo>. Confirme depois com /bigbear doctor probe.' }
        }
        await setConfig(io, c => (c.routing.models[tier] = id))
        return { text: `🐻 ${tier.toUpperCase()} agora usa ${id}. Rode /bigbear doctor probe para confirmar que ele existe na sua conta.` }
      }
      case 'alerts':
      case 'alertas': {
        const values = rest.map(Number)
        if (values.length !== 3 || values.some(v => !Number.isFinite(v) || v <= 0 || v > 100) || !(values[0]! < values[1]! && values[1]! < values[2]!)) {
          return { text: 'Uso: /bigbear alerts <aviso> <elevado> <crítico>, ex.: /bigbear alerts 70 85 95' }
        }
        await setConfig(io, c => {
          c.usage.warn = values[0]!
          c.usage.high = values[1]!
          c.usage.critical = values[2]!
        })
        return { text: `🐻 Alertas de uso: ${values.join('% / ')}%.` }
      }
      case 'qa-profile': {
        if (arg.length === 0) return { text: 'Uso: /bigbear qa-profile <auto|quick|standard|full|ragnarok:...>' }
        await setConfig(io, c => (c.qa.profile = arg))
        return { text: `🐻 Perfil padrão de QA: ${arg}.` }
      }
      case 'project':
      case 'projeto':
        if (rest[0] === 'reset') {
          await clearProjectPolicy(io)
          return { text: '🐻 Política do projeto removida: vale a configuração global.' }
        }
        return { text: 'Uso: /bigbear mode <modo> --project, ou /bigbear project reset' }
      case 'reset':
        await resetSettings(io)
        return { text: '🐻 Configurações restauradas para o padrão.' }
      case 'git': {
        const git = await refreshGit(io, runtime.root)
        return { text: git.isRepo ? `⎇ ${git.branch} · ${pendingChanges(git)} alterações · ${git.lastCommit ?? ''}` : 'Não é um repositório git.' }
      }
      default:
        return { text: `Subcomando desconhecido: ${redactPaths(sub)}\n\n${HELP}` }
    }
  }
}

