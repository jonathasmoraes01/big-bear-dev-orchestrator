import type { BigBearQaStep } from '../../../types'
import { RAGNAROK_CATEGORIES, isRagnarok } from '../config/project-profiles/ragnarok'

export type ProjectFacts = {
  packageName: string | null
  scripts: Record<string, string>
  entries: string[]
  isWindows: boolean
  hasLockfile: 'npm' | 'pnpm' | 'yarn' | 'bun' | null
}

export type QaPlan = { profile: string; steps: BigBearQaStep[]; notes: string[] }

function runner(facts: ProjectFacts): string {
  if (facts.hasLockfile === 'pnpm') return 'pnpm'
  if (facts.hasLockfile === 'yarn') return 'yarn'
  if (facts.hasLockfile === 'bun') return 'bun'
  return 'npm'
}

/** argv for one package-manager call; Windows needs cmd for the .cmd shims. */
export function shellArgv(facts: ProjectFacts, args: string[]): string[] {
  return facts.isWindows ? ['cmd.exe', '/d', '/s', '/c', ...args] : args
}

function script(facts: ProjectFacts, name: string): string[] {
  const pm = runner(facts)
  return shellArgv(facts, pm === 'npm' ? ['npm', 'run', '--silent', name] : [pm, 'run', name])
}

function step(name: string, argv: string[]): BigBearQaStep {
  return { name, argv, status: 'pending' }
}

/** The first script whose name is in `names`, or whose body runs `tool`. */
function findScript(scripts: Record<string, string>, names: readonly string[], tool?: RegExp): string | null {
  for (const name of names) if (scripts[name] !== undefined) return name
  if (tool !== undefined) {
    for (const [name, body] of Object.entries(scripts)) {
      if (tool.test(body) && !/watch|--watch|serve|dev/.test(`${name} ${body}`)) return name
    }
  }
  return null
}

export function availableProfiles(facts: ProjectFacts): string[] {
  const base = ['quick', 'standard', 'full']
  if (isRagnarok(facts.packageName, facts.entries)) {
    return [...base, ...RAGNAROK_CATEGORIES.map(c => `ragnarok:${c.id}`), 'ragnarok:tudo']
  }
  return base
}

/** What the project offers as checks: a fact list for /bigbear qa. */
export function detectChecks(facts: ProjectFacts): Record<'typecheck' | 'lint' | 'test' | 'build', string | null> {
  const typecheck = findScript(facts.scripts, ['typecheck', 'type-check', 'tsc', 'check:types', 'types'], /\btsc\b[^&|]*--noEmit/)
  return {
    typecheck,
    lint: findScript(facts.scripts, ['lint', 'eslint', 'lint:check'], /\b(eslint|biome\s+(lint|check)|oxlint)\b/),
    test: findScript(facts.scripts, ['test', 'test:unit', 'tests'], /\b(vitest\s+run|jest|mocha|ava|node --test|pytest)\b/),
    build: (() => {
      const name = findScript(facts.scripts, ['build'])
      return name !== null && name !== typecheck ? name : null
    })(),
  }
}

export function planQa(facts: ProjectFacts, requested: string): QaPlan {
  const notes: string[] = []
  const ragnarok = isRagnarok(facts.packageName, facts.entries)
  let profile = requested
  if (profile === 'auto') profile = ragnarok ? 'ragnarok:tudo' : 'standard'

  if (profile.startsWith('ragnarok:')) {
    if (!ragnarok) return { profile, steps: [], notes: ['Perfil Ragnarok indisponível neste projeto.'] }
    const id = profile.slice('ragnarok:'.length)
    const steps: BigBearQaStep[] = []
    if (facts.scripts['build'] !== undefined) steps.push(step('Tipos (tsc --noEmit)', script(facts, 'build')))
    const categories = id === 'tudo' ? RAGNAROK_CATEGORIES : RAGNAROK_CATEGORIES.filter(c => c.id === id)
    if (categories.length === 0) return { profile, steps: [], notes: [`Categoria desconhecida: ${id}`] }
    for (const category of categories) {
      if (category.filters.length === 0) {
        notes.push(`${category.label}: sem suíte automatizada no repositório; checar à mão: ${category.manual.join(', ')}.`)
        continue
      }
      steps.push(step(`${category.label} (vitest)`, shellArgv(facts, ['npx', 'vitest', 'run', ...category.filters])))
      if (category.manual.length > 0) notes.push(`${category.label}: checar à mão: ${category.manual.join(', ')}.`)
    }
    return { profile, steps, notes }
  }

  const checks = detectChecks(facts)
  const wanted: (keyof typeof checks)[] =
    profile === 'quick' ? ['typecheck', 'lint'] : profile === 'full' ? ['typecheck', 'lint', 'test', 'build'] : ['typecheck', 'lint', 'test']
  const steps: BigBearQaStep[] = []
  for (const kind of wanted) {
    const name = checks[kind]
    if (name === null) {
      notes.push(`${kind}: nenhum script encontrado no package.json.`)
      continue
    }
    steps.push(step(`${kind} (${name})`, script(facts, name)))
  }
  if (Object.keys(facts.scripts).length === 0) notes.push('Sem package.json com scripts: nada a executar.')
  return { profile, steps, notes }
}

/** The last lines of a command's output, secrets left for the caller to redact. */
export function tail(text: string, lines = 12): string {
  const all = text.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/).filter(line => line.trim().length > 0)
  return all.slice(-lines).join('\n')
}
