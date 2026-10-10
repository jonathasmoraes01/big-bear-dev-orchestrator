/**
 * Code Guardian and Git Guardian rules: pure functions over a command or an
 * edit. The hooks decide what to do with a finding; nothing here runs.
 */

export type Severity = 'block' | 'ask' | 'warn'

export type Finding = { severity: Severity; rule: string; text: string }

type CommandRule = { severity: Severity; rule: string; text: string; pattern: RegExp }

const COMMAND_RULES: readonly CommandRule[] = [
  { severity: 'ask', rule: 'git-force-push', text: 'push forçado reescreve o histórico remoto', pattern: /\bgit\b[^|;&]*\bpush\b[^|;&]*(\s--force\b|\s-f\b|\s--force-with-lease\b|\s\+\S+)/i },
  { severity: 'ask', rule: 'git-delete-branch', text: 'exclusão de branch', pattern: /\bgit\b[^|;&]*\b(branch\s+(-D|-d|--delete)\b|push\b[^|;&]*(\s--delete\b|\s:\S+))/i },
  { severity: 'ask', rule: 'git-reset-hard', text: 'reset --hard descarta alterações locais', pattern: /\bgit\b[^|;&]*\breset\b[^|;&]*--hard\b/i },
  { severity: 'ask', rule: 'git-clean', text: 'git clean apaga arquivos não versionados', pattern: /\bgit\b[^|;&]*\bclean\b[^|;&]*-[a-z]*f/i },
  { severity: 'ask', rule: 'git-discard', text: 'descarta alterações do working tree', pattern: /\bgit\b[^|;&]*\b(checkout|restore)\b[^|;&]*\s(--\s+)?\.(\s|$)/i },
  { severity: 'ask', rule: 'git-rewrite', text: 'reescrita de histórico', pattern: /\bgit\b[^|;&]*\b(filter-branch|filter-repo|rebase\b[^|;&]*(-i|--interactive|--root))/i },
  { severity: 'ask', rule: 'rm-rf', text: 'remoção recursiva forçada', pattern: /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|--recursive\s+--force|--force\s+--recursive)\b/i },
  { severity: 'ask', rule: 'ps-remove-recurse', text: 'remoção recursiva forçada', pattern: /\bRemove-Item\b(?=[^|;]*-Recurse)(?=[^|;]*-Force)/i },
  { severity: 'ask', rule: 'win-rmdir', text: 'remoção recursiva de diretório', pattern: /\b(rmdir|rd)\s+\/s\b/i },
  { severity: 'ask', rule: 'sql-drop', text: 'exclusão de banco/tabela', pattern: /\b(drop\s+(database|schema|table)|truncate\s+table|delete\s+from\s+\w+\s*(;|$))/i },
  { severity: 'ask', rule: 'db-reset', text: 'reset de banco de dados', pattern: /\b(prisma\s+migrate\s+reset|rails\s+db:(drop|reset)|dropdb\b|flushall\b|flushdb\b)/i },
  { severity: 'ask', rule: 'infra-destroy', text: 'destruição de infraestrutura', pattern: /\b(terraform\s+(destroy|apply\b[^|;&]*-auto-approve)|kubectl\s+delete|helm\s+uninstall|pulumi\s+destroy)/i },
  { severity: 'ask', rule: 'prod-deploy', text: 'deploy em produção', pattern: /\b(deploy|publish|release)\b[^|;&]*\b(--prod\b|production\b|--production\b)|\b(vercel|netlify)\b[^|;&]*--prod\b|\bnpm\s+publish\b/i },
  { severity: 'block', rule: 'disk-wipe', text: 'operação irreversível de disco', pattern: /\b(mkfs(\.\w+)?\s|dd\s+if=[^|;&]*\sof=\/dev\/|format\s+[a-z]:|diskpart\b|:\(\)\s*\{\s*:\|:&\s*\};:)/i },
  { severity: 'block', rule: 'rm-root', text: 'remoção da raiz ou do diretório pessoal', pattern: /\brm\s+-[a-z]*r[a-z]*\s+(\/|~|\$HOME|\/\*)(\s|$)/i },
  { severity: 'warn', rule: 'curl-pipe-shell', text: 'script remoto executado direto no shell', pattern: /\b(curl|wget|iwr|Invoke-WebRequest)\b[^|]*\|\s*(sh|bash|zsh|iex|Invoke-Expression)\b/i },
  { severity: 'warn', rule: 'chmod-777', text: 'permissão 777', pattern: /\bchmod\s+(-R\s+)?777\b/i },
  { severity: 'warn', rule: 'no-verify', text: 'pula os hooks do git', pattern: /\bgit\b[^|;&]*\s--no-verify\b/i },
]

export function analyzeCommand(command: string, protectedBranches: readonly string[] = []): Finding[] {
  const findings: Finding[] = []
  for (const rule of COMMAND_RULES) {
    if (rule.pattern.test(command)) findings.push({ severity: rule.severity, rule: rule.rule, text: rule.text })
  }
  const push = /\bgit\b[^|;&]*\bpush\b([^|;&]*)/i.exec(command)
  if (push !== null && protectedBranches.length > 0) {
    const args = push[1]!.split(/\s+/).filter(Boolean)
    const target = args.find(arg => protectedBranches.some(branch => arg === branch || arg.endsWith(`:${branch}`) || arg === `HEAD:${branch}`))
    if (target !== undefined) {
      findings.push({ severity: 'ask', rule: 'protected-branch-push', text: `push direto para branch protegida (${target})` })
    }
  }
  return findings
}

/** Whether a push in `command` lands on a protected branch when the current branch is one. */
export function isPushFromProtected(command: string, currentBranch: string | null, protectedBranches: readonly string[]): boolean {
  if (currentBranch === null || !protectedBranches.includes(currentBranch)) return false
  const push = /\bgit\b[^|;&]*\bpush\b([^|;&]*)/i.exec(command)
  if (push === null) return false
  // `git push` / `git push origin` push the current branch.
  const args = push[1]!.split(/\s+/).filter(arg => arg.length > 0 && !arg.startsWith('-'))
  return args.length <= 1
}

export function isGitCommit(command: string): boolean {
  return /\bgit\b[^|;&]*\bcommit\b/i.test(command)
}

const SECRETS: readonly { rule: string; pattern: RegExp }[] = [
  { rule: 'anthropic-key', pattern: /sk-ant-[a-z0-9]{2,}-[A-Za-z0-9_-]{20,}/ },
  { rule: 'openai-key', pattern: /\bsk-(proj-)?[A-Za-z0-9]{32,}\b/ },
  { rule: 'aws-access-key', pattern: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { rule: 'github-token', pattern: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{60,}\b/ },
  { rule: 'slack-token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { rule: 'stripe-key', pattern: /\b(sk|rk)_live_[A-Za-z0-9]{20,}\b/ },
  { rule: 'google-key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { rule: 'private-key', pattern: /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { rule: 'password-literal', pattern: /\b(password|passwd|senha|secret|api[_-]?key)\s*[:=]\s*['"][^'"\s]{8,}['"]/i },
]

export function findSecrets(text: string): string[] {
  const found: string[] = []
  for (const secret of SECRETS) if (secret.pattern.test(text)) found.push(secret.rule)
  return found
}

/** Replaces anything that looks like a secret, for logs and exports. */
export function redactSecrets(text: string): string {
  let out = text
  for (const secret of SECRETS) {
    out = out.replace(new RegExp(secret.pattern.source, secret.pattern.flags.includes('g') ? secret.pattern.flags : `${secret.pattern.flags}g`), '[REDACTED]')
  }
  return out
}

/** Hides absolute paths and the user's home, for exports. */
export function redactPaths(text: string): string {
  return text
    .replace(/[A-Za-z]:\\(?:[^\\\s'"`]+\\)*[^\\\s'"`]*/g, '<path>')
    .replace(/\/(?:Users|home)\/[^/\s'"`]+(?:\/[^\s'"`]*)?/g, '<path>')
}

function globToRegExp(glob: string): RegExp {
  let source = ''
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]!
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        source += '.*'
        i++
        if (glob[i + 1] === '/') i++
      } else {
        source += '[^/]*'
      }
    } else if (ch === '?') {
      source += '[^/]'
    } else {
      source += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`(^|/)${source}$`, 'i')
}

export function matchCritical(path: string, globs: readonly string[]): string | null {
  const normal = path.replace(/\\/g, '/')
  for (const glob of globs) if (globToRegExp(glob).test(normal)) return glob
  return null
}

export function worst(findings: readonly Finding[]): Severity | null {
  if (findings.some(f => f.severity === 'block')) return 'block'
  if (findings.some(f => f.severity === 'ask')) return 'ask'
  if (findings.length > 0) return 'warn'
  return null
}
