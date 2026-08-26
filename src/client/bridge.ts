import { WEB_DRAFT_ENDPOINT, WEB_IMAGE_ROUTE_ENDPOINT } from '../web-contract.js'
import type { SubmitOutcome } from '@deepseek-ai/dsh-client-ui-input-trigger/client'

export type { SubmitOutcome as BridgeSubmitOutcome } from '@deepseek-ai/dsh-client-ui-input-trigger/client'

export interface BridgeSession {
  readonly sessionId: string
}

export interface BridgeDraftAttachment {
  readonly kind: 'image'
  readonly id: string
  readonly previewUrl: string
  readonly file: File
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
    const images: SerializedDraft[] = []
    for (const attachment of attachments) images.push(await serializeDraft(attachment.file))
    const upload = await uploadDrafts(session.sessionId, images, fetcher, signal)
    const prompt = buildBridgePrompt(text, upload)
    const outcome = await original.call(conversation, session, prompt, [], mode, signal)
    if (outcome.kind === 'success') conversation.releaseDraftImages(attachments)
    return outcome
  }
}
