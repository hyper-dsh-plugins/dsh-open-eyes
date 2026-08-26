import { afterEach, describe, expect, it, vi } from 'vitest'
import { BRIDGE_REFERENCE_FIELD } from '../src/client/chat-render.js'
import { createBridgeHistoryImageLoader } from '../src/client/image-loader.js'
import { WEB_ATTACHMENT_ENDPOINT } from '../src/web-contract.js'

const reference = 'vision-bridge://attachment/v1/session-1/ref?media=image%2Fpng&bytes=4&width=1&height=1'
const attachment = {
  attachmentId: 'ref',
  mediaType: 'image/png',
  bytes: 4,
  width: 1,
  height: 1,
  [BRIDGE_REFERENCE_FIELD]: reference,
}

afterEach(() => vi.restoreAllMocks())

describe('bridge history image loader', () => {
  it('loads through the fixed same-origin endpoint and reuses one object URL', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(Uint8Array.from([1, 2, 3, 4]), {
      status: 200,
      headers: { 'content-type': 'image/png', 'content-length': '4' },
    }))
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:bridge-history')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const loader = createBridgeHistoryImageLoader(fetcher)

    await expect(loader.load(attachment)).resolves.toBe('blob:bridge-history')
    await expect(loader.load(attachment)).resolves.toBe('blob:bridge-history')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith(WEB_ATTACHMENT_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reference }),
      credentials: 'same-origin',
      redirect: 'error',
    })
    expect(createObjectURL).toHaveBeenCalledTimes(1)

    loader.dispose()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:bridge-history')
  })

  it('does not turn an authorization failure into an image URL', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('{"error":"not-referenced"}', {
      status: 403,
      headers: { 'content-type': 'application/json' },
    }))
    const createObjectURL = vi.spyOn(URL, 'createObjectURL')
    const loader = createBridgeHistoryImageLoader(fetcher)

    await expect(loader.load(attachment)).rejects.toThrow('HTTP 403')
    expect(createObjectURL).not.toHaveBeenCalled()
    loader.dispose()
  })

})
