import { WEB_DRAFT_ENDPOINT, WEB_IMAGE_ROUTE_ENDPOINT } from '../web-contract.js'
import type { SubmitOutcome } from '@deepseek-ai/dsh-client-ui-input-trigger/client'

export type { SubmitOutcome as BridgeSubmitOutcome } from '@deepseek-ai/dsh-client-ui-input-trigger/client'

export interface BridgeSession {
  readonly sessionId: string
  getSnapshot(): { readonly subagent: unknown | null }
  beginSubmission(input: {
    readonly text: string
    readonly images: readonly {
      readonly previewUrl: string
      readonly name?: string
      readonly width?: number
      readonly height?: number
    }[]
    readonly onRetire?: (retirement: BridgeSubmissionRetirement) => void
  }): { readonly requestId: string; abandon(): void }
  prompt(
    content: readonly { readonly type: 'text'; readonly text: string }[],
    mode: BridgeSubmitMode,
    signal?: AbortSignal,
    requestId?: string,
  ): Promise<{ readonly ok: boolean }>
}

export type BridgeSubmissionRetirement =
  | { readonly reason: 'observed'; readonly attachments: readonly unknown[] }
  | { readonly reason: 'failed' }

export interface BridgeDraftAttachment {
  readonly kind: 'image'
  readonly id: string
  readonly previewUrl: string
  readonly file: File
  readonly width?: number
  readonly height?: number
}

export type BridgeSubmitMode = 'queue' | 'steer'

export interface BridgeConversation {
  sendSession(
    session: BridgeSession,
    text: string,
    imageIds: readonly string[],
    mode: BridgeSubmitMode,
    signal?: AbortSignal,
  ): Promise<SubmitOutcome>
  draftImages(ids: readonly string[]): readonly BridgeDraftAttachment[]
  releaseDraftImages(attachments: readonly BridgeDraftAttachment[]): void
}

export interface WebDraftUploadResponse {
  readonly configured: boolean
  readonly defaultProvider: string | null
  readonly providerIds: readonly string[]
  readonly references: readonly string[]
}

export interface WebImageRoutingResponse {
  readonly route: 'native' | 'bridge'
  readonly configured: boolean
  readonly defaultProvider: string | null
  readonly providerIds: readonly string[]
}

interface SerializedDraft {
  readonly name: string
  readonly mediaType: string
  readonly data: string
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.byteLength)))
  }
  return btoa(binary)
}

async function serializeDraft(file: File): Promise<SerializedDraft> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  return {
    name: file.name || 'pasted-image',
    mediaType: file.type,
    data: bytesToBase64(bytes),
  }
}

/** Give alpha.1's local echo one browser paint before image serialization/upload work. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== 'function') {
      setTimeout(resolve, 0)
      return
    }
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      setTimeout(resolve, 0)
      return
    }
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(fallback)
      setTimeout(resolve, 0)
    }
    const fallback = setTimeout(finish, 100)
    requestAnimationFrame(finish)
  })
}

function echoImages(attachments: readonly BridgeDraftAttachment[]) {
  return attachments.map(attachment => ({
    previewUrl: attachment.previewUrl,
    ...(attachment.file.name === '' ? {} : { name: attachment.file.name }),
    ...(attachment.width === undefined ? {} : { width: attachment.width }),
    ...(attachment.height === undefined ? {} : { height: attachment.height }),
  }))
}

/**
 * alpha.1 has no public pre-admission middleware or separate echo/durable text
 * fields. Register the truthful local echo first, then let the exact official
 * sendSession chain perform its normal prompt call while substituting only the
 * already-created submission handle at its synchronous beginSubmission seam.
 */
async function sendWithAlpha1Echo(
  conversation: BridgeConversation,
  original: BridgeConversation['sendSession'],
  session: BridgeSession,
  displayText: string,
  prepareDurableText: () => Promise<string>,
  attachments: readonly BridgeDraftAttachment[],
  mode: BridgeSubmitMode,
  signal?: AbortSignal,
): Promise<SubmitOutcome> {
  if (session.getSnapshot().subagent !== null) {
    const durableText = await prepareDurableText()
    const outcome = await original.call(conversation, session, durableText, [], mode, signal)
    if (outcome.kind === 'success') conversation.releaseDraftImages(attachments)
    return outcome
  }

  let delegatedRetirement: ((retirement: BridgeSubmissionRetirement) => void) | undefined
  let finishRetirement: ((retirement: BridgeSubmissionRetirement) => void) | undefined
  const retirement = new Promise<BridgeSubmissionRetirement>((resolve) => { finishRetirement = resolve })
  const submission = session.beginSubmission({
    text: displayText,
    images: echoImages(attachments),
    onRetire: (settlement) => {
      delegatedRetirement?.(settlement)
      if (settlement.reason === 'observed') conversation.releaseDraftImages(attachments)
      finishRetirement?.(settlement)
    },
  })
  let durableText: string
  try {
    await nextPaint()
    durableText = await prepareDurableText()
  } catch (error) {
    submission.abandon()
    throw error
  }

  const originalDescriptor = Object.getOwnPropertyDescriptor(session, 'beginSubmission')
  const originalBegin = session.beginSubmission
  let consumed = false
  const substitute: BridgeSession['beginSubmission'] = (input) => {
    if (consumed) return originalBegin.call(session, input)
    consumed = true
    delegatedRetirement = input.onRetire
    return submission
  }
  session.beginSubmission = substitute
  let pending: Promise<SubmitOutcome>
  try {
    pending = original.call(conversation, session, durableText, [], mode, signal)
  } catch (error) {
    submission.abandon()
    throw error
  } finally {
    if (session.beginSubmission === substitute) {
      if (originalDescriptor === undefined) Reflect.deleteProperty(session, 'beginSubmission')
      else Object.defineProperty(session, 'beginSubmission', originalDescriptor)
    }
  }
  if (!consumed) {
    submission.abandon()
    throw new Error('Vision Bridge could not enter the DSH 0.1.2-alpha.1 submission seam.')
  }
  const outcome = await pending
  if (outcome.kind !== 'success') return outcome
  const settlement = await retirement
  return settlement.reason === 'observed' ? outcome : { kind: 'error' }
}

function validUploadResponse(value: unknown): value is WebDraftUploadResponse {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return typeof item.configured === 'boolean'
    && (item.defaultProvider === null || typeof item.defaultProvider === 'string')
    && Array.isArray(item.providerIds)
    && item.providerIds.every(id => typeof id === 'string')
    && Array.isArray(item.references)
    && item.references.every(ref => typeof ref === 'string')
}

function validRoutingResponse(value: unknown): value is WebImageRoutingResponse {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return (item.route === 'native' || item.route === 'bridge')
    && typeof item.configured === 'boolean'
    && (item.defaultProvider === null || typeof item.defaultProvider === 'string')
    && Array.isArray(item.providerIds)
    && item.providerIds.every(id => typeof id === 'string')
}

async function boundedJson(response: Response, failure: string): Promise<unknown> {
  try {
    const text = await response.text()
    if (text.length > 64 * 1024) throw new Error('response too large')
    return JSON.parse(text)
  } catch {
    throw new Error(failure)
  }
}

async function resolveImageRoute(
  sessionId: string,
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<WebImageRoutingResponse> {
  const response = await fetcher(WEB_IMAGE_ROUTE_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId }),
    credentials: 'same-origin',
    redirect: 'error',
    ...(signal === undefined ? {} : { signal }),
  })
  if (!response.ok) {
    throw new Error(`Open Eyes could not read this session's enablement state (HTTP ${response.status}).`)
  }
  const payload = await boundedJson(response, 'Open Eyes returned an invalid session routing response.')
  if (!validRoutingResponse(payload)) {
    throw new Error('Open Eyes returned an invalid session routing response.')
  }
  return payload
}

async function uploadDrafts(
  sessionId: string,
  images: readonly SerializedDraft[],
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<WebDraftUploadResponse> {
  const response = await fetcher(WEB_DRAFT_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, images }),
    credentials: 'same-origin',
    redirect: 'error',
    ...(signal === undefined ? {} : { signal }),
  })
  if (!response.ok) {
    throw new Error(`Vision Bridge could not accept the pasted image (HTTP ${response.status}).`)
  }
  const payload = await boundedJson(response, 'Vision Bridge returned an invalid browser handoff response.')
  if (!validUploadResponse(payload)) throw new Error('Vision Bridge returned an invalid browser handoff response.')
  if (payload.configured && payload.references.length !== images.length) {
    throw new Error('Vision Bridge did not return one reference per pasted image.')
  }
  if (!payload.configured && payload.references.length !== 0) {
    throw new Error('Vision Bridge returned references while unconfigured.')
  }
  return payload
}

/**
 * Build the durable user turn. Internal routing and tool instructions belong
 * to the Tool/Skill system context; the conversation shows only the user's
 * own words and ordinary attachment links.
 */
export function buildBridgePrompt(userText: string, upload: WebDraftUploadResponse): string {
  if (!upload.configured) {
    throw new Error('Vision Bridge is installed but not configured. Configure a provider and Credential Reference before sending pasted images.')
  }
  if (upload.references.length === 0) {
    throw new Error('Vision Bridge returned no attachment references for the pasted images.')
  }
  const attachments = upload.references
    .map((reference, index) => `[Attached image ${index + 1}](${reference})`)
    .join('\n')
  // Never synthesize words on the user's behalf. Preserve their text byte for
  // byte; an image-only send is represented only by its attachment links.
  return userText === '' ? attachments : `${userText}\n\n${attachments}`
}

/** Wrap the concrete Web conversation submission seam while preserving all text-only behavior. */
export function createVisionBridgeSendSession(
  conversation: BridgeConversation,
  fetcher: typeof fetch = fetch,
): BridgeConversation['sendSession'] {
  const original = conversation.sendSession
  return async (session, text, imageIds, mode, signal) => {
    if (imageIds.length === 0) {
      return original.call(conversation, session, text, imageIds, mode, signal)
    }
    const routing = await resolveImageRoute(session.sessionId, fetcher, signal)
    if (routing.route === 'native') {
      return original.call(conversation, session, text, imageIds, mode, signal)
    }
    if (!routing.configured) {
      throw new Error('Vision Bridge is installed but not configured. Configure a provider and Credential Reference before sending pasted images.')
    }
    const attachments = conversation.draftImages(imageIds)
    if (attachments.length !== imageIds.length) {
      throw new Error('Vision Bridge could not resolve one or more pasted image drafts.')
    }
    return sendWithAlpha1Echo(conversation, original, session, text, async () => {
      const images: SerializedDraft[] = []
      for (const attachment of attachments) images.push(await serializeDraft(attachment.file))
      const upload = await uploadDrafts(session.sessionId, images, fetcher, signal)
      return buildBridgePrompt(text, upload)
    }, attachments, mode, signal)
  }
}
