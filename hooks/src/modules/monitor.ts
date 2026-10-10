import type { SessionMeasureInput } from 'claude-code'
import type { Io } from '../services/io'

import type { BigBearUsage } from '../../../types'
import { runtime } from '../core/runtime'
import { alert, saveSettings, usageSnapshot } from '../services/engine'

type Level = { at: number; level: 'info' | 'warn' | 'danger'; text: string }

/** Which thresholds a window has crossed, highest first. */
export function crossed(percent: number, warn: number, high: number, critical: number): Level | null {
  if (percent >= critical) return { at: critical, level: 'danger', text: 'limite próximo' }
  if (percent >= high) return { at: high, level: 'danger', text: 'consumo elevado' }
  if (percent >= warn) return { at: warn, level: 'warn', text: 'aviso preventivo' }
  return null
}

/**
 * session.measure: Usage Monitor and Context Manager read the engine's own
 * measurements, the account's rate-limit windows and the live context window.
 */
export async function onMeasure(io: Io, e: SessionMeasureInput): Promise<void> {
  {
    const config = await io.state.config.get()
    const now = await io.clock.now()
    const snapshot: BigBearUsage = usageSnapshot(now, e)
    await io.state.usage.set(() => snapshot)

    if (config.modules.usageMonitor) {
      const windows = [
        { name: '5H', value: snapshot.fiveHour },
        { name: 'SEMANA', value: snapshot.week },
      ]
      for (const window of windows) {
        if (window.value === null) continue
        const hit = crossed(window.value.percent, config.usage.warn, config.usage.high, config.usage.critical)
        if (hit === null) continue
        const key = `${window.name}:${hit.at}:${window.value.resetsAt ?? ''}`
        if (runtime.alerted.has(key)) continue
        runtime.alerted.add(key)
        const advice = config.routing.mode === 'eco' ? '' : ' · considere /bigbear mode eco'
        await alert(io, 'usageMonitor', hit.level, `${window.name} ${Math.round(window.value.percent)}%: ${hit.text}${advice}`)
        io.ui.toast(`🐻 ${window.name} ${Math.round(window.value.percent)}% — ${hit.text}${advice}`)
        if (config.usage.autoEco && hit.at >= config.usage.high && config.routing.mode !== 'eco') {
          await saveSettings(io, { ...config, routing: { ...config.routing, mode: 'eco' } })
          io.ui.toast('🐻 ECO MODE ativado automaticamente (Settings → ECO automático)')
        }
      }
    }

    if (config.modules.contextManager && snapshot.contextPercent !== null && snapshot.contextPercent >= config.context.warnPercent) {
      const bucket = Math.floor(snapshot.contextPercent / 5) * 5
      const key = `ctx:${bucket}`
      if (!runtime.alerted.has(key)) {
        runtime.alerted.add(key)
        await alert(io, 'contextManager', 'warn', `contexto em ${snapshot.contextPercent}%: considere /compact (o BIG BEAR não compacta sozinho)`)
        io.ui.toast(`🐻 Contexto ${snapshot.contextPercent}% — considere /compact`)
      }
    }
  }
}
