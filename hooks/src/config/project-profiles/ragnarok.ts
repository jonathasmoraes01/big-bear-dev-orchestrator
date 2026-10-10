/**
 * Ragnarok Classic Idle profile. Every category runs the project's own
 * vitest suite, narrowed by file filters that match the test files the
 * repository already has; nothing here changes the game.
 */
export type RagnarokCategory = {
  id: string
  label: string
  /** vitest positional filters (substrings of test file paths). */
  filters: string[]
  /** What a person should still check by hand: no automated test covers it. */
  manual: string[]
}

export const RAGNAROK_CATEGORIES: readonly RagnarokCategory[] = [
  {
    id: 'combate',
    label: 'COMBATE',
    filters: ['combat/', 'game/dmglog', 'game/mob-skills', 'game/agressao', 'game/aproximacao', 'game/alcance-do-jogador', 'game/hit-do-buff'],
    manual: ['Animações de ataque e de habilidade no cliente'],
  },
  {
    id: 'bot-idle',
    label: 'BOT IDLE',
    filters: [
      'game/rotas-inteligentes',
      'game/cacada',
      'game/consumivel',
      'game/auto-helper',
      'game/kafra',
      'game/jornada-de-midgard',
      'game/asa-de-mosca',
      'game/pocoes-da-conta',
      'game/objetivo-de-caca',
      'game/cura-por-grupo-de-item',
      'game/cidade-sentado',
    ],
    manual: ['Retorno visual para Prontera no cliente'],
  },
  {
    id: 'party',
    label: 'PARTY',
    filters: ['game/party-lfg', 'game/escolta', 'game/mercenario', 'game/morte-reseta-o-grupo', 'game/senha-do-grupo', 'game/postura-de-boss'],
    manual: ['Posicionamento e acompanhamento na tela'],
  },
  {
    id: 'frontend',
    label: 'FRONTEND',
    filters: [],
    manual: ['Responsividade', 'HUD', 'Inventário', 'Equipamentos', 'Menus', 'Compatibilidade mobile'],
  },
]

/** Whether a project root looks like Ragnarok Classic Idle. */
export function isRagnarok(packageName: string | null, entries: readonly string[]): boolean {
  if (packageName === 'rag-idle-2') return true
  return entries.includes('combat') && entries.includes('game') && entries.includes('rathena-custom')
}
