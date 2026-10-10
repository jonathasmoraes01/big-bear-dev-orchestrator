import type { Io } from '../services/io'

import { alert } from '../services/engine'
import type { Finding } from './guardian'
import { analyzeCommand, findSecrets, isGitCommit, isPushFromProtected, matchCritical, worst } from './guardian'


const ALLOW = 'Permitir esta vez'
const BLOCK = 'Bloquear'

/**
 * Asks the person, in the engine's own dialog, before a dangerous call goes
 * on to the engine's permission check. Never allows anything the engine
 * would refuse: a "yes" here only lets the call reach that check.
 */
async function gate(io: Io, label: string, findings: Finding[]): Promise<{ deny: string } | null> {
  const config = await io.state.config.get()
  const level = worst(findings)
  if (level === null) return null
  const summary = findings.map(f => f.text).join('; ')
  await alert(io, 'codeGuardian', level === 'warn' ? 'warn' : 'danger', `${label}: ${summary}`)
  if (level === 'block') return { deny: `BIG BEAR Code Guardian bloqueou: ${summary}. Operação irreversível: rode você mesmo, se for intencional.` }
  if (level === 'warn' || config.guardian.action === 'warn') {
    io.ui.toast(`🐻 Guardian: ${summary}`)
    return null
  }
  if (config.guardian.action === 'deny') return { deny: `BIG BEAR Code Guardian: ${summary}. Bloqueado pela política (Settings → Comando perigoso).` }
  try {
    const answer = await io.ui.ask(`🐻 Code Guardian: ${summary}. Deixar seguir para a aprovação normal?`, { options: [ALLOW, BLOCK], header: 'Guardian' })
    return answer === ALLOW ? null : { deny: `BIG BEAR Code Guardian: bloqueado pelo usuário (${summary}).` }
  } catch {
    return { deny: `BIG BEAR Code Guardian: ${summary}. Sem ninguém para confirmar, a operação foi bloqueada.` }
  }
}

function commandFindings(command: string, protectedBranches: string[], branch: string | null, qaFailed: boolean): Finding[] {
  const findings = analyzeCommand(command, protectedBranches)
  if (isPushFromProtected(command, branch, protectedBranches) && !findings.some(f => f.rule === 'protected-branch-push')) {
    findings.push({ severity: 'ask', rule: 'protected-branch-push', text: `push a partir da branch protegida ${branch}` })
  }
  if (qaFailed && isGitCommit(command)) findings.push({ severity: 'ask', rule: 'commit-failed-qa', text: 'commit com o último Auto QA em falha' })
  return findings
}

export type Refusal = { deny: string } | null

/** Code Guardian and Git Guardian on a shell command (Bash, PowerShell). */
export async function guardShell(io: Io, tool: string, command: string): Promise<Refusal> {
  const config = await io.state.config.get()
  if (!config.modules.codeGuardian && !config.modules.gitGuardian) return null
  const git = await io.state.git.get()
  const qa = await io.state.qa.get()
  let findings = commandFindings(command, config.guardian.protectedBranches, git?.branch ?? null, qa.lastResult === 'failed')
  const isGitRule = (f: Finding) => f.rule.startsWith('git-') || f.rule.includes('branch') || f.rule === 'commit-failed-qa'
  if (!config.modules.gitGuardian) findings = findings.filter(f => !isGitRule(f))
  if (!config.modules.codeGuardian) findings = findings.filter(isGitRule)
  return gate(io, tool, findings)
}

/** When the guard itself failed: refuse only what the rules alone call irreversible. */
export function shellFallback(command: string): Refusal {
  return worst(analyzeCommand(command)) === 'block' ? { deny: 'BIG BEAR Code Guardian: falhou ao checar um comando irreversível.' } : null
}

export type EditInput = { file_path?: string; content?: string; new_string?: string; edits?: { new_string?: string }[] }

/** Code Guardian on a file edit: secrets being written, critical paths. */
export async function guardEdit(io: Io, tool: string, input: EditInput): Promise<Refusal> {
  const config = await io.state.config.get()
  if (!config.modules.codeGuardian) return null
  const path = input.file_path ?? ''
  const text = [input.content, input.new_string, ...(input.edits ?? []).map(edit => edit.new_string)].filter(Boolean).join('\n')
  const findings: Finding[] = findSecrets(text).map(rule => ({ severity: 'ask' as const, rule: `secret:${rule}`, text: `possível segredo (${rule}) sendo gravado` }))
  const critical = matchCritical(path, config.guardian.criticalPaths)
  if (critical !== null) {
    await alert(io, 'codeGuardian', 'warn', `arquivo crítico alterado (${critical}): revisar antes do commit`)
    io.ui.toast(`🐻 Guardian: arquivo crítico (${critical}) — revise antes do commit`)
  }
  return gate(io, tool, findings)
}
