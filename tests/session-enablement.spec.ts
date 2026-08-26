import { describe, expect, it } from 'vitest'
import { SessionEnablement, enabledAt } from '../src/session-enablement.js'
import type { VisionBridgeSettings } from '../src/settings-contract.js'

function settings(enabled: boolean, history: NonNullable<VisionBridgeSettings['enablementHistory']>): VisionBridgeSettings {
  return { enabled, enablementHistory: history, profiles: {} }
}

function session(createdAt: number) {
  return { header: { createdAt } }
}

describe('session-latched Open Eyes enablement', () => {
  it('derives resumed sessions from the switch state at their durable creation time', () => {
    const history = [
      { effectiveAt: 0, enabled: true },
      { effectiveAt: 200, enabled: false },
      { effectiveAt: 400, enabled: true },
    ] as const
    expect(enabledAt(100, true, history)).toBe(true)
    expect(enabledAt(300, true, history)).toBe(false)
    expect(enabledAt(500, false, history)).toBe(true)
  })

  it('latches startup sessions and never changes them when the global switch toggles', () => {
    let current = settings(true, [{ effectiveAt: 0, enabled: true }])
    const enablement = new SessionEnablement(() => current)
    const existing = session(100)
    enablement.onSessionStart(existing, 'startup')

    current = settings(false, [
      { effectiveAt: 0, enabled: true },
      { effectiveAt: 200, enabled: false },
    ])
    expect(enablement.isEnabled(existing)).toBe(true)

    const fresh = session(300)
    enablement.onSessionStart(fresh, 'startup')
    expect(enablement.isEnabled(fresh)).toBe(false)
  })

  it('restores a resumed session without adding model-visible transcript state', () => {
    const current = settings(false, [
      { effectiveAt: 0, enabled: true },
      { effectiveAt: 200, enabled: false },
    ])
    const enablement = new SessionEnablement(() => current)
    const resumed = session(100)
    enablement.onSessionStart(resumed, 'resume')
    expect(enablement.isEnabled(resumed)).toBe(true)
    expect(Object.keys(resumed)).toEqual(['header'])
  })
})
