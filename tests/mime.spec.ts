import { readFileSync } from 'node:fs'
import {
  DEFAULT_MAX_IMAGE_BYTES,
  DEFAULT_MAX_IMAGE_DIMENSION,
  DEFAULT_MAX_IMAGE_PIXELS,
  DEFAULT_MAX_MESSAGE_IMAGE_BYTES,
  DEFAULT_NORMALIZED_IMAGE_MAX_BYTES,
  DEFAULT_NORMALIZED_IMAGE_MAX_DIMENSION,
  DEFAULT_NORMALIZED_IMAGE_MAX_PIXELS,
  validateImageFile,
} from '@deepseek-ai/dsh-attachment-local'
import { describe, expect, it } from 'vitest'
import { detectImageMime } from '../src/mime.js'

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url))

const limits = {
  maxImageBytes: DEFAULT_MAX_IMAGE_BYTES,
  maxImagesPerMessage: 20,
  maxMessageImageBytes: DEFAULT_MAX_MESSAGE_IMAGE_BYTES,
  maxImagePixels: DEFAULT_MAX_IMAGE_PIXELS,
  maxImageDimension: DEFAULT_MAX_IMAGE_DIMENSION,
  mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const,
}

const normalization = {
  maxDimension: DEFAULT_NORMALIZED_IMAGE_MAX_DIMENSION,
  maxBytes: DEFAULT_NORMALIZED_IMAGE_MAX_BYTES,
  maxPixels: DEFAULT_NORMALIZED_IMAGE_MAX_PIXELS,
}

describe('image MIME detection', () => {
  it.each([
    ['tiny.png', 'image/png'],
    ['tiny.jpg', 'image/jpeg'],
    ['tiny.webp', 'image/webp'],
    ['tiny.gif', 'image/gif'],
  ] as const)('recognizes %s from magic bytes', (name, mime) => {
    expect(detectImageMime(fixture(name))).toBe(mime)
  })

  it.each([
    ['tiny.png', 'image/png'],
    ['tiny.jpg', 'image/jpeg'],
    ['tiny.webp', 'image/webp'],
    ['tiny.gif', 'image/gif'],
  ] as const)('fully validates %s with the official DSH attachment implementation', async (name, mime) => {
    await expect(validateImageFile({ data: fixture(name), mediaType: mime }, limits, normalization)).resolves.toBeUndefined()
  })

  it('does not trust a forged extension', () => {
    expect(detectImageMime(fixture('invalid.bin'))).toBeNull()
    expect(detectImageMime(Buffer.from('not a png'))).toBeNull()
  })

  it.each([
    Buffer.from([0x89, 0x50, 0x4e]),
    Buffer.from([0xff, 0xd8]),
    Buffer.from('RIFF'),
    Buffer.from('GIF89'),
  ])('rejects a truncated header', (bytes) => {
    expect(detectImageMime(bytes)).toBeNull()
  })
})
