import type { SessionStartSource } from '@deepseek-ai/dsh-agent'
import type { VisionBridgeEnablementTransition, VisionBridgeSettings } from './settings-contract.js'

export interface EnablementSession {
  readonly header: { readonly createdAt: number }
}

function orderedHistory(
  history: readonly VisionBridgeEnablementTransition[] | undefined,
): readonly VisionBridgeEnablementTransition[] {
  if (history === undefined || history.length === 0) return []
  return [...history].sort((left, right) => left.effectiveAt - right.effectiveAt)
}

/** Resolve the switch state at one durable session creation timestamp. */
export function enabledAt(
  createdAt: number,
  fallback: boolean,
  history: readonly VisionBridgeEnablementTransition[] | undefined,
): boolean {
  let enabled = fallback
  for (const transition of orderedHistory(history)) {
    if (transition.effectiveAt > createdAt) break
    enabled = transition.enabled
  }
  return enabled
}

/**
 * Process-local immutable latches backed by the Settings transition history.
 * No value is written to the model-visible session log or prompt.
 */
export class SessionEnablement {
  readonly #latched = new WeakMap<object, boolean>()

  constructor(private readonly settings: () => VisionBridgeSettings) {}

  onSessionStart(session: EnablementSession, source: SessionStartSource): void {
    if (this.#latched.has(session as object)) return
    const settings = this.settings()
    const current = settings.enabled ?? true
    const enabled = source === 'startup'
      ? current
      : enabledAt(session.header.createdAt, current, settings.enablementHistory)
    this.#latched.set(session as object, enabled)
  }

  isEnabled(session: EnablementSession | undefined): boolean {
    if (session === undefined) return false
    const existing = this.#latched.get(session as object)
    if (existing !== undefined) return existing
    const settings = this.settings()
    const enabled = enabledAt(
      session.header.createdAt,
      settings.enabled ?? true,
      settings.enablementHistory,
    )
    this.#latched.set(session as object, enabled)
    return enabled
  }
}
