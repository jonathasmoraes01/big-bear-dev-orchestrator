import type { BigBearCategory } from '../../../types'

/**
 * Local, zero-cost classification of a prompt. Rules only: no model call.
 * Portuguese and English keywords, since the reference project writes in
 * Portuguese.
 */
export type Classification = {
  category: BigBearCategory
  /** 1 (trivial) to 5 (very complex). */
  complexity: number
  /** 1 (harmless) to 5 (production or data at stake). */
  risk: number
  signals: string[]
  files: string[]
  /** 0..1: how sure the rules are. Low values may ask the AI classifier. */
  confidence: number
}

type Rule = { category: BigBearCategory; weight: number; pattern: RegExp; label: string }

const RULES: readonly Rule[] = [
  { category: 'critical', weight: 5, label: 'produção/dados', pattern: /\b(produ[cç][aã]o|production|prod\b|hotfix|incidente|incident|outage|fora do ar|perda de dados|data loss|vazamento|security breach|cve-\d+|vulnerabilidade cr[ií]tica)/i },
  { category: 'architecture', weight: 4, label: 'arquitetura', pattern: /\b(arquitetura|architecture|architect|design (do|the) system|system design|reestrutur|reescrev|rewrite|migra[cç][aã]o|migrate|migration|monorepo|microservi|distribu[ií]d|distributed|escalabilidade|scalab|trade-?offs?|plano t[eé]cnico|technical plan|rfc\b|adr\b)/i },
  { category: 'audit', weight: 4, label: 'auditoria/revisão', pattern: /\b(auditori|audit|revis[aã]o (de|do) c[oó]digo|code review|review (this|the) (pr|diff|change)|security review|an[aá]lise de seguran[cç]a|race condition|condi[cç][aã]o de corrida|deadlock|memory leak|vazamento de mem[oó]ria)/i },
  { category: 'refactor', weight: 3, label: 'refatoração', pattern: /\b(refator|refactor|extrair|extract|consolidar|consolidate|limpar o c[oó]digo|clean ?up|renomear em|rename across)/i },
  { category: 'bugfix', weight: 3, label: 'bug', pattern: /\b(bug|erro|error|exce[cç][aã]o|exception|crash|quebr|broken|falh|fail|n[aã]o funciona|doesn'?t work|not working|stack ?trace|regress|conserta|corrig|fix)/i },
  { category: 'feature', weight: 3, label: 'implementação', pattern: /\b(implement|criar|crie|create|adicionar|adicione|add\b|construir|build|desenvolv|develop|nova funcionalidade|new feature|endpoint|api\b|componente|component|tela|screen|integra)/i },
  { category: 'test', weight: 2, label: 'testes', pattern: /\b(testes?|tests?|spec\b|cobertura|coverage|vitest|jest|pytest|unit[aá]rio)/i },
  { category: 'docs', weight: 1, label: 'documentação', pattern: /\b(readme|documenta|docs?\b|coment[aá]rio|comment|changelog|typo|ortografia)/i },
  { category: 'lookup', weight: 1, label: 'busca/leitura', pattern: /\b(onde (fica|est[aá])|where is|encontr|find|procur|search|grep|localiz|lista(r)? (os|as|the)|list (the|all)|leia|read|mostre|show me|o que (faz|[eé])|what does|explique|explain|log\b|logs\b)/i },
]

const CONTINUE = /^\s*(ok|okay|sim|yes|y|s|continue|continua|prossiga|go ahead|segue|pode seguir|faz|fa[cç]a|isso|perfeito|beleza|valeu|thanks|obrigad[oa])[\s.!]*$/i
const TRIVIAL = /^\s*(oi|ol[aá]|hi|hello|hey|bom dia|boa tarde|boa noite)[\s.!?]*$/i

const HARD = /\b(complex|dif[ií]cil|hard|cr[ií]tic|critical|profund|deep|todo o (sistema|projeto|reposit[oó]rio)|whole (system|codebase|repo)|v[aá]rios m[oó]dulos|multiple modules|end-to-end|ponta a ponta|concorr[eê]ncia|concurrency|performance|desempenho|otimiza)/i
// Word stems: no closing \b, so "pequeno", "pequena", "rápido" all match.
const SMALL = /\b(pequen|small|simples|simple|r[aá]pid|quick|s[oó] (um|uma)\b|just (a|one)\b|uma linha|one line|trivial|renomear|rename)/i
const RISKY = /\b(force|--force|drop |delete|apagar|deletar|remover tudo|rm -rf|reset --hard|banco de dados|database|migra|deploy|billing|pagamento|payment|auth|senha|password|token|credencia|secret)/i

const FILE = /(?:^|[\s`'"(])((?:[\w.-]+\/)*[\w.-]+\.(?:tsx?|jsx?|mjs|cjs|py|go|rs|java|kt|rb|php|cs|cpp|c|h|json|ya?ml|toml|md|sql|css|scss|html|vue|svelte|lua|txt))(?=$|[\s`'"),:])/g

export function extractFiles(text: string): string[] {
  const seen = new Set<string>()
  for (const match of text.matchAll(FILE)) {
    if (match[1] !== undefined) seen.add(match[1])
    if (seen.size >= 12) break
  }
  return [...seen]
}

const ORDER: readonly BigBearCategory[] = [
  'critical',
  'architecture',
  'audit',
  'refactor',
  'bugfix',
  'feature',
  'test',
  'docs',
  'lookup',
]

const BASE_COMPLEXITY: Record<BigBearCategory, number> = {
  continue: 2,
  trivial: 1,
  lookup: 1,
  docs: 1,
  test: 2,
  bugfix: 3,
  feature: 3,
  refactor: 3,
  architecture: 4,
  audit: 4,
  critical: 4,
}

export function classify(text: string): Classification {
  const trimmed = text.trim()
  const files = extractFiles(trimmed)

  if (trimmed.length === 0 || CONTINUE.test(trimmed)) {
    return { category: 'continue', complexity: 2, risk: 1, signals: ['continuação'], files, confidence: 0.9 }
  }
  if (TRIVIAL.test(trimmed)) {
    return { category: 'trivial', complexity: 1, risk: 1, signals: ['saudação'], files, confidence: 0.95 }
  }

  const hits = new Map<BigBearCategory, number>()
  const signals: string[] = []
  for (const rule of RULES) {
    const found = trimmed.match(new RegExp(rule.pattern.source, 'gi'))
    if (found !== null) {
      hits.set(rule.category, (hits.get(rule.category) ?? 0) + rule.weight * Math.min(found.length, 3))
      signals.push(rule.label)
    }
  }

  let category: BigBearCategory = 'feature'
  let best = -1
  for (const candidate of ORDER) {
    const score = hits.get(candidate) ?? 0
    // Ties keep the earlier, heavier category in ORDER.
    if (score > best) {
      best = score
      category = candidate
    }
  }
  if (best <= 0) {
    category = trimmed.length < 80 ? 'lookup' : 'feature'
    signals.push('sem palavra-chave')
  }

  let complexity = BASE_COMPLEXITY[category]
  if (HARD.test(trimmed)) {
    complexity += 1
    signals.push('sinal de complexidade')
  }
  if (SMALL.test(trimmed)) {
    complexity -= 1
    signals.push('escopo pequeno')
  }
  if (files.length >= 4) {
    complexity += 1
    signals.push(`${files.length} arquivos citados`)
  }
  if (trimmed.length > 1500) {
    complexity += 1
    signals.push('pedido longo')
  }
  complexity = Math.max(1, Math.min(5, complexity))

  let risk = category === 'critical' ? 5 : category === 'architecture' || category === 'audit' ? 3 : 1
  if (RISKY.test(trimmed)) {
    risk += 2
    signals.push('operação sensível')
  }
  risk = Math.max(1, Math.min(5, risk))

  const total = [...hits.values()].reduce((sum, value) => sum + value, 0)
  const confidence = best <= 0 ? 0.3 : Math.min(0.95, 0.4 + (best / Math.max(total, 1)) * 0.5)

  return { category, complexity, risk, signals: [...new Set(signals)], files, confidence }
}
