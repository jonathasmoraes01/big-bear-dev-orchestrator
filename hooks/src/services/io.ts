import type { EngineInterface, PluginState } from 'claude-code'

/**
 * The engine's capabilities the modules use, as plain closures.
 *
 * The engine follows `$` only into functions of the file that received it,
 * so hooks/register.tsx (the one place events are captured) builds this
 * object from its `$` and hands it to the modules. The modules hold the
 * rules; this object is their only door to the engine.
 */
/** One of the mod's session values: read (which subscribes a drawing) and change. */
export type Cell<T> = { get: () => Promise<T>; set: (change: (value: T) => T) => Promise<T> }

type BigBearState = PluginState['big-bear']

export type Io = {
  state: { [K in keyof BigBearState]: Cell<BigBearState[K]> }
  clock: Pick<EngineInterface['clock'], 'now' | 'after' | 'every'>
  ui: Pick<EngineInterface['ui'], 'toast' | 'log' | 'open' | 'close' | 'panes' | 'ask' | 'copy'>
  store: EngineInterface['store']
  process: Pick<EngineInterface['process'], 'run'>
  fs: { list: EngineInterface['fs']['list']; read: (path: string) => Promise<string> }
  session: Pick<EngineInterface['session'], 'root' | 'model' | 'usage' | 'version' | 'surfaces'>
  command: Pick<EngineInterface['command'], 'list' | 'register'>
  model: Pick<EngineInterface['model'], 'complete' | 'classify'>
  prompt: Pick<EngineInterface['prompt'], 'submit'>
}
