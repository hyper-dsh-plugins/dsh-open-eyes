import { WEB_ATTACHMENT_ENDPOINT } from '../web-contract.js'
import { BRIDGE_REFERENCE_FIELD } from './chat-render.js'

type SupportedImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
const MAX_CACHED_HISTORY_IMAGES = 128
const MAX_CACHED_HISTORY_BYTES = 64 * 1024 * 1024

interface BridgeRenderableAttachment {
  readonly attachmentId?: unknown
  readonly mediaType?: unknown
  readonly bytes?: unknown
  readonly [BRIDGE_REFERENCE_FIELD]?: unknown
}

export interface BridgeHistoryImageLoader {
  readonly load: (attachment: unknown) => Promise<string>
  readonly dispose: () => void
}

function supportedMediaType(value: unknown): value is SupportedImageMediaType {
  return value === 'image/png' || value === 'image/jpeg' || value === 'image/webp' || value === 'image/gif'
}

function renderableAttachment(value: unknown): BridgeRenderableAttachment {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Vision Bridge history image metadata is invalid.')
  }
  const attachment = value as BridgeRenderableAttachment
  if (typeof attachment[BRIDGE_REFERENCE_FIELD] !== 'string' || !attachment[BRIDGE_REFERENCE_FIELD]) {
    throw new Error('Vision Bridge history image reference is unavailable.')
  }
  if (!supportedMediaType(attachment.mediaType)) {
    throw new Error('Vision Bridge history image media type is invalid.')
  }
  if (!Number.isSafeInteger(attachment.bytes) || Number(attachment.bytes) < 1) {
    throw new Error('Vision Bridge history image byte length is invalid.')
  }
  return attachment
}

/**
 * Resolve bridge history images through the plugin's same-origin reader.
 * The official DSH reader cannot authorize these objects because text-only
 * routes intentionally keep their attachment references inside text blocks.
 */
export function createBridgeHistoryImageLoader(
  fetcher: typeof fetch = fetch,
): BridgeHistoryImageLoader {
  const pending = new Map<string, Promise<string>>()
  const resolved = new Map<string, { readonly url: string; readonly bytes: number }>()
  let resolvedBytes = 0
  let disposed = false

  const remember = (reference: string, url: string, bytes: number): void => {
    resolved.set(reference, { url, bytes })
    resolvedBytes += bytes
    while (resolved.size > MAX_CACHED_HISTORY_IMAGES || resolvedBytes > MAX_CACHED_HISTORY_BYTES) {
      const oldest = resolved.entries().next().value as [string, { readonly url: string; readonly bytes: number }] | undefined
      if (oldest === undefined || oldest[0] === reference && resolved.size === 1) break
      resolved.delete(oldest[0])
      resolvedBytes -= oldest[1].bytes
      URL.revokeObjectURL(oldest[1].url)
    }
  }

  const load = (value: unknown): Promise<string> => {
    const attachment = renderableAttachment(value)
    const reference = attachment[BRIDGE_REFERENCE_FIELD] as string
    const available = resolved.get(reference)
    if (available !== undefined) {
      // Refresh insertion order for bounded LRU eviction.
      resolved.delete(reference)
      resolved.set(reference, available)
      return Promise.resolve(available.url)
    }
    const cached = pending.get(reference)
    if (cached !== undefined) return cached

    const operation = (async (): Promise<string> => {
      if (disposed) throw new Error('Vision Bridge history image loader is disposed.')
      const response = await fetcher(WEB_ATTACHMENT_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reference }),
        credentials: 'same-origin',
        redirect: 'error',
      })
      if (!response.ok) throw new Error(`Vision Bridge history image is unavailable (HTTP ${response.status}).`)
      const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
      if (mediaType !== attachment.mediaType || !supportedMediaType(mediaType)) {
        throw new Error('Vision Bridge history image media type did not match its reference.')
      }
      const declared = Number(response.headers.get('content-length'))
      if (!Number.isSafeInteger(declared) || declared !== attachment.bytes) {
        throw new Error('Vision Bridge history image byte length did not match its reference.')
      }
      const data = await response.arrayBuffer()
      if (data.byteLength !== attachment.bytes) {
        throw new Error('Vision Bridge history image body was incomplete.')
      }
      if (disposed) throw new Error('Vision Bridge history image loader is disposed.')
      const objectUrl = URL.createObjectURL(new Blob([data], { type: mediaType }))
      remember(reference, objectUrl, data.byteLength)
      return objectUrl
    })().finally(() => {
      pending.delete(reference)
    })
    pending.set(reference, operation)
    return operation
  }

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    pending.clear()
    for (const item of resolved.values()) URL.revokeObjectURL(item.url)
    resolved.clear()
    resolvedBytes = 0
  }

  return { load, dispose }
}
