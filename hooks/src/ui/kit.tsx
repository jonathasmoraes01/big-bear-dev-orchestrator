import type { Elements } from 'claude-code'

import type { BigBearActivity, BigBearTier } from '../../../types'
import { PALETTE, TIER_COLOR } from '../utils/format'
import { AVATARS } from './avatar-data'

/**
 * The elements every surface has, plus the picture element each one offers:
 * `Svg` on the desktop app, VS Code and mobile; `Raster` on the terminal.
 */
export type Kit = Pick<Elements['mobile'], 'Box' | 'Text' | 'Button'> & {
  Svg?: Elements['desktop']['Svg']
  Raster?: Elements['terminal']['Raster']
}

/** Picks by surface, not by key: the table answers `in` for every name. */
export function kitOf(table: Elements[keyof Elements], surface: keyof Elements): Kit {
  const all = table as Partial<Elements['desktop'] & Elements['terminal']>
  return {
    Box: table.Box,
    Text: table.Text,
    Button: table.Button,
    Svg: surface === 'terminal' ? undefined : all.Svg,
    Raster: surface === 'terminal' ? all.Raster : undefined,
  }
}

export const ACTIVITY_LABEL: Record<BigBearActivity, string> = {
  idle: 'Ocioso',
  research: 'Pesquisando',
  work: 'Trabalhando',
}

export const ACTIVITY_COLOR: Record<BigBearActivity, string> = {
  idle: PALETTE.muted,
  research: PALETTE.secondary,
  work: PALETTE.warning,
}

/** The bear for the current activity: pixel art, as supplied, sized for the room. */
export function avatar(ui: Kit, activity: BigBearActivity, size: 'lg' | 'sm' | 'xs', key: string) {
  const frames = AVATARS[activity]
  if (ui.Svg !== undefined) {
    const px = size === 'lg' ? 96 : size === 'sm' ? 64 : 48
    return <ui.Svg source={frames.svg} alt={`Big Bear: ${ACTIVITY_LABEL[activity]}`} width={px} height={px} />
  }
  if (ui.Raster !== undefined) {
    const raster = frames[size]
    return <ui.Raster key={key} columns={raster.columns} rows={raster.rows} cells={raster.cells} />
  }
  return <ui.Text color={ACTIVITY_COLOR[activity]}>🐻</ui.Text>
}

export function tierChip(ui: Kit, tier: BigBearTier) {
  return (
    <ui.Text color={TIER_COLOR[tier]} bold>
      {tier.toUpperCase()}
    </ui.Text>
  )
}

/** A filled pill: dark text on the color, for the mode and the model. */
export function pill(ui: Kit, label: string, color: string) {
  return (
    <ui.Text backgroundColor={color} color={PALETTE.bg} bold>
      {` ${label} `}
    </ui.Text>
  )
}

/**
 * A section title with an accent marker, a rule that fills what is left of
 * the line, and a right-hand summary. The rule shrinks and clips; the title
 * and the summary never shrink, so nothing wraps onto a second line.
 */
export function section(ui: Kit, title: string, right?: string, accent: string = PALETTE.primary) {
  return (
    <ui.Box flexDirection="row" columnGap={1} marginTop={1}>
      <ui.Box flexShrink={0}>
        <ui.Text color={accent} bold>
          ▍
        </ui.Text>
      </ui.Box>
      <ui.Box flexShrink={0}>
        <ui.Text color={PALETTE.text} bold>
          {title}
        </ui.Text>
      </ui.Box>
      <ui.Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden" height={1}>
        <ui.Text color={PALETTE.surface} wrap="truncate-end">
          {'─'.repeat(120)}
        </ui.Text>
      </ui.Box>
      {right !== undefined && (
        <ui.Box flexShrink={0}>
          <ui.Text color={PALETTE.muted}>{right}</ui.Text>
        </ui.Box>
      )}
    </ui.Box>
  )
}

/**
 * A card on the surface color with a colored border. The first row is the
 * hero: its value is bold in the accent color (or the row's own color).
 */
export function card(ui: Kit, title: string, accent: string, rows: { label: string; value: string; color?: string }[], width: number) {
  return (
    <ui.Box flexDirection="column" borderStyle="round" borderColor={accent} backgroundColor={PALETTE.surface} paddingX={1} width={width} minWidth={width}>
      <ui.Text color={accent} bold>
        {title}
      </ui.Text>
      {rows.map((row, index) => (
        <ui.Box flexDirection="row" justifyContent="space-between">
          <ui.Text color={PALETTE.muted}>{row.label}</ui.Text>
          <ui.Text color={row.color ?? (index === 0 ? accent : PALETTE.text)} bold={index === 0}>
            {row.value}
          </ui.Text>
        </ui.Box>
      ))}
    </ui.Box>
  )
}

/** A meter colored by thresholds: primary, warning past `warn`, danger past `high`. */
export function meterColor(percent: number, warn: number, high: number): string {
  if (percent >= high) return PALETTE.danger
  if (percent >= warn) return PALETTE.warning
  return PALETTE.primary
}
