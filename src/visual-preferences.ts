export const VISUAL_ANALYSIS_MODES = ['default', 'efficient', 'deep'] as const
export type VisualAnalysisMode = (typeof VISUAL_ANALYSIS_MODES)[number]

export const VISUAL_FOCUS_AREAS = ['text', 'tables', 'interface', 'objects', 'details'] as const
export type VisualFocusArea = (typeof VISUAL_FOCUS_AREAS)[number]

export const MAX_CUSTOM_PREFERENCE_UNITS = 50

export interface VisualPreferences {
  readonly visualAnalysis: VisualAnalysisMode
  readonly focusAreas: readonly VisualFocusArea[]
  readonly preference: string
}

const VISUAL_ANALYSIS_PROMPTS: Readonly<Record<Exclude<VisualAnalysisMode, 'default'>, string>> = {
  efficient: 'Analyze the image efficiently, summarize only information relevant to the request, and keep the response concise.',
  deep: 'Analyze the image thoroughly, describe relevant evidence and important details comprehensively, check ambiguous areas carefully, and keep the response detailed.',
}

const VISUAL_FOCUS_PROMPTS: Readonly<Record<VisualFocusArea, string>> = {
  text: 'text and OCR',
  tables: 'tables and charts',
  interface: 'interface and layout',
  objects: 'objects and scenes',
  details: 'anomalies and fine details',
}

const CJK_CHARACTER = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const NUMBER_CHARACTER = /\p{N}/u
const WORD_CHARACTER = /\p{L}/u

export function normalizeVisualAnalysis(value: unknown): VisualAnalysisMode {
  if ((VISUAL_ANALYSIS_MODES as readonly unknown[]).includes(value)) return value as VisualAnalysisMode
  throw new Error('invalid-visual-analysis')
}

export function normalizeFocusAreas(value: unknown): VisualFocusArea[] {
  if (!Array.isArray(value)) throw new Error('invalid-focus-areas')
  const selected = new Set<VisualFocusArea>()
  for (const item of value) {
    if (!(VISUAL_FOCUS_AREAS as readonly unknown[]).includes(item)) throw new Error('invalid-focus-areas')
    selected.add(item as VisualFocusArea)
  }
  return VISUAL_FOCUS_AREAS.filter(area => selected.has(area))
}

/** Count CJK characters individually and contiguous Latin/alphanumeric words once. */
export function countPreferenceUnits(value: string): number {
  let units = 0
  let inWord = false
  for (const character of value) {
    if (CJK_CHARACTER.test(character)) {
      units += 1
      inWord = false
      continue
    }
    if (NUMBER_CHARACTER.test(character)) {
      units += 1
      inWord = false
      continue
    }
    if (WORD_CHARACTER.test(character)) {
      if (!inWord) units += 1
      inWord = true
      continue
    }
    inWord = false
  }
  return units
}

/**
 * Append settings only to the delegated provider prompt. The all-default state
 * is an exact no-op so it preserves the original tool-generated prompt.
 */
export function composeVisualPreferencePrompt(prompt: string, preferences: VisualPreferences): string {
  const additions: string[] = []
  if (preferences.visualAnalysis !== 'default') {
    additions.push(VISUAL_ANALYSIS_PROMPTS[preferences.visualAnalysis])
  }
  const focusAreas = normalizeFocusAreas(preferences.focusAreas)
  if (focusAreas.length > 0) {
    additions.push(`In addition to the requested analysis, pay particular attention to: ${focusAreas.map(area => VISUAL_FOCUS_PROMPTS[area]).join(', ')}.`)
  }
  const custom = preferences.preference.trim()
  if (custom !== '') additions.push(`Additional preference: ${custom}`)
  return additions.length === 0 ? prompt : `${prompt}\n\n${additions.join('; ')}`
}
