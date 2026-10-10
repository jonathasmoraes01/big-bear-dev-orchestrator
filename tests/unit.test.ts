import { describe, expect, test } from 'claude-code/testing'

import { DEFAULT_CONFIG, loadConfig } from '../hooks/src/config/defaults'
import { classify } from '../hooks/src/core/classifier'
import { notificationSummary, titleFor } from '../hooks/src/core/title'
import { allowedTier, decide, shouldEscalate, subagentTier, tierOfModel } from '../hooks/src/core/router'
import { activityForTasks, activityForTool, finish, newTask, overall } from '../hooks/src/core/tasks'
import { parseStatus } from '../hooks/src/modules/git'
import { analyzeCommand, findSecrets, isPushFromProtected, matchCritical, redactPaths, redactSecrets, worst } from '../hooks/src/modules/guardian'
import { planQa } from '../hooks/src/modules/qa'
import type { ProjectFacts } from '../hooks/src/modules/qa'
import { estimateMs, failureStats, summarize } from '../hooks/src/services/analytics'
import type { HistoryRecord } from '../hooks/src/services/analytics'
import { addStep, costOf, distribution, emptyMetrics, priceStep, savings } from '../hooks/src/services/pricing'
import type { BigBearConfig } from '../types'

const ctx = { previous: null, now: 0, contextTokens: null, history: {} }
const cfg = (edit: (c: BigBearConfig) => void = () => {}): BigBearConfig => {
  const c = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as BigBearConfig
  edit(c)
  return c
}

describe('Smart Brain: classification', () => {
  test('lookups and simple reads are lookup/docs', () => {
    expect(classify('onde fica a função calcularDano?').category).toBe('lookup')
    expect(classify('atualize o README com o novo comando').category).toBe('docs')
  })
  test('bugs, features and architecture are told apart', () => {
    expect(classify('corrigir o erro de crash ao equipar arco').category).toBe('bugfix')
    expect(classify('implementar endpoint de inventário na API').category).toBe('feature')
    expect(classify('planejar a arquitetura de migração para microserviços distribuídos').category).toBe('architecture')
  })
  test('short confirmations continue the previous work', () => {
    expect(classify('ok').category).toBe('continue')
    expect(classify('pode seguir').category).toBe('continue')
  })
  test('file paths are extracted', () => {
    expect(classify('veja game/sessao.ts e combat/dano.ts').files).toEqual(['game/sessao.ts', 'combat/dano.ts'])
  })
  test('risky words raise the risk', () => {
    expect(classify('rodar drop table em produção').risk).toBeGreaterThanOrEqual(5)
  })
})

describe('Smart Brain: routing by mode', () => {
  test('BALANCED: haiku reads, sonnet builds, opus designs', () => {
    expect(decide(cfg(), classify('onde fica a classe Inventario?'), ctx).tier).toBe('haiku')
    expect(decide(cfg(), classify('implementar componente de HUD de party'), ctx).tier).toBe('sonnet')
    expect(decide(cfg(), classify('auditoria de race condition no sistema distribuído'), ctx).tier).toBe('opus')
  })
  test('ECO keeps opus for critical work only', () => {
    const eco = cfg(c => (c.routing.mode = 'eco'))
    expect(decide(eco, classify('revisão de código do módulo de loja'), ctx).tier).not.toBe('opus')
    expect(decide(eco, classify('consertar bug pequeno no menu'), ctx).tier).toBe('haiku')
  })
  test('GOD is not opus for everything', () => {
    const god = cfg(c => (c.routing.mode = 'god'))
    expect(decide(god, classify('oi'), ctx).tier).toBe('haiku')
    expect(decide(god, classify('refatorar o motor de combate inteiro'), ctx).tier).toBe('opus')
  })
  test('manual tier wins, blocked tiers are skipped', () => {
    expect(decide(cfg(c => (c.routing.manualTier = 'opus')), classify('onde fica X?'), ctx).tier).toBe('opus')
    const blocked = cfg(c => (c.routing.blocked = ['opus']))
    expect(decide(blocked, classify('arquitetura do sistema distribuído'), ctx).tier).toBe('sonnet')
    expect(allowedTier('haiku', ['haiku'])).toBe('sonnet')
    expect(allowedTier('opus', ['haiku', 'sonnet', 'opus'])).toBeNull()
  })
  test('the model id comes from configuration, never invented', () => {
    const c = cfg(x => (x.routing.models.sonnet = 'my-sonnet'))
    expect(decide(c, classify('implementar tela de loja'), ctx).model).toBe('my-sonnet')
  })
  test('continuation keeps the previous tier; a warm large cache avoids a one-step downgrade', () => {
    const previous = { tier: 'opus' as const, endedAt: 1000 }
    expect(decide(cfg(), classify('ok'), { ...ctx, previous, now: 2000 }).tier).toBe('opus')
    const sticky = decide(cfg(), classify('implementar botão de venda'), { ...ctx, previous, now: 2000, contextTokens: 120_000 })
    expect(sticky.tier).toBe('opus')
    expect(sticky.source).toBe('sticky')
    const cold = decide(cfg(), classify('implementar botão de venda'), { ...ctx, previous, now: 10 * 60_000, contextTokens: 120_000 })
    expect(cold.tier).toBe('sonnet')
  })
  test('history bumps a tier that keeps failing', () => {
    const d = decide(cfg(), classify('corrigir bug no inventário'), { ...ctx, history: { 'bugfix:sonnet': { runs: 10, failures: 6 } } })
    expect(d.tier).toBe('opus')
    expect(d.source).toBe('history')
  })
  test('escalation is bounded', () => {
    const c = cfg()
    expect(shouldEscalate(c, { tier: 'haiku', escalations: 0, toolErrors: 3 })).toBe('sonnet')
    expect(shouldEscalate(c, { tier: 'haiku', escalations: 0, toolErrors: 2 })).toBeNull()
    expect(shouldEscalate(c, { tier: 'sonnet', escalations: 1, toolErrors: 99 })).toBeNull()
    expect(shouldEscalate(c, { tier: 'opus', escalations: 0, toolErrors: 99 })).toBeNull()
  })
  test('subagents: Explore goes to haiku, Plan to opus', () => {
    expect(subagentTier(cfg(), 'Explore', classify('find usages'))).toBe('haiku')
    expect(subagentTier(cfg(), 'Plan', classify('plan the change'))).toBe('opus')
    expect(tierOfModel('claude-sonnet-5-5')).toBe('sonnet')
    expect(tierOfModel('gpt-x')).toBeNull()
  })
})

describe('Token Intelligence', () => {
  const usage = { input_tokens: 1_000_000, output_tokens: 100_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-haiku-5-5' }
  test('API-equivalent cost uses the configured prices', () => {
    expect(costOf({ input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0 }, DEFAULT_CONFIG.pricing.table.sonnet)).toBe(12)
    expect(Math.abs(priceStep(cfg(), usage).costUsd - 0.15) < 1e-9).toBe(true)
  })
  test('savings compare with the baseline and need data', () => {
    expect(savings(emptyMetrics()).isAvailable).toBe(false)
    const m = addStep(emptyMetrics(), usage.model, priceStep(cfg(), usage))
    const s = savings(m)
    expect(s.isAvailable).toBe(true)
    if (s.isAvailable) {
      expect(s.percent).toBeGreaterThan(90)
      // Tokens saved = the session's tokens times the saved share of the baseline cost.
      expect(s.tokensSaved).toBe(Math.round((1_100_000 * s.percent) / 100))
    }
  })
  test('distribution sums to 100 and is null with no data', () => {
    expect(distribution(emptyMetrics())).toBeNull()
    let m = addStep(emptyMetrics(), 'claude-haiku-5-5', priceStep(cfg(), usage))
    m = addStep(m, 'claude-opus-5-5', priceStep(cfg(), { ...usage, model: 'claude-opus-5-5' }))
    const d = distribution(m)!
    expect(d.haiku + d.sonnet + d.opus).toBe(100)
    expect(d.haiku).toBe(50)
  })
  test('an unknown model is counted but never priced', () => {
    const m = addStep(emptyMetrics(), 'other-model', priceStep(cfg(), { ...usage, model: 'other-model' }))
    expect(m.other['other-model']?.steps).toBe(1)
    expect(m.baselineUsd).toBe(0)
  })
})

describe('Code Guardian and Git Guardian', () => {
  test('dangerous commands are caught', () => {
    expect(worst(analyzeCommand('git push --force origin feature'))).toBe('ask')
    expect(worst(analyzeCommand('git push -f'))).toBe('ask')
    expect(worst(analyzeCommand('git branch -D old'))).toBe('ask')
    expect(worst(analyzeCommand('git reset --hard HEAD~3'))).toBe('ask')
    expect(worst(analyzeCommand('psql -c "DROP TABLE users;"'))).toBe('ask')
    expect(worst(analyzeCommand('rm -rf /'))).toBe('block')
    expect(worst(analyzeCommand('Remove-Item -Recurse -Force .\\dist'))).toBe('ask')
  })
  test('ordinary commands pass', () => {
    expect(analyzeCommand('git status')).toEqual([])
    expect(analyzeCommand('npm test')).toEqual([])
    expect(analyzeCommand('git push origin feature/x')).toEqual([])
  })
  test('pushes to protected branches are caught', () => {
    expect(analyzeCommand('git push origin main', ['main']).some(f => f.rule === 'protected-branch-push')).toBe(true)
    expect(isPushFromProtected('git push', 'main', ['main'])).toBe(true)
    expect(isPushFromProtected('git push origin feature', 'main', ['main'])).toBe(false)
  })
  test('secrets are found and redacted', () => {
    const key = 'sk-ant-api03-' + 'a'.repeat(40)
    expect(findSecrets(`const k = "${key}"`)).toContain('anthropic-key')
    expect(redactSecrets(`token ${key}`)).toBe('token [REDACTED]')
    expect(redactPaths('em C:\\Users\\Bear\\proj\\a.ts')).toBe('em <path>')
  })
  test('critical paths match globs', () => {
    expect(matchCritical('C:\\repo\\.env', ['.env'])).toBe('.env')
    expect(matchCritical('db/migrations/001.sql', ['**/migrations/**'])).toBe('**/migrations/**')
    expect(matchCritical('src/app.ts', ['.env'])).toBeNull()
  })
  test('git status is parsed', () => {
    const git = parseStatus('## main...origin/main [ahead 2, behind 1]\nM  a.ts\n M b.ts\n?? c.ts\nUU d.ts\n', 0)
    expect(git.branch).toBe('main')
    expect(git.ahead).toBe(2)
    expect(git.behind).toBe(1)
    expect(git.staged).toBe(1)
    expect(git.modified).toBe(1)
    expect(git.untracked).toBe(1)
    expect(git.conflicts).toBe(1)
  })
})

describe('Auto QA', () => {
  const base: ProjectFacts = { packageName: 'app', scripts: { typecheck: 'tsc --noEmit', lint: 'eslint .', test: 'vitest run' }, entries: ['package.json'], isWindows: false, hasLockfile: 'npm' }
  test('detects the project scripts', () => {
    const plan = planQa(base, 'standard')
    expect(plan.steps.map(s => s.name)).toEqual(['typecheck (typecheck)', 'lint (lint)', 'test (test)'])
    expect(plan.steps[0]?.argv).toEqual(['npm', 'run', '--silent', 'typecheck'])
  })
  test('Windows runs through cmd for the npm shim', () => {
    expect(planQa({ ...base, isWindows: true }, 'quick').steps[0]?.argv.slice(0, 4)).toEqual(['cmd.exe', '/d', '/s', '/c'])
  })
  test('the Ragnarok profile uses the project vitest suite by category', () => {
    const rag: ProjectFacts = { packageName: 'rag-idle-2', scripts: { build: 'tsc --noEmit', test: 'vitest run' }, entries: ['combat', 'game'], isWindows: false, hasLockfile: 'npm' }
    const plan = planQa(rag, 'ragnarok:combate')
    expect(plan.steps.map(s => s.name)).toEqual(['Tipos (tsc --noEmit)', 'COMBATE (vitest)'])
    expect(plan.steps[1]?.argv).toContain('combat/')
    const front = planQa(rag, 'ragnarok:frontend')
    expect(front.notes.join(' ')).toContain('sem suíte automatizada')
  })
})

describe('Tasks and analytics', () => {
  const decision = decide(cfg(), classify('implementar tela'), ctx)
  test('a task completes only through finish, with every milestone', () => {
    const task = newTask({ id: '1', now: 0, title: 't', decision, routed: true, etaMs: null })
    expect(task.status).toBe('ANALYZING')
    const done = finish(task, 'COMPLETED', 5000)
    expect(done.milestones).toBe(5)
    expect(overall([done], 6000).percent).toBe(100)
    // Worked time sums each task; the running age is only for open tasks.
    const second = newTask({ id: '2', now: 8000, title: 't', decision, routed: true, etaMs: 10_000 })
    const both = overall([done, second], 12_000)
    expect(both.workedMs).toBe(5000 + 4000)
    expect(both.runningMs).toBe(4000)
    expect(both.etaMs).toBe(6000)
    expect(overall([done], 12_000).runningMs).toBeNull()
    expect(overall([task], 1000).etaMs).toBeNull()
  })
  test('the avatar follows the tools', () => {
    expect(activityForTool('Grep')).toBe('research')
    expect(activityForTool('Edit')).toBe('work')
    expect(activityForTool('Bash')).toBe('work')
    expect(activityForTool('mcp__x__search_files')).toBe('research')
    expect(activityForTasks([], 'work')).toBe('idle')
  })
  test('history gives estimates only with enough samples', () => {
    const rec = (ms: number, status: HistoryRecord['status'] = 'COMPLETED'): HistoryRecord => ({
      at: 0, project: 'p', category: 'feature', tier: 'sonnet', status, durationMs: ms, tokens: 10, costUsd: 0.1, escalations: 0, steps: 1,
    })
    expect(estimateMs([rec(10), rec(20)], 'feature', 'sonnet')).toBeNull()
    expect(estimateMs([rec(10), rec(20), rec(30)], 'feature', 'sonnet')).toBe(20)
    // A new kind of task borrows from the same model, then from everything, once there are enough samples.
    const other = (ms: number): HistoryRecord => ({ ...rec(ms), category: 'docs' })
    expect(estimateMs([other(10), other(20), other(30), other(40)], 'feature', 'sonnet')).toBe(30)
    expect(estimateMs([other(10), other(20), other(30)], 'feature', 'sonnet')).toBeNull()
    expect(failureStats([rec(1, 'FAILED'), rec(1)])['feature:sonnet']).toEqual({ runs: 2, failures: 1 })
    expect(summarize([rec(10), rec(30, 'FAILED')]).byCategory[0]?.successRate).toBe(0.5)
  })
  test('stored configuration is merged safely', () => {
    const c = loadConfig({ routing: { mode: 'god', manualTier: 'gpt', blocked: ['opus', 'x'] }, ui: { refreshMs: 1 } })
    expect(c.routing.mode).toBe('god')
    expect(c.routing.manualTier).toBeNull()
    expect(c.routing.blocked).toEqual(['opus'])
    expect(c.ui.refreshMs).toBe(250)
    expect(loadConfig('garbage').routing.mode).toBe('balanced')
  })
})

describe('Task titles', () => {
  test('a background-task notice becomes a readable title, never raw markup', () => {
    const raw = '<task-notification> <task-id>b7oyrpny</task-id> <status>completed</status> <summary>Servidor reiniciado</summary> </task-notification>'
    expect(notificationSummary(raw)).toBe('Tarefa em segundo plano · Servidor reiniciado')
    expect(titleFor(raw, 'continue')).toBe('Tarefa em segundo plano · Servidor reiniciado')
    const noSummary = '<task-notification><task-id>b1f13bfc</task-id><status>failed</status></task-notification>'
    expect(titleFor(noSummary, 'continue')).toBe('Tarefa em segundo plano · status failed')
    expect(titleFor(noSummary, 'continue')).not.toContain('<')
  })
  test('short replies and tag-only prompts still get a titled kind', () => {
    expect(titleFor('Sim', 'continue')).toBe('Continuação · Sim')
    expect(titleFor('<system-reminder>ignore</system-reminder>', 'continue')).toBe('Continuação')
    expect(titleFor('', 'lookup')).toBe('Busca')
  })
  test('a normal request keeps its first sentence behind its kind, clipped', () => {
    expect(titleFor('Corrigir o crash ao equipar arco. Depois rodar os testes.', 'bugfix')).toBe('Correção · Corrigir o crash ao equipar arco.')
    const long = titleFor('x'.repeat(300), 'feature')
    expect(long.startsWith('Implementação · ')).toBe(true)
    expect(long.length).toBeLessThanOrEqual(90)
    expect(titleFor('veja <ide_selection>texto interno</ide_selection> o arquivo game/sessao.ts', 'lookup')).toBe('Busca · veja o arquivo game/sessao.ts')
  })
  test('a notice is classified as a continuation, so it keeps the running model', () => {
    const raw = '<task-notification><status>failed</status><summary>build failed with errors</summary></task-notification>'
    expect(classify(notificationSummary(raw) !== null ? '' : raw).category).toBe('continue')
  })
})
