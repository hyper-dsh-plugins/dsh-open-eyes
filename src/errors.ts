import { HarnessError } from '@deepseek-ai/dsh-llm'

export const VISION_ERROR_CODES = [
  'VISION_DISABLED',
  'VISION_NOT_CONFIGURED',
  'VISION_PROVIDER_NOT_FOUND',
  'VISION_CREDENTIAL_MISSING',
  'VISION_INVALID_ARGUMENT',
  'VISION_PATH_OUTSIDE_WORKSPACE',
  'VISION_SYMLINK_REJECTED',
  'VISION_IMAGE_TOO_LARGE',
  'VISION_UNSUPPORTED_IMAGE',
  'VISION_IMAGE_VALIDATION_FAILED',
  'VISION_REMOTE_URL_DISABLED',
  'VISION_UPSTREAM_HTTP',
  'VISION_UPSTREAM_PROTOCOL',
  'VISION_RESPONSE_TOO_LARGE',
  'VISION_TIMEOUT',
  'VISION_ABORTED',
] as const

export type VisionErrorCode = (typeof VISION_ERROR_CODES)[number]

export class VisionBridgeError extends HarnessError {
  declare readonly code: VisionErrorCode

  constructor(code: VisionErrorCode, message: string, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'VisionBridgeError'
  }
}

export class VisionBridgeConfigError extends TypeError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'VisionBridgeConfigError'
  }
}

function messageOf(value: unknown): string {
  if (value instanceof Error) return value.message
  if (typeof value === 'string') return value
  return 'unknown failure'
}

export function redactText(value: string, secrets: readonly string[]): string {
  let output = value
  for (const secret of secrets) {
    if (secret) output = output.split(secret).join('[REDACTED]')
  }
  return output.replace(/(https?:\/\/[^\s/?#]+[^\s?#]*)\?[^\s#]*/giu, '$1?[REDACTED]')
}

export function takeCodePoints(value: string, maximum: number): { text: string; truncated: boolean } {
  let count = 0
  let end = 0
  for (const codePoint of value) {
    if (count === maximum) return { text: value.slice(0, end), truncated: true }
    count += 1
    end += codePoint.length
  }
  return { text: value, truncated: false }
}

export function sanitizedError(
  value: unknown,
  secrets: readonly string[],
  fallbackCode: VisionErrorCode = 'VISION_UPSTREAM_PROTOCOL',
): VisionBridgeError {
  if (value instanceof VisionBridgeError) {
    return new VisionBridgeError(value.code, redactText(value.message, secrets))
  }
  return new VisionBridgeError(fallbackCode, redactText(messageOf(value), secrets))
}

export function aborted(_reason?: unknown): VisionBridgeError {
  return new VisionBridgeError('VISION_ABORTED', 'vision analysis was aborted')
}
