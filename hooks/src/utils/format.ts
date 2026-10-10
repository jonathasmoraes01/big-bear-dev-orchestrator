import type { BigBearStatus, BigBearTier } from '../../../types'

export const PALETTE = {
  bg: '#080B10',
  surface: '#11161F',
  primary: '#10B981',
  secondary: '#38BDF8',
  accent: '#A855F7',
  text: '#F8FAFC',
  muted: '#94A3B8',
  warning: '#F59E0B',
  danger: '#EF4444',
} as const

export const TIER_COLOR: Record<BigBearTier, string> = {
  haiku: PALETTE.primary,
  sonnet: PALETTE.secondary,
  opus: PALETTE.accent,
}

export const TIER_ROLE: Record<BigBearTier, string> = {
  haiku: 'THE SCOUT',
  sonnet: 'THE BUILDER',
  opus: 'THE ARCHITECT',
}

export const STATUS_COLOR: Record<BigBearStatus, string> = {
  PENDING: PALETTE.muted,
  ANALYZING: PALETTE.secondary,
  RUNNING: PALETTE.primary,
  WAITING: PALETTE.warning,
  VALIDATING: PALETTE.accent,
  COMPLETED: PALETTE.primary,
  FAILED: PALETTE.danger,
  CANCELLED: PALETTE.muted,
}

export const STATUS_GLYPH: Record<BigBearStatus, string> = {
  PENDING: '○',
  ANALYZING: '◌',
  RUNNING: '●',
  WAITING: '◔',
  VALIDATING: '◑',
  COMPLETED: '✓',
  FAILED: '✗',
  CANCELLED: '–',
}

export function bar(percent: number, width = 10): string {
  const clamped = Math.max(0, Math.min(100, percent))
  const full = Math.round((clamped / 100) * width)
  return '█'.repeat(full) + '░'.repeat(width - full)
}

export function duration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '—'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  return `${h}h${String(m % 60).padStart(2, '0')}`
}

export function untilReset(resetsAt: string | undefined, now: number): string {
  if (resetsAt === undefined) return 'N/D'
  const at = Date.parse(resetsAt)
  if (!Number.isFinite(at)) return 'N/D'
  const left = Math.max(0, at - now)
  const m = Math.floor(left / 60000)
  const h = Math.floor(m / 60)
  if (h >= 24) return `${Math.floor(h / 24)}d${String(h % 24).padStart(2, '0')}h`
  return `${String(h).padStart(2, '0')}h${String(m % 60).padStart(2, '0')}`
}

export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`
  return String(Math.round(n))
}

export function usd(n: number): string {
  if (n === 0) return '$0.00'
  if (n < 0.01) return `$${n.toFixed(4)}`
  if (n < 100) return `$${n.toFixed(2)}`
  return `$${n.toFixed(0)}`
}

export function projectName(root: string): string {
  const parts = root.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts.at(-1) ?? root
}

export function clip(text: string, width: number): string {
  if (width <= 1) return ''
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= width ? flat : `${flat.slice(0, width - 1)}…`
}

export function pad(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : text + ' '.repeat(width - text.length)
}
