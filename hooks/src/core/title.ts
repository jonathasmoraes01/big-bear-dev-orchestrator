import type { BigBearCategory } from '../../../types'

/**
 * A readable title for a task, always: what kind of work it is, then a clean
 * summary of the request. Pure.
 *
 * Prompts reach the model in several shapes: typed text, short replies
 * ("sim"), and machine notices such as a background task finishing, which
 * arrive wrapped in XML-like tags. None of them may become a title as is.
 */
export const CATEGORY_LABEL: Record<BigBearCategory, string> = {
  continue: 'Continuação',
  trivial: 'Conversa',
  lookup: 'Busca',
  docs: 'Documentação',
  test: 'Testes',
  bugfix: 'Correção',
  feature: 'Implementação',
  refactor: 'Refatoração',
  architecture: 'Arquitetura',
  audit: 'Auditoria',
  critical: 'Crítico',
}

const BLOCKS = /<(system-reminder|command-[a-z-]+|local-command-[a-z-]+|ide_[a-z_]+|user-prompt-submit-hook)\b[^>]*>[\s\S]*?<\/\1>/gi
const TAG = /<\/?[a-zA-Z][\w:-]*(?:\s[^>]*)?>/g

function tagText(text: string, name: string): string | null {
  const match = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(text)
  const value = match?.[1]?.replace(/\s+/g, ' ').trim()
  return value !== undefined && value.length > 0 ? value : null
}

/** What a background-task notice says, or null when the text is not one. */
export function notificationSummary(text: string): string | null {
  if (!/<task-notification\b/i.test(text)) return null
  const summary = tagText(text, 'summary') ?? tagText(text, 'result') ?? tagText(text, 'message')
  const status = tagText(text, 'status')
  const detail = summary ?? (status !== null ? `status ${status}` : 'notificação')
  return `Tarefa em segundo plano · ${detail}`
}

function firstSentence(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const cut = /^(.{12,}?[.!?])(\s|$)/.exec(flat)?.[1] ?? flat
  return cut.length <= max ? cut : `${cut.slice(0, max - 1).trimEnd()}…`
}

export function titleFor(text: string, category: BigBearCategory, max = 90): string {
  const notice = notificationSummary(text)
  if (notice !== null) return firstSentence(notice, max)

  const clean = text.replace(BLOCKS, ' ').replace(TAG, ' ').replace(/\s+/g, ' ').trim()
  const label = CATEGORY_LABEL[category]
  if (clean.length === 0) return label
  // A reply too short to say anything on its own keeps its label in front.
  return `${label} · ${firstSentence(clean, max - label.length - 3)}`
}
