/**
 * Limits of the session values. The values themselves are declared in
 * types/index.d.ts and created in hooks/register.tsx: the engine reads every
 * state access statically, so the atoms live beside the `$` that uses them.
 */
export const MAX_TASKS = 60
export const MAX_ALERTS = 20
